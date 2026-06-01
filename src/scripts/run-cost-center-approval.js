'use strict';

const fs = require('fs');
const path = require('path');

const { findLatestApprovalComment } = require('../workflow-support/approval-gate');
const { buildCostCenterArtifact, toCostCenterArtifactJson } = require('../workflow-support/cost-center-artifact');
const { createGitHubCostCenterApi } = require('../workflow-support/github-cost-center-api');
const { formatCostCenterSummary } = require('../workflow-support/format-cost-center-summary');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { runCostCenterValidation } = require('./run-cost-center-validation');

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

function evaluateCostCenterApproval(input = {}) {
  const intendedApprover = String(input.intendedApproverLogin || '').toLowerCase();
  const priorApprovalStatus = input.priorApprovalStatus || 'pending';
  const approvalComment = findLatestApprovalComment(input.issueComments || []);

  if (!approvalComment) {
    return {
      approval_status: priorApprovalStatus === 'approved' ? 'invalidated' : 'pending',
      approver_login: '',
      approver_role: 'other',
      decision_source: 'comment',
      decision_note: priorApprovalStatus === 'approved'
        ? 'The approval comment "approved" is no longer present and execution must remain blocked.'
        : `Add an issue comment containing exactly "approved" from ${input.intendedApproverLogin || 'the named approver'} to authorize execution.`,
    };
  }

  const approverLogin = String(approvalComment.user && approvalComment.user.login || '').toLowerCase();

  if (!intendedApprover || approverLogin !== intendedApprover) {
    return {
      approval_status: 'denied',
      approver_login: approverLogin,
      approver_role: 'other',
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: 'The approval comment "approved" was not added by the named intended approver and does not authorize cost center changes.',
    };
  }

  return {
    approval_status: 'approved',
    approver_login: approverLogin,
    approver_role: 'named_approver',
    approved_at: approvalComment.created_at || null,
    decision_source: 'comment',
    decision_note: 'The approval comment "approved" was added by the named intended approver.',
  };
}

function buildNoSpreadsheetArtifact(env, summaryInput = {}) {
  const message =
    'No cost center spreadsheet was found to approve. Add a comment with a `.csv` file attached, then comment `approved` again.';
  const artifact = buildCostCenterArtifact({
    request: summaryInput.request || {
      issue_number: env.ISSUE_NUMBER == null ? null : Number(env.ISSUE_NUMBER),
      repository: env.GITHUB_REPOSITORY || '',
      request_status: 'awaiting_spreadsheet',
    },
    validation: { is_valid: false },
    approval: {
      approval_status: 'not_requested',
      decision_source: 'comment',
      decision_note: message,
    },
    audit_summary_markdown: message,
  });
  return artifact;
}

async function rebuildArtifactFromComments(options, env, artifactPath) {
  const rebuilt = await runCostCenterValidation(options);

  if (rebuilt && rebuilt.applicable === false) {
    const artifact = buildNoSpreadsheetArtifact(env, { request: rebuilt.request });
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
      request: artifact.request,
      validation: artifact.validation,
      approval: artifact.approval,
      reconciliationPlan: artifact.reconciliation,
      executionOutcome: artifact.execution,
      runContext: artifact.metadata,
      audit_summary_markdown: artifact.audit_summary_markdown,
    }), 'utf8');
    return artifact;
  }

  return readAuditArtifact(artifactPath);
}

async function runCostCenterApproval(options = {}) {
  const env = options.env || process.env;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `cost-center-reallocation-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );

  const artifact = fs.existsSync(artifactPath)
    ? readAuditArtifact(artifactPath)
    : await rebuildArtifactFromComments(options, env, artifactPath);

  if (!artifact.validation || artifact.validation.is_valid !== true) {
    writeGitHubOutput('approval-status', artifact.approval && artifact.approval.approval_status || 'not_requested', env.GITHUB_OUTPUT);
    writeStepSummary(formatCostCenterSummary(artifact), env.GITHUB_STEP_SUMMARY);
    return artifact;
  }

  const tokenInfo = loadWorkflowToken({ env, required: false });
  let approval;
  if (!tokenInfo.token) {
    approval = {
      approval_status: 'pending',
      approver_login: '',
      approver_role: 'other',
      decision_source: 'comment',
      decision_note: 'Approval could not be evaluated because the workflow token secret is missing.',
    };
  } else {
    const api = options.api || createGitHubCostCenterApi({ token: tokenInfo.token });
    const issueComments = await api.listIssueComments({
      repository: artifact.request.repository,
      issueNumber: artifact.request.issue_number,
    });
    approval = evaluateCostCenterApproval({
      intendedApproverLogin: artifact.request.intended_approver_login,
      issueComments,
      priorApprovalStatus: artifact.approval && artifact.approval.approval_status,
    });
  }

  artifact.approval = approval;
  artifact.request.request_status =
    approval.approval_status === 'approved' ? 'approved' : 'awaiting_approval';

  const summary = formatCostCenterSummary(artifact);
  const updated = buildCostCenterArtifact({
    request: artifact.request,
    validation: artifact.validation,
    approval: artifact.approval,
    reconciliationPlan: artifact.reconciliation,
    executionOutcome: artifact.execution,
    runContext: artifact.metadata,
    audit_summary_markdown: summary,
  });

  fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
    request: updated.request,
    validation: updated.validation,
    approval: updated.approval,
    reconciliationPlan: updated.reconciliation,
    executionOutcome: updated.execution,
    runContext: updated.metadata,
    audit_summary_markdown: summary,
  }), 'utf8');

  writeStepSummary(summary, env.GITHUB_STEP_SUMMARY);
  writeGitHubOutput('approval-status', approval.approval_status, env.GITHUB_OUTPUT);

  return updated;
}

if (require.main === module) {
  runCostCenterApproval().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  evaluateCostCenterApproval,
  runCostCenterApproval,
};
