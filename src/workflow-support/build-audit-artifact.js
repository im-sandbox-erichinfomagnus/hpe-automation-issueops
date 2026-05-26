'use strict';

const { unwrapCodeFence } = require('./normalize-requested-repositories');

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasPopulatedString(value) {
  return typeof value === 'string' && unwrapCodeFence(value).trim() !== '';
}

function determineOperation(request = {}, runContext = {}) {
  const explicitOperation = runContext.operation || request.operation;
  if (explicitOperation) {
    return explicitOperation;
  }

  const isTenantCreation = Boolean(
    request.tenant_key ||
      request.tenant_display_name ||
      (request.tenant_team_slug && request.repo_admin_team_slug)
  );

  if (isTenantCreation) {
    return 'tenant_creation';
  }

  const isTeamHierarchy = Boolean(
    request.parent_team_slug ||
      request.parent_team_name ||
      hasNonEmptyArray(request.requested_child_links) ||
      hasNonEmptyArray(request.duplicate_child_teams) ||
      hasNonEmptyArray(request.conflicting_child_slugs) ||
      hasNonEmptyArray(request.invalid_child_teams)
  );

  if (isTeamHierarchy) {
    return 'team_hierarchy';
  }

  const isTeamRepoAccess = Boolean(
    request.requested_permission_api_value ||
      request.requested_permission_label ||
      (request.team_slug && request.designated_approver_login) ||
      hasNonEmptyArray(request.requested_repository_grants) ||
      hasNonEmptyArray(request.duplicate_repositories) ||
      hasNonEmptyArray(request.conflicting_repositories) ||
      hasNonEmptyArray(request.invalid_repositories)
  );

  if (isTeamRepoAccess) {
    return 'team_repo_access';
  }

  const isTeamCreation = Boolean(
    request.intended_owner_login ||
      hasNonEmptyArray(request.requested_teams) ||
      hasNonEmptyArray(request.requested_team_detail) ||
      hasNonEmptyArray(request.duplicate_team_names) ||
      hasNonEmptyArray(request.conflicting_slugs) ||
      hasNonEmptyArray(request.invalid_team_names)
  );

  if (isTeamCreation) {
    return 'team_creation';
  }

  return 'team_membership';
}

function inferRequestIntakeMode(request = {}, operation = determineOperation(request)) {
  if (request.intake_mode) {
    return request.intake_mode;
  }

  if (request.accepted_attachment_submission && request.accepted_attachment_submission.attachment_url) {
    return 'csv_attachment';
  }

  const hasBulkCsvSignals = (
    hasPopulatedString(request.bulk_csv_input) ||
    hasNonEmptyArray(request.csv_row_findings) ||
    (request.bulk_csv_submission && request.bulk_csv_submission.schema_status && request.bulk_csv_submission.schema_status !== 'not_provided')
  );
  const hasManualSignals = (
    operation === 'team_creation' && (
      hasPopulatedString(request.requested_team_names_input) ||
      hasNonEmptyArray(request.requested_teams) ||
      hasNonEmptyArray(request.requested_team_detail)
    )
  ) || (
    operation === 'team_membership' && (
      hasPopulatedString(request.requested_people_input) ||
      hasNonEmptyArray(request.requested_people)
    )
  ) || (
    operation === 'team_hierarchy' && (
      hasPopulatedString(request.requested_child_teams_input) ||
      hasNonEmptyArray(request.requested_child_links) ||
      hasNonEmptyArray(request.requested_child_link_detail)
    )
  ) || (
    operation === 'team_repo_access' && (
      hasPopulatedString(request.requested_repositories_input) ||
      hasNonEmptyArray(request.requested_repository_grants) ||
      Boolean(request.requested_permission_api_value)
    )
  );

  if (hasBulkCsvSignals && hasManualSignals) {
    return null;
  }

  if (hasBulkCsvSignals) {
    return 'bulk_csv';
  }

  if (hasManualSignals) {
    return 'manual';
  }

  return null;
}

function buildDefaultRepoAccessBulkCsvSubmission(rawInput = '') {
  return {
    encoding: 'utf-8',
    header_columns: [],
    required_columns: ['repository'],
    unsupported_columns: [],
    row_count: 0,
    valid_row_count: 0,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'not_provided',
    schema_errors: [],
    raw_input: rawInput,
    csv_row_findings: [],
    csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
  };
}

