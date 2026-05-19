'use strict';

const fs = require('fs');
const path = require('path');

function formatAuditSummary(auditArtifact = {}) {
  const request = auditArtifact.request || {};
  const validation = auditArtifact.validation || {};
  const assignment = auditArtifact.assignment || {};
  const approval = auditArtifact.approval || {};
  const execution = auditArtifact.execution || {};
  const isTeamHierarchy = Array.isArray(request.requested_child_links) && request.requested_child_links.length > 0;
  const isTeamCreation = Array.isArray(request.requested_teams) && request.requested_teams.length > 0;

  const hierarchyApprovalState = approval.approver_authorization_state && approval.approver_authorization_state !== 'unknown'
    ? approval.approver_authorization_state
    : validation.designated_approver_authorization
      ? validation.designated_approver_authorization.state || 'unknown'
      : 'n/a';

  if (isTeamHierarchy) {
    return [
      '# Add Child Teams Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Parent team: ${request.parent_team_slug || request.parent_team_name || 'n/a'}`,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Requester: ${request.requester_login || 'n/a'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${hierarchyApprovalState})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      `- Child teams requested: ${(request.requested_child_links || []).length}`,
      `- Child links applied: ${execution.linked_count || execution.mutation_count || 0}`,
      `- No-op: ${execution.noop_count || 0}`,
      `- Pending: ${execution.pending_count || 0}`,
      `- Failed: ${execution.failure_count || 0}`,
      `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
      validation.warnings && validation.warnings.length > 0
        ? `- Validation warnings: ${validation.warnings.join('; ')}`
        : null,
      validation.errors && validation.errors.length > 0
        ? `- Validation errors: ${validation.errors.join('; ')}`
        : null,
      assignment.assignment_note ? `- Assignment note: ${assignment.assignment_note}` : null,
      approval.decision_note ? `- Approval note: ${approval.decision_note}` : null,
      '',
      execution.summary || (validation.is_valid
        ? approval.approval_status === 'approved'
          ? 'Request is approved and eligible for hierarchy execution. No child-team mutation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No child-team mutation was attempted.'
            : 'Request is validated and ready for approval. No child-team mutation was attempted.'
        : 'Request validation failed. No child-team mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  if (isTeamCreation) {
    return [
      '# Create Organization Teams Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Intended owner: ${request.intended_owner_login || 'n/a'}`,
      `- Requester: ${request.requester_login || 'n/a'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_role || 'n/a'})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      `- Teams requested: ${(request.requested_teams || []).length}`,
      `- Teams created: ${execution.created_count || execution.mutation_count || 0}`,
      `- No-op: ${execution.noop_count || 0}`,
      `- Pending: ${execution.pending_count || 0}`,
      `- Failed: ${execution.failure_count || 0}`,
      `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
      validation.warnings && validation.warnings.length > 0
        ? `- Validation warnings: ${validation.warnings.join('; ')}`
        : null,
      validation.errors && validation.errors.length > 0
        ? `- Validation errors: ${validation.errors.join('; ')}`
        : null,
      assignment.assignment_note ? `- Assignment note: ${assignment.assignment_note}` : null,
      '',
      execution.summary || (validation.is_valid
        ? approval.approval_status === 'approved'
          ? 'Request is approved and eligible for execution. No team creation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No team creation was attempted.'
            : 'Request is validated and ready for approval. No team creation was attempted.'
        : 'Request validation failed. No team creation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  return [
    '# Add Team Members Workflow Summary',
    '',
    `- Request ID: ${request.request_id || 'n/a'}`,
    `- Repository: ${request.repository || 'n/a'}`,
    `- Target: ${request.organization || 'n/a'}/${request.team_slug || 'n/a'}`,
    `- Requester: ${request.requester_login || 'n/a'}`,
    `- Request status: ${request.request_status || 'submitted'}`,
    `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
    `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_role || 'n/a'})`,
    approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
    `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
    `- Added: ${execution.mutation_count || 0}`,
    `- No-op: ${execution.noop_count || 0}`,
    `- Pending: ${execution.pending_count || 0}`,
    `- Failed: ${execution.failure_count || 0}`,
    `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
    validation.warnings && validation.warnings.length > 0
      ? `- Validation warnings: ${validation.warnings.join('; ')}`
      : null,
    validation.errors && validation.errors.length > 0
      ? `- Validation errors: ${validation.errors.join('; ')}`
      : null,
    assignment.assignment_note ? `- Assignment note: ${assignment.assignment_note}` : null,
    approval.decision_note ? `- Approval note: ${approval.decision_note}` : null,
    '',
    execution.summary || (validation.is_valid
      ? approval.approval_status === 'approved'
        ? 'Request is approved and eligible for execution. No membership mutation was attempted in this phase.'
        : approval.approval_status === 'denied'
          ? 'Approval was denied or invalid. No membership mutation was attempted.'
          : 'Request is validated and ready for approval. No membership mutation was attempted.'
      : 'Request validation failed. No membership mutation was attempted.'),
  ].filter(Boolean).join('\n');
}

function readAuditArtifact(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function emitAuditSummary(auditArtifact, options = {}) {
  const summary = formatAuditSummary(auditArtifact);
  const summaryPath = options.summaryPath || process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    if (options.overwrite === true) {
      fs.writeFileSync(summaryPath, `${summary}\n`, 'utf8');
    } else {
      fs.appendFileSync(summaryPath, `${summary}\n`, 'utf8');
    }
  }
  return summary;
}

if (require.main === module) {
  const auditArtifactPath = process.argv[2];
  if (!auditArtifactPath) {
    throw new Error('Usage: node src/scripts/emit-audit-summary.js <audit-artifact.json>');
  }

  const auditArtifact = readAuditArtifact(auditArtifactPath);
  const summary = emitAuditSummary(auditArtifact);
  process.stdout.write(`${summary}\n`);
}

module.exports = {
  emitAuditSummary,
  formatAuditSummary,
  readAuditArtifact,
};