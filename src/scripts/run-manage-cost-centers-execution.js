'use strict';

const fs = require('fs');
const path = require('path');

const { validateCostCenterRequest } = require('../workflow-support/validate-manage-cost-centers-request');
const { reconcileCostCenterChanges } = require('../workflow-support/reconcile-manage-cost-centers-changes');
const { createGitHubCostCenterApi } = require('../workflow-support/github-cost-center-billing-api');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { assertCostCenterMutationAllowed } = require('../actions/manage-cost-centers-policy');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { buildCostCenterArtifact, toCostCenterArtifactJson } = require('../workflow-support/build-manage-cost-centers-artifact');
const { emitCostCenterSummary } = require('./emit-manage-cost-centers-summary');

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function readArtifact(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function classifyFailure(error = {}) {
  if (error.status === 429) {
    return 'rate_limited';
  }
  if (error.status) {
    return `http_${error.status}`;
  }
  return 'unknown_error';
}

async function runCostCenterExecution(options = {}) {
  const env = options.env || process.env;
  const shouldSetExitCode = options.setProcessExitCode === true;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `manage-cost-centers-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  const artifact = readArtifact(artifactPath);

  const finish = (executionStatus) => {
    writeGitHubOutput('execution-status', executionStatus, env.GITHUB_OUTPUT);
    writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
    emitCostCenterSummary(artifact, { summaryPath: env.GITHUB_STEP_SUMMARY });
  };

  if (!artifact.validation || artifact.validation.is_valid !== true) {
    finish('not_requested');
    return artifact;
  }
  if (!artifact.approval || artifact.approval.approval_status !== 'approved') {
    finish(artifact.approval && artifact.approval.approval_status || 'pending');
    return artifact;
  }

  let mutationDecision;
  try {
    mutationDecision = assertCostCenterMutationAllowed({
      approval_status: artifact.approval.approval_status,
      approver_role: artifact.approval.approver_role,
      dry_run: artifact.request.dry_run,
      tokenInfo: options.tokenInfo,
    });
  } catch (error) {
    artifact.request.request_status = 'failed';
    artifact.execution = {
      created_count: 0, renamed_count: 0, deleted_count: 0, noop_count: 0,
      failure_count: 1, executed_count: 0, rollback_status: 'manual_follow_up_required',
      summary: `${error.message}. No cost-center mutation was attempted.`,
      results: [],
    };
    fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
      request: artifact.request, validation: artifact.validation, approval: artifact.approval,
      reconciliation: artifact.reconciliation, execution: artifact.execution, runContext: artifact.metadata,
    }), 'utf8');
    finish('failed');
    if (shouldSetExitCode) {
      process.exitCode = 1;
    }
    return artifact;
  }

  if (!mutationDecision.allowed) {
    artifact.execution = {
      created_count: 0, renamed_count: 0, deleted_count: 0, noop_count: 0,
      failure_count: 0, executed_count: 0, rollback_status: 'not_needed',
      summary: 'Approved execution remains blocked because the request is dry-run only. No cost-center mutation was attempted.',
      results: [],
    };
    fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
      request: artifact.request, validation: artifact.validation, approval: artifact.approval,
      reconciliation: artifact.reconciliation, execution: artifact.execution, runContext: artifact.metadata,
    }), 'utf8');
    finish(mutationDecision.reason);
    return artifact;
  }

  const api = options.costCenterApi || createGitHubCostCenterApi({ token: mutationDecision.tokenInfo.token });

  // Re-validate with live access so the executed plan reflects current state.
  const liveValidation = await validateCostCenterRequest(artifact.request, {
    listCostCenters: ({ enterprise, state }) =>
      executeWithBoundedRetry(() => api.listCostCenters({ enterprise, state }), { maxRetries: options.maxRetries || 2, sleep: options.sleep })
        .then((r) => { if (!r.ok) { throw r.error || new Error('list failed'); } return r.value; }),
    getCostCenter: ({ enterprise, costCenterId }) =>
      executeWithBoundedRetry(() => api.getCostCenter({ enterprise, costCenterId }), { maxRetries: options.maxRetries || 2, sleep: options.sleep })
        .then((r) => { if (!r.ok) { throw r.error || new Error('get failed'); } return r.value; }),
  });
  const plan = reconcileCostCenterChanges({ requested_changes: liveValidation.requested_changes, dry_run: false });

  const results = [];
  const enterprise = artifact.request.enterprise;
  const apply = async (row, fn, successResult) => {
    const attempt = await executeWithBoundedRetry(fn, { maxRetries: options.maxRetries || 2, sleep: options.sleep });
    results.push({
      ...row,
      execution_result: attempt.ok ? successResult : 'failed',
      failure_reason: attempt.ok ? null : classifyFailure(attempt.error),
    });
  };

  for (const row of plan.creates) {
    await apply(row, () => api.createCostCenter({ enterprise, name: row.cost_center_input }), 'created');
  }
  for (const row of plan.renames) {
    await apply(row, () => api.renameCostCenter({ enterprise, costCenterId: row.resolved_cost_center_id, name: row.new_name_input }), 'renamed');
  }
  for (const row of plan.deletes) {
    await apply(row, () => api.deleteCostCenter({ enterprise, costCenterId: row.resolved_cost_center_id }), 'deleted');
  }
  for (const row of plan.noops) {
    results.push({ ...row, execution_result: 'noop', failure_reason: null });
  }

  const createdCount = results.filter((r) => r.execution_result === 'created').length;
  const renamedCount = results.filter((r) => r.execution_result === 'renamed').length;
  const deletedCount = results.filter((r) => r.execution_result === 'deleted').length;
  const noopCount = results.filter((r) => r.execution_result === 'noop').length;
  const failureCount = results.filter((r) => r.execution_result === 'failed').length;
  const executedCount = createdCount + renamedCount + deletedCount;

  const requestStatus = failureCount === 0
    ? 'executed'
    : (executedCount > 0 || noopCount > 0) ? 'partially_executed' : 'failed';

  artifact.request.request_status = requestStatus;
  // Merge execution_result back onto the validated rows for the summary table.
  const resultByRow = new Map(results.map((r) => [r.source_row_number, r]));
  artifact.validation.requested_changes = (artifact.validation.requested_changes || []).map((row) => {
    const hit = resultByRow.get(row.source_row_number);
    return hit ? { ...row, execution_result: hit.execution_result, failure_reason: hit.failure_reason } : row;
  });
  artifact.execution = {
    created_count: createdCount,
    renamed_count: renamedCount,
    deleted_count: deletedCount,
    noop_count: noopCount,
    failure_count: failureCount,
    executed_count: executedCount,
    rollback_status: failureCount === 0 ? 'not_needed' : 'manual_follow_up_required',
    summary: `Cost-center execution ${requestStatus}: ${createdCount} created, ${renamedCount} renamed, ${deletedCount} deleted, ${noopCount} no-op, ${failureCount} failed.`,
    results,
  };

  const rebuilt = buildCostCenterArtifact(artifact);
  fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
    request: artifact.request, validation: artifact.validation, approval: artifact.approval,
    reconciliation: artifact.reconciliation, execution: artifact.execution, runContext: artifact.metadata,
  }), 'utf8');

  if (artifact.request.issue_number != null) {
    const labelsApi = options.labelsApi
      || (mutationDecision.tokenInfo.token ? createGitHubTeamApi({ token: mutationDecision.tokenInfo.token }) : null);
    if (labelsApi && typeof labelsApi.addIssueLabels === 'function') {
      try {
        await labelsApi.addIssueLabels({
          repository: artifact.request.repository,
          issueNumber: artifact.request.issue_number,
          labels: [`issueops:manage-cost-centers:${requestStatus}`],
        });
      } catch (labelError) {
        console.warn(`[warn] Failed to add terminal state label: ${labelError.message}`);
      }
    }
  }

  emitCostCenterSummary(rebuilt, { summaryPath: env.GITHUB_STEP_SUMMARY });
  writeGitHubOutput('execution-status', requestStatus, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  if (shouldSetExitCode && requestStatus !== 'executed') {
    process.exitCode = 1;
  }
  return rebuilt;
}

if (require.main === module) {
  runCostCenterExecution({ setProcessExitCode: true }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runCostCenterExecution,
};
