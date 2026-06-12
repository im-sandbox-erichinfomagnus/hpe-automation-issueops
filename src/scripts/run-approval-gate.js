'use strict';

const fs = require('fs');
const path = require('path');

const { evaluateApprovalGate } = require('../workflow-support/approval-gate');
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { emitAuditSummary } = require('./emit-audit-summary');

function readAuditArtifact(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function pickCentralIssueAssignee(assignableOwners = [], requesterLogin = '') {
  const normalizedRequester = String(requesterLogin || '').toLowerCase();
  const normalizedOwners = [...new Set(assignableOwners.map((login) => String(login || '').toLowerCase()).filter(Boolean))];
  if (normalizedOwners.length === 0) {
    return '';
  }

  return normalizedOwners.find((login) => login !== normalizedRequester) || normalizedOwners[0];
}

function buildAssignmentNote(operation) {
  if (operation === 'team_hierarchy') {
    return 'Central issue assignment is for queue ownership only and does not authorize team hierarchy mutation.';
  }

  if (operation === 'team_creation') {
    return 'Central issue assignment is for queue ownership only and does not authorize team creation.';
  }

  if (operation === 'team_repo_access') {
    return 'Central issue assignment is for queue ownership only and does not authorize repository access mutation.';
  }

  if (operation === 'tenant_creation') {
    return 'Central issue assignment is for queue ownership only and does not authorize tenant bootstrap mutation.';
  }

  if (operation === 'tenant_repo_creation') {
    return 'Central issue assignment is for queue ownership only and does not authorize tenant repository creation mutation.';
  }

  if (operation === 'hosted_runner_creation') {
    return 'Central issue assignment is for queue ownership only and does not authorize tenant hosted-runner creation mutation.';
  }

  if (operation === 'hosted_runner_deletion') {
    return 'Central issue assignment is for queue ownership only and does not authorize tenant hosted-runner deletion mutation.';
  }

  if (operation === 'hosted_runner_move') {
    return 'Central issue assignment is for queue ownership only and does not authorize tenant hosted-runner move mutation.';
  }

  if (operation === 'runner_group_creation') {
    return 'Central issue assignment is for queue ownership only and does not authorize tenant runner group creation mutation.';
  }

  return 'Central issue assignment is for queue ownership only and does not authorize membership mutation.';
}

async function runApprovalGate(options = {}) {
  const env = options.env || process.env;
  const shouldSetProcessExitCode = options.setProcessExitCode !== false && env === process.env;
  const defaultArtifactName = 'add-team-members';
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `${defaultArtifactName}-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  const auditArtifact = readAuditArtifact(artifactPath);
  const operation = auditArtifact.metadata && auditArtifact.metadata.operation;

  if (
    (operation === 'team_membership' || operation === 'team_creation' || operation === 'team_hierarchy' || operation === 'team_repo_access' || operation === 'tenant_creation' || operation === 'tenant_repo_creation') &&
    auditArtifact.request &&
    auditArtifact.request.intake_mode === 'csv_attachment' &&
    ['executed', 'partially_executed', 'failed', 'failed_after_approved_execution'].includes(auditArtifact.request.request_status)
  ) {
    writeGitHubOutput('approval-status', 'not_requested', env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  if (!auditArtifact.validation || auditArtifact.validation.is_valid !== true) {
    writeGitHubOutput('approval-status', auditArtifact.approval && auditArtifact.approval.approval_status || 'not_requested', env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  auditArtifact.assignment = auditArtifact.assignment || {
    assignment_status: 'not_attempted',
    assigned_login: '',
    assignment_note: '',
    assigned_at: null,
  };

  const tokenInfo = loadWorkflowToken({ env, required: false });
  if (!tokenInfo.token) {
    auditArtifact.assignment = {
      assignment_status: 'failed',
      assigned_login: '',
      assignment_note: 'Central issue assignment could not be evaluated because the workflow token secret is missing.',
      assigned_at: null,
    };
    auditArtifact.approval = {
      approval_status: 'pending',
      approver_login: '',
      approver_role: 'other',
      approver_membership_state: 'unknown',
      decision_source: 'comment',
      decision_note: 'Approval could not be evaluated because the workflow token secret is missing.',
    };
  } else {
    const api = options.api || createGitHubTeamApi({ token: tokenInfo.token });
    const assignableOwners = await api.getAssignableOwners({
      repository: auditArtifact.request.repository,
    });
    const selectedAssignee = pickCentralIssueAssignee(
      assignableOwners,
      auditArtifact.request.requester_login
    );

    if (!selectedAssignee) {
      auditArtifact.assignment = {
        assignment_status: 'failed',
        assigned_login: '',
        assignment_note: 'No assignable central-repository owner was available for queue ownership.',
        assigned_at: null,
      };
    } else {
      const assignmentResult = await api.addIssueAssignees({
        repository: auditArtifact.request.repository,
        issueNumber: auditArtifact.request.issue_number,
        assignees: [selectedAssignee],
      });
      auditArtifact.assignment = {
        assignment_status: assignmentResult.status || 'assigned',
        assigned_login: selectedAssignee,
        assignment_note: buildAssignmentNote(operation),
        assigned_at: new Date().toISOString(),
      };
    }

    const issueComments = await api.listIssueComments({
      repository: auditArtifact.request.repository,
      issueNumber: auditArtifact.request.issue_number,
    });

    auditArtifact.approval = await evaluateApprovalGate(
      {
        organization: auditArtifact.request.organization,
        request_status: auditArtifact.request.request_status,
        intake_mode: auditArtifact.request.intake_mode,
        latestContextMarker: auditArtifact.request.context_marker,
        priorApprovedContextMarker: auditArtifact.approval && auditArtifact.approval.approved_context_marker,
        accepted_attachment_submission: auditArtifact.request.accepted_attachment_submission,
        intendedOwnerLogin: auditArtifact.request.intended_owner_login,
        designatedApproverLogin: auditArtifact.request.designated_approver_login,
        parentTeamSlug: auditArtifact.request.parent_team_slug,
        requestedChildLinks: auditArtifact.request.requested_child_links || [],
        approvalMode: auditArtifact.metadata && auditArtifact.metadata.operation === 'team_creation'
          ? 'team_creation'
          : auditArtifact.metadata && auditArtifact.metadata.operation === 'team_hierarchy'
            ? 'team_hierarchy'
            : auditArtifact.metadata && auditArtifact.metadata.operation === 'team_repo_access'
              ? 'team_repo_access'
              : auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_repo_creation'
                ? 'tenant_repo_creation'
              : auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_creation'
                ? 'tenant_creation'
              : auditArtifact.metadata && ['hosted_runner_creation', 'hosted_runner_deletion', 'hosted_runner_move', 'runner_group_creation'].includes(auditArtifact.metadata.operation)
                ? auditArtifact.metadata.operation
              : 'team_membership',
        issueComments,
        priorApprovalStatus: auditArtifact.approval && auditArtifact.approval.approval_status,
      },
      {
        api,
      }
    );
  }

  const isWaitingForAttachment =
    auditArtifact.request &&
    auditArtifact.request.intake_mode === 'csv_attachment' &&
    auditArtifact.approval &&
    auditArtifact.approval.approval_status === 'not_requested';

  auditArtifact.request.request_status = isWaitingForAttachment
    ? 'waiting_for_attachment'
    : auditArtifact.approval.approval_status === 'approved'
      ? 'approved'
      : 'awaiting_approval';
  auditArtifact.execution.summary =
    auditArtifact.metadata && auditArtifact.metadata.operation === 'team_hierarchy'
      ? auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by the authorized designated hierarchy approver. No child-team mutation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'not_requested'
          ? 'Request is still waiting for a requester-authored CSV attachment comment before approval can be evaluated. No child-team mutation was attempted.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from the authorized designated hierarchy approver. No child-team mutation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No child-team mutation was attempted.'
            : 'Request is validated, centrally routed, and awaiting approval from the designated hierarchy approver. No child-team mutation was attempted.'
      : auditArtifact.metadata && auditArtifact.metadata.operation === 'team_creation'
      ? auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by the active intended owner. No team creation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from the active intended owner. No team creation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No team creation was attempted.'
            : 'Request is validated, centrally routed, and awaiting approval from the active intended owner. No team creation was attempted.'
      : auditArtifact.metadata && auditArtifact.metadata.operation === 'team_repo_access'
      ? auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by the authorized designated target organization owner. No repository-access mutation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'not_requested'
          ? 'Request is still waiting for a requester-authored CSV attachment comment before approval can be evaluated. No repository-access mutation was attempted.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from the authorized designated target organization owner. No repository-access mutation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No repository-access mutation was attempted.'
            : 'Request is validated, centrally routed, and awaiting approval from the designated target organization owner. No repository-access mutation was attempted.'
      : auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_creation'
      ? auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by the authorized designated target organization owner. No tenant bootstrap mutation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from the authorized designated target organization owner. No tenant bootstrap mutation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No tenant bootstrap mutation was attempted.'
            : 'Request is validated, centrally routed, and awaiting approval from the designated target organization owner. No tenant bootstrap mutation was attempted.'
      : auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_repo_creation'
      ? auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by the authorized designated target organization owner. No tenant repository mutation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from the authorized designated target organization owner. No tenant repository mutation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No tenant repository mutation was attempted.'
            : 'Request is validated, centrally routed, and awaiting approval from the designated target organization owner. No tenant repository mutation was attempted.'
      : auditArtifact.metadata && ['hosted_runner_creation', 'hosted_runner_deletion', 'hosted_runner_move', 'runner_group_creation'].includes(auditArtifact.metadata.operation)
      ? auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by the authorized designated target organization owner. No tenant runner mutation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from the authorized designated target organization owner. No tenant runner mutation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No tenant runner mutation was attempted.'
            : 'Request is validated, centrally routed, and awaiting approval from the designated target organization owner. No tenant runner mutation was attempted.'
      : auditArtifact.approval.approval_status === 'approved'
        ? 'Request approval was granted by an organization owner. No membership mutation was attempted in this phase.'
        : auditArtifact.approval.approval_status === 'denied'
          ? 'Approval was denied because the approval comment did not come from an organization owner. No membership mutation was attempted.'
          : auditArtifact.approval.approval_status === 'invalidated'
            ? 'Approval was invalidated after the approval comment was removed. No membership mutation was attempted.'
            : 'Request is validated and awaiting approval from an organization owner. No membership mutation was attempted.';

  const updatedArtifact = buildAuditArtifact({
    request: auditArtifact.request,
    validation: auditArtifact.validation,
    assignment: auditArtifact.assignment,
    approval: auditArtifact.approval,
    reconciliationPlan: auditArtifact.reconciliation,
    executionOutcome: auditArtifact.execution,
    runContext: auditArtifact.metadata,
  });

  fs.writeFileSync(artifactPath, toAuditArtifactJson({
    request: updatedArtifact.request,
    validation: updatedArtifact.validation,
    assignment: updatedArtifact.assignment,
    approval: updatedArtifact.approval,
    executionOutcome: updatedArtifact.execution,
    runContext: updatedArtifact.metadata,
    reconciliationPlan: updatedArtifact.reconciliation,
  }), 'utf8');

  emitAuditSummary(updatedArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
  writeGitHubOutput('approval-status', updatedArtifact.approval.approval_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('assigned-login', updatedArtifact.assignment.assigned_login || '', env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-name', path.basename(artifactPath), env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-retention-days', env.AUDIT_ARTIFACT_RETENTION_DAYS || '', env.GITHUB_OUTPUT);

  if (updatedArtifact.approval.approval_status === 'denied' && shouldSetProcessExitCode) {
    process.exitCode = 1;
  }

  return updatedArtifact;
}

if (require.main === module) {
  runApprovalGate().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildAssignmentNote,
  pickCentralIssueAssignee,
  runApprovalGate,
};
