'use strict';

function buildAuditArtifact(input = {}) {
  const request = input.request || {};
  const validation = input.validation || {};
  const assignment = input.assignment || {};
  const approval = input.approval || {};
  const reconciliationPlan = input.reconciliationPlan || input.reconciliation_plan || {};
  const executionOutcome = input.executionOutcome || input.execution_outcome || {};
  const runContext = input.runContext || input.run_context || {};
  const isTeamHierarchy = Array.isArray(request.requested_child_links);
  const isTeamCreation = Array.isArray(request.requested_teams);

  return {
    request: {
      request_id: request.request_id,
      issue_number: request.issue_number,
      repository: request.repository,
      requester_login: request.requester_login,
      organization: request.organization,
      team_slug: request.team_slug,
      parent_team_slug: request.parent_team_slug,
      parent_team_name: request.parent_team_name,
      requested_people: request.requested_people,
      intended_owner_login: request.intended_owner_login,
      designated_approver_login: request.designated_approver_login,
      requested_teams: request.requested_teams || [],
      requested_child_links: request.requested_child_links || [],
      request_status: request.request_status,
      duplicate_people: request.duplicate_people || [],
      invalid_people: request.invalid_people || [],
      duplicate_team_names: request.duplicate_team_names || [],
      conflicting_slugs: request.conflicting_slugs || [],
      invalid_team_names: request.invalid_team_names || [],
      duplicate_child_teams: request.duplicate_child_teams || [],
      conflicting_child_slugs: request.conflicting_child_slugs || [],
      invalid_child_teams: request.invalid_child_teams || [],
      dry_run: request.dry_run,
      submitted_at: request.submitted_at,
    },
    validation: {
      is_valid: validation.is_valid,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      team_exists: validation.team_exists,
      team_sync_blocked: validation.team_sync_blocked,
      requested_people: validation.requested_people || [],
      organization_visible: validation.organization_visible,
      intended_owner_membership: validation.intended_owner_membership || null,
      requested_teams: validation.requested_teams || [],
      existing_teams: validation.existing_teams || [],
      parent_team_exists: validation.parent_team_exists,
      designated_approver_authorization: validation.designated_approver_authorization || null,
      requested_child_links: validation.requested_child_links || [],
      existing_child_links: validation.existing_child_links || [],
    },
    assignment: {
      assignment_status: assignment.assignment_status || 'not_attempted',
      assigned_login: assignment.assigned_login || '',
      assignment_note: assignment.assignment_note || '',
      assigned_at: assignment.assigned_at || null,
    },
    approval: {
      approval_status: approval.approval_status || 'pending',
      approver_login: approval.approver_login || '',
      approver_role: approval.approver_role || 'other',
      approver_membership_state: approval.approver_membership_state || 'unknown',
      approver_authorization_state: approval.approver_authorization_state || 'unknown',
      approved_at: approval.approved_at || null,
      decision_source: approval.decision_source || '',
      decision_note: approval.decision_note || '',
    },
    reconciliation: {
      team_exists: reconciliationPlan.team_exists,
      team_sync_blocked: reconciliationPlan.team_sync_blocked,
      current_members: reconciliationPlan.current_members || [],
      people_to_add: reconciliationPlan.people_to_add || [],
      people_already_present: reconciliationPlan.people_already_present || [],
      people_rejected: reconciliationPlan.people_rejected || [],
      organization_exists: reconciliationPlan.organization_exists,
      parent_team_exists: reconciliationPlan.parent_team_exists,
      teams_to_create: reconciliationPlan.teams_to_create || [],
      teams_already_present: reconciliationPlan.teams_already_present || [],
      teams_rejected: reconciliationPlan.teams_rejected || [],
      child_links_to_apply: reconciliationPlan.child_links_to_apply || [],
      child_links_already_present: reconciliationPlan.child_links_already_present || [],
      child_links_rejected: reconciliationPlan.child_links_rejected || [],
      dry_run: reconciliationPlan.dry_run,
      rate_limit_snapshot: reconciliationPlan.rate_limit_snapshot || null,
      state: reconciliationPlan.state || '',
    },
    execution: executionOutcome,
    metadata: {
      run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
      run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
      generated_at: new Date().toISOString(),
      operation: isTeamHierarchy ? 'team_hierarchy' : isTeamCreation ? 'team_creation' : 'team_membership',
    },
  };
}

function toAuditArtifactJson(input = {}) {
  return `${JSON.stringify(buildAuditArtifact(input), null, 2)}\n`;
}

module.exports = {
  buildAuditArtifact,
  toAuditArtifactJson,
};