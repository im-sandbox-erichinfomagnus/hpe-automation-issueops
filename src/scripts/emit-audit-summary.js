'use strict';

const fs = require('fs');
const path = require('path');

const { determineOperation } = require('../workflow-support/build-audit-artifact');

function readBulkCsvCount(executionValue, submissionValue) {
  return executionValue ?? submissionValue ?? 0;
}

function formatAuditSummary(auditArtifact = {}) {
  const request = auditArtifact.request || {};
  const validation = auditArtifact.validation || {};
  const assignment = auditArtifact.assignment || {};
  const approval = auditArtifact.approval || {};
  const reconciliation = auditArtifact.reconciliation || {};
  const execution = auditArtifact.execution || {};
  const metadata = auditArtifact.metadata || {};
  const operation = metadata.operation || determineOperation(request);
  const isBulkCsv = request.intake_mode === 'bulk_csv';
  const isCsvAttachment = request.intake_mode === 'csv_attachment';
  const isTeamRepoAccess = operation === 'team_repo_access';
  const isTeamRepoAccessRemoval = operation === 'team_repo_access_removal';
  const isTeamHierarchy = operation === 'team_hierarchy';
  const isTeamCreation = operation === 'team_creation';

  const hierarchyApprovalState = approval.approver_authorization_state && approval.approver_authorization_state !== 'unknown'
    ? approval.approver_authorization_state
    : validation.designated_approver_authorization
      ? validation.designated_approver_authorization.state || 'unknown'
      : 'n/a';
  const repoAccessApprovalState = approval.approver_authorization_state && approval.approver_authorization_state !== 'unknown'
    ? approval.approver_authorization_state
    : validation.designated_approver_authorization
      ? validation.designated_approver_authorization.state || 'unknown'
      : 'n/a';

  const isTenantRepoCreation = operation === 'tenant_repo_creation' || Boolean(request.repository_name_normalized || request.repository_name_input);

  if (isTenantRepoCreation) {
    return [
      '# Create Tenant Repositories Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Tenant name: ${request.tenant_name_input || request.tenant_display_name || 'n/a'}`,
      `- Target repository name: ${request.repository_name_normalized || request.repository_name_input || 'n/a'}`,
      `- Requested repository visibility: ${request.repository_visibility || 'not_provided'}`,
      `- Repository visibility source: ${request.repository_visibility_source || 'not_provided'}`,
      request.primary_contact
        ? `- Primary contact: ${request.primary_contact} (${request.primary_contact_type || 'unknown'})`
        : '- Primary contact: (not provided)',
      request.secondary_contact
        ? `- Secondary contact: ${request.secondary_contact} (${request.secondary_contact_type || 'unknown'})`
        : '- Secondary contact: (not provided)',
      `- Existing repository visibility: ${reconciliation.existing_visibility || 'n/a'}`,
      `- Actual repository visibility: ${reconciliation.actual_visibility || 'n/a'}`,
      `- Visibility conflict: ${reconciliation.visibility_conflict ? 'true' : 'false'}`,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Dry-run mode: ${request.dry_run ? 'true' : 'false'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_authorization_state || 'unknown'})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      approval.approved_context_marker ? `- Approved context marker: ${approval.approved_context_marker}` : null,
      approval.latest_context_marker ? `- Latest context marker: ${approval.latest_context_marker}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      `- Visibility validation status: ${validation.validation_findings && validation.validation_findings.visibility_validation_status || 'unknown'}`,
      `- Visibility validation reason: ${validation.validation_findings && validation.validation_findings.visibility_validation_reason || 'n/a'}`,
      `- Allowed repository visibilities: ${validation.validation_findings && Array.isArray(validation.validation_findings.allowed_repository_visibilities) ? validation.validation_findings.allowed_repository_visibilities.join(', ') : 'private, internal, public'}`,
      `- Tenant resolution: ${validation.tenant_resolution && validation.tenant_resolution.tenant_resolution_status || 'unknown'}`,
      `- Tenant matches: ${validation.tenant_resolution && validation.tenant_resolution.tenant_match_count || 0}`,
      `- Topology mode: ${validation.validation_findings && validation.validation_findings.topology_mode || 'unknown'}`,
      `- Canonical fields consulted: ${validation.validation_findings && Array.isArray(validation.validation_findings.canonical_fields_consulted) && validation.validation_findings.canonical_fields_consulted.length > 0 ? validation.validation_findings.canonical_fields_consulted.join(', ') : 'n/a'}`,
      `- Canonical topology validation: ${validation.validation_findings && validation.validation_findings.canonical_topology_validation_status || 'n/a'}`,
      `- Tenant parent team: ${request.tenant_team_slug || 'n/a'}`,
      `- Tenant repo-admin team: ${request.repo_admin_team_slug || 'n/a'}`,
      `- Context marker: ${request.context_marker || validation.validation_findings && validation.validation_findings.context_marker || 'n/a'}`,
      `- Repository exists: ${validation.repository_exists ? 'true' : 'false'}`,
      `- Current repo-admin permission: ${validation.current_repo_admin_permission || 'unknown'}`,
      `- Planned creation action: ${reconciliation.creation_action || 'n/a'}`,
      `- Planned permission action: ${reconciliation.permission_action || 'n/a'}`,
      `- Planned custom properties action: ${reconciliation.custom_properties_action || 'n/a'}`,
      `- Blocked reason: ${reconciliation.blocked_reason || 'n/a'}`,
      `- Direct admin avoidance: ${reconciliation.direct_admin_avoidance || 'n/a'}`,
      `- Boundary revalidation: ${reconciliation.boundary_revalidation_status || 'n/a'}`,
      `- Dry-run validation evidence: ${request.no_mutation_evidence && request.no_mutation_evidence.mode ? request.no_mutation_evidence.mode : (validation.no_mutation_planned ? 'validation_only' : 'n/a')}`,
      `- Repository creation result: ${execution.repository_creation_result || 'n/a'}`,
      `- Repo-admin grant result: ${execution.repo_admin_grant_result || 'n/a'}`,
      `- Repository custom properties result: ${execution.repository_custom_properties_result || 'n/a'}`,
      `- Execution context marker: ${execution.execution_context_marker || 'n/a'}`,
      `- Context binding status: ${execution.context_binding_status || 'unknown'}`,
      `- Execution topology mode: ${execution.topology_mode || validation.validation_findings && validation.validation_findings.topology_mode || 'unknown'}`,
      `- Execution tenant identifier: ${execution.tenant_id || validation.canonical_tenant_context && (validation.canonical_tenant_context.tenant_id || validation.canonical_tenant_context.tenant_key) || 'n/a'}`,
      `- Execution tenant team slug: ${execution.tenant_team_slug || validation.canonical_tenant_context && validation.canonical_tenant_context.tenant_team_slug || 'n/a'}`,
      `- Execution repo-admin team slug: ${execution.repo_admin_team_slug || validation.canonical_tenant_context && validation.canonical_tenant_context.repo_admin_team_slug || 'n/a'}`,
      execution.mutation_token_source
        ? `- Mutation token source: ${execution.mutation_token_source} (${execution.mutation_token_kind || 'unknown'}, pat_backed=${execution.mutation_token_is_pat_backed ? 'true' : 'false'})`
        : null,
      execution.repository_custom_properties_failure_reason
        ? `- Repository custom properties failure reason: ${execution.repository_custom_properties_failure_reason}`
        : null,
      execution.repository_custom_properties_failure_status_code
        ? `- Repository custom properties failure status code: ${execution.repository_custom_properties_failure_status_code}`
        : null,
      execution.repository_custom_properties_failure_detail
        ? `- Repository custom properties failure detail: ${execution.repository_custom_properties_failure_detail}`
        : null,
      `- Audit persistence result: ${execution.audit_persistence_result || 'n/a'}`,
      `- Added: ${execution.mutation_count || 0}`,
      `- No-op: ${execution.noop_count || 0}`,
      `- Pending: ${execution.pending_count || 0}`,
      `- Failed: ${execution.failure_count || 0}`,
      `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
      metadata.artifact_name ? `- Audit artifact name: ${metadata.artifact_name}` : null,
      metadata.artifact_retention_days != null ? `- Audit artifact retention (days): ${metadata.artifact_retention_days}` : null,
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
          ? 'Request is approved and eligible for tenant repository execution. No repository mutation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No tenant repository mutation was attempted.'
            : 'Request is validated and ready for approval. No tenant repository mutation was attempted.'
        : 'Request validation failed. No tenant repository mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  const isHostedRunnerCreation = operation === 'hosted_runner_creation' || (!['hosted_runner_deletion', 'hosted_runner_move'].includes(operation) && Boolean(request.runner_image_id || request.runner_size));
  const isHostedRunnerMove = operation === 'hosted_runner_move' || Boolean(request.runner_move_scope || request.target_runner_group_name_input);
  const isHostedRunnerDeletion = operation === 'hosted_runner_deletion' || (!isHostedRunnerCreation && !isHostedRunnerMove && Boolean(request.runner_deletion_scope));
  const isRunnerGroupCreation = operation === 'runner_group_creation' || Boolean(request.runner_group_name_derived || request.runner_group_base_name_input);

  if (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove) {
    return [
      isHostedRunnerMove
        ? '# Move Tenant GitHub-Hosted Runner Workflow Summary'
        : isHostedRunnerDeletion
        ? '# Delete Tenant GitHub-Hosted Runner Workflow Summary'
        : '# Create Tenant GitHub-Hosted Runner Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Tenant name: ${request.tenant_name_input || request.tenant_display_name || 'n/a'}`,
      `- Runner base name: ${request.runner_base_name_input || 'n/a'}`,
      `- Derived runner name: ${request.runner_name_derived || 'n/a'}`,
      isHostedRunnerMove ? `- Requested hosted runner id: ${request.hosted_runner_id_input ?? 'not provided'}` : null,
      isHostedRunnerMove ? `- Target runner group: ${request.target_runner_group_name_input || 'n/a'}` : null,
      isHostedRunnerCreation ? `- Runner image: ${request.runner_image_id || 'n/a'} (${request.runner_image_source || 'github'})` : null,
      isHostedRunnerCreation ? `- Runner machine size: ${request.runner_size || 'n/a'}` : null,
      isHostedRunnerCreation ? `- Requested runner group: ${request.runner_group_name_input || 'organization default'}` : null,
      isHostedRunnerCreation && validation.runner_group_resolution
        ? `- Runner group resolution: ${validation.runner_group_resolution.resolution_status || 'unknown'}${validation.runner_group_resolution.resolved_group_name ? ` (${validation.runner_group_resolution.resolved_group_name} #${validation.runner_group_resolution.resolved_group_id})` : ''}`
        : null,
      isHostedRunnerCreation && request.maximum_runners != null ? `- Maximum runners: ${request.maximum_runners}` : null,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Dry-run mode: ${request.dry_run ? 'true' : 'false'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_authorization_state || 'unknown'})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      approval.approved_context_marker ? `- Approved context marker: ${approval.approved_context_marker}` : null,
      approval.latest_context_marker ? `- Latest context marker: ${approval.latest_context_marker}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      `- Tenant resolution: ${validation.tenant_resolution && validation.tenant_resolution.tenant_resolution_status || 'unknown'}`,
      `- Tenant matches: ${validation.tenant_resolution && validation.tenant_resolution.tenant_match_count || 0}`,
      `- Tenant parent team: ${request.tenant_team_slug || 'n/a'}`,
      `- Tenant CI/CD admin team: ${request.cicd_admin_team_slug || 'n/a'}`,
      `- Requester CI/CD membership: ${validation.validation_findings && validation.validation_findings.requester_cicd_membership_state || 'unknown'}`,
      `- Context marker: ${request.context_marker || validation.validation_findings && validation.validation_findings.context_marker || 'n/a'}`,
      `- Runner exists: ${validation.runner_exists ? 'true' : 'false'}`,
      validation.existing_runner_id != null ? `- Existing runner id: ${validation.existing_runner_id}` : null,
      isHostedRunnerMove ? `- Runner resolution: ${validation.runner_resolution_status || 'unknown'}` : null,
      isHostedRunnerMove ? `- Current runner group id: ${validation.current_runner_group_id ?? 'n/a'}` : null,
      isHostedRunnerMove && validation.target_runner_group_resolution
        ? `- Target runner group resolution: ${validation.target_runner_group_resolution.resolution_status || 'unknown'}${validation.target_runner_group_resolution.resolved_group_name ? ` (${validation.target_runner_group_resolution.resolved_group_name} #${validation.target_runner_group_resolution.resolved_group_id})` : ''}`
        : null,
      isHostedRunnerDeletion && validation.existing_runner_status ? `- Existing runner status: ${validation.existing_runner_status}` : null,
      isHostedRunnerCreation
        ? `- Planned creation action: ${reconciliation.creation_action || 'n/a'}`
        : isHostedRunnerMove
          ? `- Planned move action: ${reconciliation.move_action || 'n/a'}`
          : `- Planned deletion action: ${reconciliation.deletion_action || 'n/a'}`,
      `- Blocked reason: ${reconciliation.blocked_reason || 'n/a'}`,
      `- Boundary revalidation: ${reconciliation.boundary_revalidation_status || 'n/a'}`,
      isHostedRunnerCreation
        ? `- Runner creation result: ${execution.runner_creation_result || 'n/a'}`
        : isHostedRunnerMove
          ? `- Runner move result: ${execution.runner_move_result || 'n/a'}`
          : `- Runner deletion result: ${execution.runner_deletion_result || 'n/a'}`,
      execution.created_runner_id != null ? `- Created runner id: ${execution.created_runner_id}` : null,
      execution.created_runner_status ? `- Created runner status: ${execution.created_runner_status}` : null,
      isHostedRunnerMove && execution.moved_runner_id != null ? `- Moved runner id: ${execution.moved_runner_id}` : null,
      isHostedRunnerMove && execution.target_runner_group_id != null ? `- Target runner group id: ${execution.target_runner_group_id}` : null,
      `- Audit persistence result: ${execution.audit_persistence_result || 'n/a'}`,
      `- Added: ${execution.mutation_count || 0}`,
      `- No-op: ${execution.noop_count || 0}`,
      `- Pending: ${execution.pending_count || 0}`,
      `- Failed: ${execution.failure_count || 0}`,
      `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
      metadata.artifact_name ? `- Audit artifact name: ${metadata.artifact_name}` : null,
      metadata.artifact_retention_days != null ? `- Audit artifact retention (days): ${metadata.artifact_retention_days}` : null,
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
          ? 'Request is approved and eligible for tenant hosted-runner execution. No runner mutation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No tenant hosted-runner mutation was attempted.'
            : 'Request is validated and ready for approval. No tenant hosted-runner mutation was attempted.'
        : 'Request validation failed. No tenant hosted-runner mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  if (isRunnerGroupCreation) {
    return [
      '# Create Tenant Runner Group Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Tenant name: ${request.tenant_name_input || request.tenant_display_name || 'n/a'}`,
      `- Runner group base name: ${request.runner_group_base_name_input || 'n/a'}`,
      `- Derived runner group name: ${request.runner_group_name_derived || 'n/a'}`,
      `- Requested visibility: ${request.runner_group_visibility || 'selected'}`,
      `- Allows public repositories: ${request.allows_public_repositories ? 'true' : 'false'}`,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Dry-run mode: ${request.dry_run ? 'true' : 'false'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_authorization_state || 'unknown'})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      approval.approved_context_marker ? `- Approved context marker: ${approval.approved_context_marker}` : null,
      approval.latest_context_marker ? `- Latest context marker: ${approval.latest_context_marker}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      `- Tenant resolution: ${validation.tenant_resolution && validation.tenant_resolution.tenant_resolution_status || 'unknown'}`,
      `- Tenant matches: ${validation.tenant_resolution && validation.tenant_resolution.tenant_match_count || 0}`,
      `- Tenant parent team: ${request.tenant_team_slug || 'n/a'}`,
      `- Tenant CI/CD admin team: ${request.cicd_admin_team_slug || 'n/a'}`,
      `- Requester CI/CD membership: ${validation.validation_findings && validation.validation_findings.requester_cicd_membership_state || 'unknown'}`,
      `- Context marker: ${request.context_marker || validation.validation_findings && validation.validation_findings.context_marker || 'n/a'}`,
      `- Runner group exists: ${validation.runner_group_exists ? 'true' : 'false'}`,
      validation.existing_runner_group_id != null ? `- Existing runner group id: ${validation.existing_runner_group_id}` : null,
      `- Planned creation action: ${reconciliation.creation_action || 'n/a'}`,
      `- Blocked reason: ${reconciliation.blocked_reason || 'n/a'}`,
      `- Boundary revalidation: ${reconciliation.boundary_revalidation_status || 'n/a'}`,
      `- Runner group creation result: ${execution.runner_group_creation_result || 'n/a'}`,
      execution.created_runner_group_id != null ? `- Created runner group id: ${execution.created_runner_group_id}` : null,
      `- Audit persistence result: ${execution.audit_persistence_result || 'n/a'}`,
      `- Added: ${execution.mutation_count || 0}`,
      `- No-op: ${execution.noop_count || 0}`,
      `- Pending: ${execution.pending_count || 0}`,
      `- Failed: ${execution.failure_count || 0}`,
      `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
      metadata.artifact_name ? `- Audit artifact name: ${metadata.artifact_name}` : null,
      metadata.artifact_retention_days != null ? `- Audit artifact retention (days): ${metadata.artifact_retention_days}` : null,
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
          ? 'Request is approved and eligible for tenant runner-group execution. No runner-group mutation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No tenant runner-group mutation was attempted.'
            : 'Request is validated and ready for approval. No tenant runner-group mutation was attempted.'
        : 'Request validation failed. No tenant runner-group mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  const isTenantCreation = operation === 'tenant_creation' || Boolean(request.tenant_key || request.tenant_display_name);

  if (isTenantCreation) {
    return [
      '# Create Tenant Model Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Tenant: ${request.tenant_display_name || 'n/a'} (${request.tenant_key || 'n/a'})`,
      `- Tenant type: ${request.tenant_type || 'n/a'}`,
      `- Topology root team: ${request.topology && request.topology.teams && request.topology.teams.tenantRootTeam || 'n/a'}`,
      `- Topology nodes: ${request.topology && request.topology.teams && Array.isArray(request.topology.teams.structure) ? request.topology.teams.structure.length : 0}`,
      `- External mappings: cmdb=${request.external_mappings && request.external_mappings.cmdb_id || 'n/a'}, cost_center=${request.external_mappings && request.external_mappings.cost_center || 'n/a'}, business_unit=${request.external_mappings && request.external_mappings.business_unit || 'n/a'}, environment=${request.external_mappings && request.external_mappings.environment || 'n/a'}`,
      `- Contacts: primary=${request.primary_contact || 'n/a'}, secondary=${request.secondary_contact || 'n/a'}`,
      `- Compatibility mode: ${request.compatibility && request.compatibility.mode || 'canonical'}`,
      `- Lifecycle status equivalent: ${request.lifecycle_status_equivalent || request.compatibility && request.compatibility.lifecycle_status_equivalent || 'active'}`,
      `- Compatibility provenance: source_issue=${request.compatibility && request.compatibility.provenance && request.compatibility.provenance.source_issue_number || 'n/a'}, source_run=${request.compatibility && request.compatibility.provenance && request.compatibility.provenance.source_run_id || 'n/a'}`,
      `- Tenant parent team: ${request.tenant_team_slug || 'n/a'}`,
      `- Tenant repo-admin team: ${request.repo_admin_team_slug || 'n/a'}`,
      `- Tenant CICD-admin team: ${request.cicd_admin_team_slug || 'n/a'}`,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Requester: ${request.requester_login || 'n/a'}`,
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Dry-run mode: ${request.dry_run ? 'true' : 'false'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_authorization_state || 'unknown'})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      `- Teams to create: ${(reconciliation.teams_to_create || []).length}`,
      `- Teams already present: ${(reconciliation.teams_already_present || []).length}`,
      `- Child links to apply: ${(reconciliation.child_links_to_apply || []).length}`,
      `- CICD team requested: ${reconciliation.cicd_admin_team_requested ? 'true' : 'false'}`,
      `- CICD team create planned: ${reconciliation.cicd_admin_team_create_planned ? 'true' : 'false'}`,
      `- CICD team already present: ${reconciliation.cicd_admin_team_already_present ? 'true' : 'false'}`,
      `- Requester bootstrap action: ${reconciliation.requester_bootstrap_action || 'n/a'}`,
      `- CICD capability action: ${reconciliation.cicd_capability_action || 'n/a'}`,
      `- CICD capability selected path: ${reconciliation.cicd_capability_decision && reconciliation.cicd_capability_decision.selected_path || 'n/a'}`,
      `- CICD capability status: ${reconciliation.cicd_capability_decision && reconciliation.cicd_capability_decision.status || 'n/a'}`,
      `- CICD capability reason code: ${reconciliation.cicd_capability_decision && reconciliation.cicd_capability_decision.reason_code || 'n/a'}`,
      `- CICD topology update action: ${reconciliation.cicd_topology_update_action || 'n/a'}`,
      `- CICD topology update result: ${reconciliation.cicd_topology_update_result && reconciliation.cicd_topology_update_result.status || 'n/a'}`,
      `- Registry persistence action: ${reconciliation.registry_persistence_action || 'n/a'}`,
      `- No-mutation intent: ${validation.no_mutation_planned ? 'true' : 'false'}`,
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
          ? 'Request is approved and eligible for tenant bootstrap execution. No tenant mutation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No tenant mutation was attempted.'
            : 'Request is validated and ready for approval. No tenant mutation was attempted.'
        : 'Request validation failed. No tenant mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  if (isTeamRepoAccessRemoval) {
    return [
      '# Remove Team Repository Access Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Target team: ${request.team_slug || request.team_name || 'n/a'}`,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Requester: ${request.requester_login || 'n/a'}`,
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${repoAccessApprovalState})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      isCsvAttachment && request.request_status === 'waiting_for_attachment'
        ? '- Attachment status: waiting for requester CSV attachment comment'
        : null,
      `- Repositories requested: ${(request.requested_repository_removals || []).length}`,
      `- Removed repositories: ${execution.removed_count || execution.mutation_count || 0}`,
      `- No-op repositories: ${execution.noop_count || (reconciliation.already_absent_noops || []).length || 0}`,
      `- Rejected repositories: ${execution.rejected_count || (reconciliation.rejected_items || []).length || 0}`,
      `- Failed repositories: ${execution.failure_count || 0}`,
      `- Rollback status: ${execution.rollback_status || 'not_needed'}`,
      validation.warnings && validation.warnings.length > 0
        ? `- Validation warnings: ${validation.warnings.join('; ')}`
        : null,
      validation.errors && validation.errors.length > 0
        ? `- Validation errors: ${validation.errors.join('; ')}`
        : null,
      assignment.assignment_note ? `- Assignment note: ${assignment.assignment_note}` : null,
      assignment.assignment_status === 'assigned'
        ? '- Assignment semantics: routing only (never grants approval)'
        : null,
      approval.decision_note ? `- Approval note: ${approval.decision_note}` : null,
      '',
      execution.summary || (request.request_status === 'waiting_for_attachment'
        ? 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.'
        : validation.is_valid
          ? approval.approval_status === 'approved'
            ? 'Request is approved and eligible for repository-access removal execution. No repository-access mutation was attempted in this phase.'
            : approval.approval_status === 'denied'
              ? 'Approval was denied or invalid. No repository-access mutation was attempted.'
              : 'Request is validated and ready for approval. No repository-access mutation was attempted.'
          : 'Request validation failed. No repository-access mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

  if (isTeamRepoAccess) {
    return [
      '# Add Team Repository Access Workflow Summary',
      '',
      `- Request ID: ${request.request_id || 'n/a'}`,
      `- Repository: ${request.repository || 'n/a'}`,
      `- Target organization: ${request.organization || 'n/a'}`,
      `- Target team: ${request.team_slug || request.team_name || 'n/a'}`,
      `- Requested permission: ${request.requested_permission_label || request.requested_permission_api_value || 'n/a'}`,
      `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
      `- Requester: ${request.requester_login || 'n/a'}`,
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${repoAccessApprovalState})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      isCsvAttachment && request.request_status === 'waiting_for_attachment'
        ? '- Attachment status: waiting for requester CSV attachment comment'
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.attachment_url
        ? `- Attachment URL: ${request.accepted_attachment_submission.attachment_url}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.comment_id
        ? `- Attachment comment ID: ${request.accepted_attachment_submission.comment_id}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.uploader_login
        ? `- Attachment uploader: ${request.accepted_attachment_submission.uploader_login}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.filename
        ? `- Attachment filename: ${request.accepted_attachment_submission.filename}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.content_hash
        ? `- Attachment content hash: ${request.accepted_attachment_submission.content_hash}`
        : null,
      isBulkCsv
        ? `- CSV row findings: ${(validation.csv_row_findings || request.csv_row_findings || []).length}`
        : null,
      (isBulkCsv || isCsvAttachment)
        ? `- CSV duplicate rows: ${readBulkCsvCount(execution.duplicate_row_count, request.bulk_csv_submission?.duplicate_row_count)}`
        : null,
      (isBulkCsv || isCsvAttachment)
        ? `- CSV invalid rows: ${readBulkCsvCount(execution.invalid_row_count, request.bulk_csv_submission?.invalid_row_count)}`
        : null,
      isBulkCsv && request.csv_row_numbering_convention
        ? `- CSV row numbering: ${request.csv_row_numbering_convention}`
        : null,
      `- Repositories requested: ${(request.requested_repository_grants || []).length}`,
      `- Granted repositories: ${execution.granted_count || execution.mutation_count || 0}`,
      `- No-op repositories: ${execution.noop_count || (reconciliation.repositories_already_satisfied || []).length || 0}`,
      `- Rejected repositories: ${execution.rejected_count || (reconciliation.repositories_rejected || []).length || 0}`,
      `- Failed repositories: ${execution.failure_count || 0}`,
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
          ? 'Request is approved and eligible for repository-access execution. No repository-access mutation was attempted in this phase.'
          : approval.approval_status === 'denied'
            ? 'Approval was denied or invalid. No repository-access mutation was attempted.'
            : 'Request is validated and ready for approval. No repository-access mutation was attempted.'
        : 'Request validation failed. No repository-access mutation was attempted.'),
    ].filter(Boolean).join('\n');
  }

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
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${hierarchyApprovalState})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      isCsvAttachment && request.request_status === 'waiting_for_attachment'
        ? '- Attachment status: waiting for requester CSV attachment comment'
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.attachment_url
        ? `- Attachment URL: ${request.accepted_attachment_submission.attachment_url}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.comment_id
        ? `- Attachment comment ID: ${request.accepted_attachment_submission.comment_id}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.uploader_login
        ? `- Attachment uploader: ${request.accepted_attachment_submission.uploader_login}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.filename
        ? `- Attachment filename: ${request.accepted_attachment_submission.filename}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.content_hash
        ? `- Attachment content hash: ${request.accepted_attachment_submission.content_hash}`
        : null,
      (isBulkCsv || isCsvAttachment)
        ? `- CSV row findings: ${(validation.csv_row_findings || request.csv_row_findings || []).length}`
        : null,
      (isBulkCsv || isCsvAttachment)
        ? `- CSV duplicate rows: ${readBulkCsvCount(execution.duplicate_row_count, request.bulk_csv_submission?.duplicate_row_count)}`
        : null,
      (isBulkCsv || isCsvAttachment)
        ? `- CSV invalid rows: ${readBulkCsvCount(execution.invalid_row_count, request.bulk_csv_submission?.invalid_row_count)}`
        : null,
      (isBulkCsv || isCsvAttachment) && request.csv_row_numbering_convention
        ? `- CSV row numbering: ${request.csv_row_numbering_convention}`
        : null,
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
      `- Intake mode: ${request.intake_mode || 'n/a'}`,
      `- Request status: ${request.request_status || 'submitted'}`,
      `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
      `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_role || 'n/a'})`,
      approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
      `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
      isCsvAttachment && request.request_status === 'waiting_for_attachment'
        ? '- Attachment status: waiting for requester CSV attachment comment'
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.attachment_url
        ? `- Attachment URL: ${request.accepted_attachment_submission.attachment_url}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.comment_id
        ? `- Attachment comment ID: ${request.accepted_attachment_submission.comment_id}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.uploader_login
        ? `- Attachment uploader: ${request.accepted_attachment_submission.uploader_login}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.filename
        ? `- Attachment filename: ${request.accepted_attachment_submission.filename}`
        : null,
      isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.content_hash
        ? `- Attachment content hash: ${request.accepted_attachment_submission.content_hash}`
        : null,
      isBulkCsv
        || isCsvAttachment
        ? `- CSV row findings: ${(validation.csv_row_findings || request.csv_row_findings || []).length}`
        : null,
      isBulkCsv || isCsvAttachment
        ? `- CSV valid rows: ${request.bulk_csv_submission?.valid_row_count ?? 0}`
        : null,
      isBulkCsv || isCsvAttachment
        ? `- CSV duplicate rows: ${readBulkCsvCount(execution.duplicate_row_count, request.bulk_csv_submission?.duplicate_row_count)}`
        : null,
      isBulkCsv || isCsvAttachment
        ? `- CSV invalid rows: ${readBulkCsvCount(execution.invalid_row_count, request.bulk_csv_submission?.invalid_row_count)}`
        : null,
      (isBulkCsv || isCsvAttachment) && request.csv_row_numbering_convention
        ? `- CSV row numbering: ${request.csv_row_numbering_convention}`
        : null,
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
      execution.summary || (request.request_status === 'waiting_for_attachment'
        ? 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.'
        : validation.is_valid
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
    `- Intake mode: ${request.intake_mode || 'n/a'}`,
    `- Request status: ${request.request_status || 'submitted'}`,
    `- Central assignment: ${assignment.assignment_status || 'not_attempted'}${assignment.assigned_login ? ` (${assignment.assigned_login})` : ''}`,
    `- Approval: ${approval.approval_status || 'pending'} (${approval.approver_role || 'n/a'})`,
    approval.approver_login ? `- Approver: ${approval.approver_login}` : null,
    `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
    isCsvAttachment && request.request_status === 'waiting_for_attachment'
      ? '- Attachment status: waiting for requester CSV attachment comment'
      : null,
    isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.attachment_url
      ? `- Attachment URL: ${request.accepted_attachment_submission.attachment_url}`
      : null,
    isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.comment_id
      ? `- Attachment comment ID: ${request.accepted_attachment_submission.comment_id}`
      : null,
    isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.uploader_login
      ? `- Attachment uploader: ${request.accepted_attachment_submission.uploader_login}`
      : null,
    isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.filename
      ? `- Attachment filename: ${request.accepted_attachment_submission.filename}`
      : null,
    isCsvAttachment && request.accepted_attachment_submission && request.accepted_attachment_submission.content_hash
      ? `- Attachment content hash: ${request.accepted_attachment_submission.content_hash}`
      : null,
    isBulkCsv
      || isCsvAttachment
      ? `- CSV row findings: ${(validation.csv_row_findings || request.csv_row_findings || []).length}`
      : null,
    isBulkCsv || isCsvAttachment
      ? `- CSV valid rows: ${request.bulk_csv_submission?.valid_row_count ?? 0}`
      : null,
    isBulkCsv || isCsvAttachment
      ? `- CSV duplicate rows: ${readBulkCsvCount(execution.duplicate_row_count, request.bulk_csv_submission?.duplicate_row_count)}`
      : null,
    isBulkCsv || isCsvAttachment
      ? `- CSV invalid rows: ${readBulkCsvCount(execution.invalid_row_count, request.bulk_csv_submission?.invalid_row_count)}`
      : null,
    (isBulkCsv || isCsvAttachment) && request.csv_row_numbering_convention
      ? `- CSV row numbering: ${request.csv_row_numbering_convention}`
      : null,
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
    execution.summary || (request.request_status === 'waiting_for_attachment'
      ? 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.'
      : validation.is_valid
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
  readBulkCsvCount,
  readAuditArtifact,
};
