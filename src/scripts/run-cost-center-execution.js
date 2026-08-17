'use strict';

const fs = require('fs');
const path = require('path');

const { assertCostCenterAllowed } = require('../actions/cost-center-policy');
const { buildCostCenterArtifact, toCostCenterArtifactJson } = require('../workflow-support/cost-center-artifact');
const { buildCostCenterOutcome } = require('../workflow-support/build-cost-center-outcome');
const { createGitHubCostCenterApi } = require('../workflow-support/github-cost-center-api');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { formatCostCenterSummary } = require('../workflow-support/format-cost-center-summary');
const { reconcileCostCenter } = require('../workflow-support/reconcile-cost-center');

function readAuditArtifact(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function writeStepSummary(summary, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (summaryPath) {
    fs.writeFileSync(summaryPath, `${summary}\n`, 'utf8');
  }
}

function classifyFailureReason(error = {}) {
  if (error.status === 429) {
    return 'rate_limited';
  }
  const message = String(error.payload && error.payload.message ? error.payload.message : error.message || '').toLowerCase();
  if (message.includes('secondary rate limit')) {
    return 'rate_limited';
  }
  if (error.status) {
    return `http_${error.status}`;
  }
  return 'unknown_error';
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveRequestStatus(outcome) {
  if (outcome.failure_count === 0) {
    return 'executed';
  }
  if (outcome.mutation_count > 0 || outcome.noop_count > 0) {
    return 'partially_executed';
  }
  return 'failed';
}

async function runCostCenterExecution(options = {}) {
  const env = options.env || process.env;
  const shouldSetExitCode = options.setProcessExitCode === true;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `cost-center-reallocation-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  const artifact = readAuditArtifact(artifactPath);

  if (!artifact.validation || artifact.validation.is_valid !== true) {
    writeGitHubOutput('execution-status', 'not_requested', env.GITHUB_OUTPUT);
    writeStepSummary(formatCostCenterSummary(artifact), env.GITHUB_STEP_SUMMARY);
    return artifact;
  }

  if (!artifact.approval || artifact.approval.approval_status !== 'approved') {
    writeGitHubOutput('execution-status', artifact.approval && artifact.approval.approval_status || 'pending', env.GITHUB_OUTPUT);
    writeStepSummary(formatCostCenterSummary(artifact), env.GITHUB_STEP_SUMMARY);
    return artifact;
  }

  let mutationDecision;
  try {
    mutationDecision = assertCostCenterAllowed({
      approval_status: artifact.approval.approval_status,
      approver_login: artifact.approval.approver_login,
      intended_approver_login: artifact.request.intended_approver_login,
      dry_run: artifact.request.dry_run,
      tokenInfo: options.tokenInfo,
    });
  } catch (error) {
    artifact.request.request_status = 'failed';
    const outcome = buildCostCenterOutcome({
      executionResults: [],
      intake_mode: artifact.request.intake_mode,
      artifact_path: artifactPath,
    });
    outcome.failure_count = 1;
    outcome.rollback_status = 'manual_follow_up_required';
    outcome.summary = `${error.message}. No cost center changes were attempted.`;
    artifact.execution = outcome;
    const blockedSummary = formatCostCenterSummary(artifact);
    fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
      request: artifact.request,
      validation: artifact.validation,
      approval: artifact.approval,
      reconciliationPlan: artifact.reconciliation,
      executionOutcome: outcome,
      runContext: artifact.metadata,
      audit_summary_markdown: blockedSummary,
    }), 'utf8');
    writeStepSummary(blockedSummary, env.GITHUB_STEP_SUMMARY);
    writeGitHubOutput('execution-status', 'failed', env.GITHUB_OUTPUT);
    if (shouldSetExitCode) {
      process.exitCode = 1;
    }
    return artifact;
  }

  // Dry-run: keep the validated plan, attempt no mutations.
  if (!mutationDecision.allowed) {
    const summary = formatCostCenterSummary(artifact);
    fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
      request: artifact.request,
      validation: artifact.validation,
      approval: artifact.approval,
      reconciliationPlan: artifact.reconciliation,
      executionOutcome: artifact.execution || {},
      runContext: artifact.metadata,
      audit_summary_markdown: summary,
    }), 'utf8');
    writeStepSummary(summary, env.GITHUB_STEP_SUMMARY);
    writeGitHubOutput('execution-status', mutationDecision.reason, env.GITHUB_OUTPUT);
    return artifact;
  }

  const api = options.api || createGitHubCostCenterApi({ token: mutationDecision.tokenInfo.token });
  const enterprise = artifact.request.enterprise;

  const currentCostCenters = await api.listCostCenters({ enterprise });
  const plan = reconcileCostCenter({
    request: artifact.request,
    validatedAssignments: artifact.validation.requested_assignments,
    currentCostCenters,
    enterprise_exists: true,
    live_state_verified: true,
    dry_run: false,
  });

  const executionResults = [];
  let latestRateLimitSnapshot = null;
  const costCenterIdByName = new Map(
    currentCostCenters
      .filter((costCenter) => costCenter.name)
      .map((costCenter) => [normalizeName(costCenter.name), costCenter.id])
  );

  for (const assignment of plan.assignments_rejected) {
    executionResults.push({
      cost_center: assignment.cost_center,
      login: assignment.login,
      source_row_number: assignment.source_row_number || null,
      execution_result: 'rejected',
      failure_reason: assignment.failure_reason || 'rejected',
    });
  }
  for (const assignment of plan.assignments_already_satisfied) {
    executionResults.push({
      cost_center: assignment.cost_center,
      login: assignment.login,
      source_row_number: assignment.source_row_number || null,
      execution_result: 'noop',
      failure_reason: null,
    });
  }

  for (const name of plan.cost_centers_to_create) {
    const attempt = await executeWithBoundedRetry(
      () => api.createCostCenter({ enterprise, name }),
      { maxRetries: options.maxRetries || 2, sleep: options.sleep }
    );
    latestRateLimitSnapshot = attempt.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
    if (attempt.ok) {
      costCenterIdByName.set(normalizeName(name), attempt.value && attempt.value.id);
      executionResults.push({ cost_center: name, execution_result: 'created', failure_reason: null });
    } else {
      executionResults.push({
        cost_center: name,
        execution_result: 'failed',
        failure_reason: classifyFailureReason(attempt.error),
      });
    }
  }

  for (const assignment of plan.assignments_to_add) {
    const costCenterId = assignment.cost_center_id || costCenterIdByName.get(normalizeName(assignment.cost_center));
    if (!costCenterId) {
      executionResults.push({
        cost_center: assignment.cost_center,
        login: assignment.login,
        source_row_number: assignment.source_row_number || null,
        execution_result: 'failed',
        failure_reason: 'cost_center_unavailable',
      });
      continue;
    }
    const attempt = await executeWithBoundedRetry(
      () => api.addResource({ enterprise, costCenterId, users: [assignment.login] }),
      { maxRetries: options.maxRetries || 2, sleep: options.sleep }
    );
    latestRateLimitSnapshot = attempt.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
    executionResults.push({
      cost_center: assignment.cost_center,
      cost_center_id: costCenterId,
      login: assignment.login,
      source_row_number: assignment.source_row_number || null,
      execution_result: attempt.ok ? 'added' : 'failed',
      failure_reason: attempt.ok ? null : classifyFailureReason(attempt.error),
    });
  }

  for (const assignment of plan.assignments_to_remove) {
    const costCenterId = assignment.cost_center_id || costCenterIdByName.get(normalizeName(assignment.cost_center));
    if (!costCenterId) {
      executionResults.push({
        cost_center: assignment.cost_center,
        login: assignment.login,
        source_row_number: assignment.source_row_number || null,
        execution_result: 'noop',
        failure_reason: null,
      });
      continue;
    }
    const attempt = await executeWithBoundedRetry(
      () => api.removeResource({ enterprise, costCenterId, users: [assignment.login] }),
      { maxRetries: options.maxRetries || 2, sleep: options.sleep }
    );
    latestRateLimitSnapshot = attempt.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
    executionResults.push({
      cost_center: assignment.cost_center,
      cost_center_id: costCenterId,
      login: assignment.login,
      source_row_number: assignment.source_row_number || null,
      execution_result: attempt.ok ? 'removed' : 'failed',
      failure_reason: attempt.ok ? null : classifyFailureReason(attempt.error),
    });
  }

  const outcome = buildCostCenterOutcome({
    executionResults,
    intake_mode: artifact.request.intake_mode,
    artifact_path: artifactPath,
    rate_limit_snapshot: latestRateLimitSnapshot,
    runContext: { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT },
  });
  const requestStatus = deriveRequestStatus(outcome);
  const prefix =
    requestStatus === 'executed'
      ? 'Approved cost center execution completed.'
      : requestStatus === 'partially_executed'
        ? 'Approved cost center execution completed with partial failure.'
        : 'Approved cost center execution failed.';
  outcome.summary = `${prefix} ${outcome.summary}`;

  artifact.request.request_status = requestStatus;
  artifact.reconciliation = plan;
  artifact.execution = outcome;
  const summary = formatCostCenterSummary(artifact);

  fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
    request: artifact.request,
    validation: artifact.validation,
    approval: artifact.approval,
    reconciliationPlan: plan,
    executionOutcome: outcome,
    runContext: artifact.metadata,
    audit_summary_markdown: summary,
  }), 'utf8');

  writeStepSummary(summary, env.GITHUB_STEP_SUMMARY);
  writeGitHubOutput('execution-status', requestStatus, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);

  if (shouldSetExitCode && requestStatus !== 'executed') {
    process.exitCode = 1;
  }

  return artifact;
}

if (require.main === module) {
  runCostCenterExecution({ setProcessExitCode: true }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  classifyFailureReason,
  deriveRequestStatus,
  runCostCenterExecution,
};
