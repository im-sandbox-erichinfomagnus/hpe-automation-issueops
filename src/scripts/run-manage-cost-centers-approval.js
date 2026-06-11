'use strict';

const fs = require('fs');
const path = require('path');

const { findLatestApprovalComment, APPROVAL_COMMAND } = require('../workflow-support/approval-gate');
const { resolveCostCenterApprover } = require('../workflow-support/resolve-manage-cost-centers-approver');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
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

function persist(artifactPath, artifact, env) {
  fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
    request: artifact.request,
    validation: artifact.validation,
    approval: artifact.approval,
    reconciliation: artifact.reconciliation,
    execution: artifact.execution,
    runContext: artifact.metadata,
  }), 'utf8');
  emitCostCenterSummary(artifact, { summaryPath: env.GITHUB_STEP_SUMMARY });
}

async function runCostCenterApproval(options = {}) {
  const env = options.env || process.env;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `manage-cost-centers-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  const artifact = readArtifact(artifactPath);

  if (!artifact.validation || artifact.validation.is_valid !== true) {
    artifact.approval = { ...(artifact.approval || {}), approval_status: 'not_requested' };
    persist(artifactPath, buildCostCenterArtifact(artifact), env);
    writeGitHubOutput('approval-status', 'not_requested', env.GITHUB_OUTPUT);
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
    const api = options.api || createGitHubTeamApi({ token: tokenInfo.token });
    const comments = await api.listIssueComments({
      repository: artifact.request.repository,
      issueNumber: artifact.request.issue_number,
    });
    const approvalComment = findLatestApprovalComment(comments, APPROVAL_COMMAND);
    if (!approvalComment) {
      approval = {
        approval_status: 'pending',
        approver_login: '',
        approver_role: 'other',
        decision_source: 'comment',
        decision_note: `Add an issue comment containing exactly '${APPROVAL_COMMAND}' from the designated approver (${artifact.request.designated_approver_login}) to authorize execution.`,
      };
    } else {
      const approver = resolveCostCenterApprover({
        approverLogin: approvalComment.user && approvalComment.user.login,
        designatedApproverLogin: artifact.request.designated_approver_login,
      });
      const approved = approver.approver_role === 'designated_approver';
      approval = {
        approval_status: approved ? 'approved' : 'denied',
        approver_login: approver.approver_login,
        approver_role: approver.approver_role,
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: approved
          ? `The approval comment '${APPROVAL_COMMAND}' was added by the designated approver.`
          : `The approval comment '${APPROVAL_COMMAND}' was not added by the designated approver and does not authorize cost-center mutation.`,
      };
    }
  }

  artifact.approval = approval;
  artifact.request.request_status = approval.approval_status === 'approved' ? 'approved' : 'awaiting_approval';
  const rebuilt = buildCostCenterArtifact(artifact);
  persist(artifactPath, rebuilt, env);
  writeGitHubOutput('approval-status', approval.approval_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);

  if (approval.approval_status === 'denied' && options.setProcessExitCode && env === process.env) {
    process.exitCode = 1;
  }
  return rebuilt;
}

if (require.main === module) {
  runCostCenterApproval().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runCostCenterApproval,
};