function buildAuditArtifact(input = {}) {
  const request = input.request || {};
  const validation = input.validation || {};
  const assignment = input.assignment || {};
  const approval = input.approval || {};
  const reconciliationPlan = input.reconciliationPlan || input.reconciliation_plan || {};
  const executionOutcome = input.executionOutcome || input.execution_outcome || {};
  const runContext = input.runContext || input.run_context || {};
  const operation = determineOperation(request, runContext);
  const intakeMode = inferRequestIntakeMode(request, operation);

  return {
    request: {
      request_id: request.request_id,
      issue_number: request.issue_number,
      repository: request.repository,
      requester_login: request.requester_login,
      organization: request.organization,
      tenant_display_name: request.tenant_display_name,
      tenant_key: request.tenant_key,
      tenant_team_name: request.tenant_team_name,
      tenant_team_slug: request.tenant_team_slug,
      repo_admin_team_name: request.repo_admin_team_name,
      repo_admin_team_slug: request.repo_admin_team_slug,
      team_slug: request.team_slug,
      intake_mode: intakeMode,
      requested_repositories_input: request.requested_repositories_input || '',
      requested_people_input: request.requested_people_input || '',
      requested_team_names_input: request.requested_team_names_input || '',
      bulk_csv_input: request.bulk_csv_input || '',
      accepted_attachment_submission: request.accepted_attachment_submission || null,
      attachment_validation_attempt: request.attachment_validation_attempt || null,
      bulk_csv_submission: request.bulk_csv_submission || validation.bulk_csv_submission || (
        operation === 'team_repo_access' ? buildDefaultRepoAccessBulkCsvSubmission(request.bulk_csv_input || '') : null
      ),
      team_name: request.team_name,
      parent_team_slug: request.parent_team_slug,
      parent_team_name: request.parent_team_name,
      requested_child_teams_input: request.requested_child_teams_input || '',
      requested_people: request.requested_people,
      requested_people_detail: request.requested_people_detail || [],
      csv_row_findings: request.csv_row_findings || validation.csv_row_findings || [],
      csv_row_numbering_convention: request.csv_row_numbering_convention || validation.csv_row_numbering_convention || null,
      intended_owner_login: request.intended_owner_login,
      designated_approver_login: request.designated_approver_login,
      requested_permission_label: request.requested_permission_label,
      requested_permission_api_value: request.requested_permission_api_value,
      requested_repository_grants: request.requested_repository_grants || [],
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
      duplicate_repositories: request.duplicate_repositories || [],
      conflicting_repositories: request.conflicting_repositories || [],
      invalid_repositories: request.invalid_repositories || [],
      dry_run: request.dry_run,
      submitted_at: request.submitted_at,
    },
    validation: {
      is_valid: validation.is_valid,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      accepted_attachment_submission: validation.accepted_attachment_submission || null,
      attachment_validation_attempt: validation.attachment_validation_attempt || null,
      attachment_rate_limit_snapshot: validation.attachment_rate_limit_snapshot || null,
      team_exists: validation.team_exists,
      team_sync_blocked: validation.team_sync_blocked,
      bulk_csv_submission: validation.bulk_csv_submission || null,
      csv_row_findings: validation.csv_row_findings || [],
      csv_row_numbering_convention: validation.csv_row_numbering_convention || null,
      requested_people: validation.requested_people || [],
      organization_visible: validation.organization_visible,
      designated_approver_authorization: validation.designated_approver_authorization || null,
      requester_eligibility: validation.requester_eligibility || null,
      validation_findings: validation.validation_findings || null,
      no_mutation_planned:
        Boolean(request.dry_run) ||
        ['submitted', 'awaiting_approval', 'validation_failed', 'waiting_for_attachment'].includes(String(request.request_status || '')),
      requested_repository_grants: validation.requested_repository_grants || [],
      already_satisfied_repository_grants: validation.already_satisfied_repository_grants || [],
      intended_owner_membership: validation.intended_owner_membership || null,
      requested_teams: validation.requested_teams || [],
      existing_teams: validation.existing_teams || [],
      parent_team_exists: validation.parent_team_exists,
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
      accepted_attachment_submission: reconciliationPlan.accepted_attachment_submission || null,
      attachment_validation_attempt: reconciliationPlan.attachment_validation_attempt || null,
      current_members: reconciliationPlan.current_members || [],
      people_to_add: reconciliationPlan.people_to_add || [],
      people_already_present: reconciliationPlan.people_already_present || [],
      people_rejected: reconciliationPlan.people_rejected || [],
      organization_exists: reconciliationPlan.organization_exists,
      team_exists: reconciliationPlan.team_exists,
      repositories_to_grant: reconciliationPlan.repositories_to_grant || [],
      repositories_already_satisfied: reconciliationPlan.repositories_already_satisfied || [],
      repositories_rejected: reconciliationPlan.repositories_rejected || [],
      permission_strength_ladder: reconciliationPlan.permission_strength_ladder || [],
      parent_team_exists: reconciliationPlan.parent_team_exists,
      teams_to_create: reconciliationPlan.teams_to_create || [],
      teams_already_present: reconciliationPlan.teams_already_present || [],
      teams_rejected: reconciliationPlan.teams_rejected || [],
      intake_mode: reconciliationPlan.intake_mode || intakeMode,
      child_links_to_apply: reconciliationPlan.child_links_to_apply || [],
      child_links_already_present: reconciliationPlan.child_links_already_present || [],
      child_links_rejected: reconciliationPlan.child_links_rejected || [],
      requester_bootstrap_action: reconciliationPlan.requester_bootstrap_action || null,
      registry_persistence_action: reconciliationPlan.registry_persistence_action || null,
      registry_persistence_result: reconciliationPlan.registry_persistence_result || null,
      dry_run: reconciliationPlan.dry_run,
      rate_limit_snapshot: reconciliationPlan.rate_limit_snapshot || null,
      state: reconciliationPlan.state || '',
    },
    execution: executionOutcome,
    metadata: {
      run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
      run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
      generated_at: new Date().toISOString(),
      operation,
    },
  };
}

function toAuditArtifactJson(input = {}) {
  return `${JSON.stringify(buildAuditArtifact(input), null, 2)}\n`;
}

module.exports = {
  buildAuditArtifact,
  determineOperation,
  inferRequestIntakeMode,
  toAuditArtifactJson,
};