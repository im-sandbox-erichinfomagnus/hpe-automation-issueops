'use strict';

function formatCostCenterSummary(artifact = {}) {
  const request = artifact.request || {};
  const validation = artifact.validation || {};
  const approval = artifact.approval || {};
  const reconciliation = artifact.reconciliation || {};
  const execution = artifact.execution || {};
  const plannedCreates = reconciliation.cost_centers_to_create || [];
  const plannedAdds = reconciliation.assignments_to_add || [];
  const plannedRemoves = reconciliation.assignments_to_remove || [];

  const lines = [
    '# Cost Center Reallocation Workflow Summary',
    '',
    `- Request ID: ${request.request_id || 'n/a'}`,
    `- Enterprise: ${request.enterprise || 'n/a'}`,
    `- Requester: ${request.requester_login || 'n/a'}`,
    `- Intended approver: ${request.intended_approver_login || 'n/a'}`,
    `- Intake mode: ${request.intake_mode || 'n/a'}`,
    `- Dry-run: ${request.dry_run === false ? 'false' : 'true'}`,
    `- Request status: ${request.request_status || 'submitted'}`,
    `- Approval: ${approval.approval_status || 'pending'}${approval.approver_login ? ` (${approval.approver_login})` : ''}`,
    `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
    `- Live cost center state verified: ${validation.live_state_verified ? 'yes' : 'no'}`,
    `- Assignments requested: ${(request.requested_assignments || []).length}`,
    `- Cost centers to create: ${plannedCreates.length}`,
    `- User additions planned: ${plannedAdds.length}`,
    `- User removals planned: ${plannedRemoves.length}`,
    `- Already satisfied: ${(reconciliation.assignments_already_satisfied || []).length}`,
    `- Rejected rows: ${(reconciliation.assignments_rejected || []).length}`,
  ];

  if (execution && Object.keys(execution).length > 0) {
    lines.push(`- Cost centers created: ${execution.cost_centers_created_count || 0}`);
    lines.push(`- Users added: ${execution.added_count || 0}`);
    lines.push(`- Users removed: ${execution.removed_count || 0}`);
    lines.push(`- No-op: ${execution.noop_count || 0}`);
    lines.push(`- Failed: ${execution.failure_count || 0}`);
    lines.push(`- Rollback status: ${execution.rollback_status || 'not_needed'}`);
  }

  if (validation.warnings && validation.warnings.length > 0) {
    lines.push(`- Validation warnings: ${validation.warnings.join('; ')}`);
  }
  if (validation.errors && validation.errors.length > 0) {
    lines.push(`- Validation errors: ${validation.errors.join('; ')}`);
  }

  if (plannedCreates.length > 0 || plannedAdds.length > 0 || plannedRemoves.length > 0) {
    lines.push('');
    lines.push('## Planned changes');
    for (const name of plannedCreates) {
      lines.push(`- create cost center: ${name}`);
    }
    for (const entry of plannedAdds) {
      lines.push(`- add ${entry.login} to ${entry.cost_center}`);
    }
    for (const entry of plannedRemoves) {
      lines.push(`- remove ${entry.login} from ${entry.cost_center}`);
    }
  }

  lines.push('');
  lines.push(execution && execution.summary
    ? execution.summary
    : validation.is_valid
      ? approval.approval_status === 'approved'
        ? request.dry_run === false
          ? 'Request is approved. The plan above has been applied.'
          : 'Request is approved. Dry-run is on, so the plan above will be applied once dry-run is turned off.'
        : approval.approval_status === 'denied'
          ? 'The approval comment was not from the named approver, so no changes were made.'
          : `Request is validated and awaiting an approval comment of exactly "approved" from ${request.intended_approver_login || 'the named approver'}.`
      : 'Validation failed. No cost center changes were attempted.');

  return lines.join('\n');
}

module.exports = {
  formatCostCenterSummary,
};
