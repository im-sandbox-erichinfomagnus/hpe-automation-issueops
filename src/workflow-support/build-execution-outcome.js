'use strict';

function normalizeExecutionResult(result) {
  const entityId = result.repository_full_name || result.username || result.normalized_slug || result.team_slug || result.requested_name;
  return {
    entity_id: entityId,
    result_kind: result.result_kind || null,
    requested_name: result.requested_name || null,
    normalized_slug: result.normalized_slug || null,
    team_slug: result.team_slug || null,
    username: result.username || null,
    repository_full_name: result.repository_full_name || null,
    source_row_number: result.source_row_number || null,
    source_comment_id: result.source_comment_id || null,
    created_team_id: result.created_team_id || null,
    current_team_id: result.current_team_id || null,
    result: result.result || result.execution_result || 'not_started',
    failure_reason: result.failure_reason || null,
    detail: result.detail || null,
    status_code: result.status_code || null,
  };
}

function summarizeResults(results, options = {}) {
  const operationLabel = options.operationLabel || 'entity';
  const summary = {
    mutated: [],
    removed: [],
    noop: [],
    rejected: [],
    pending: [],
    failed: [],
    operation_label: operationLabel,
  };

  for (const result of results.map(normalizeExecutionResult)) {
    if (['added', 'created', 'mutated', 'linked', 'removed'].includes(result.result)) {
      summary.mutated.push(result);
      if (result.result === 'removed') {
        summary.removed.push(result);
      }
    } else if (result.result === 'granted') {
      summary.mutated.push(result);
    } else if (result.result === 'noop') {
      summary.noop.push(result);
    } else if (result.result === 'rejected') {
      summary.rejected.push(result);
    } else if (result.result === 'pending') {
      summary.pending.push(result);
    } else if (result.result === 'failed') {
      summary.failed.push(result);
    }
  }

  return summary;
}

function deriveRollbackStatus(summary) {
  if (summary.failed.length === 0) {
    return 'not_needed';
  }

  if (summary.mutated.length > 0 || summary.pending.length > 0) {
    return 'compensating_action_required';
  }

  return 'manual_follow_up_required';
}

function buildRemediationInstructions(summary) {
  if (summary.failed.length === 0) {
    return [];
  }

  const failedEntities = summary.failed
    .map((entry) => entry.entity_id || entry.failure_reason || 'unknown_failure')
    .filter(Boolean);
  return [
    `Retry or re-request the failed subset only: ${failedEntities.join(', ')}`,
    'Preserve the successful subset in the audit artifact to avoid duplicate writes on rerun.',
  ];
}

function deriveOwnedTopologyAction(input = {}) {
  const explicit = input.owned_topology_action || input.ownedTopologyAction;
  if (explicit) {
    return explicit;
  }

  const result = input.topology_persistence_result || input.topologyPersistenceResult || null;
  const status = result && result.status ? String(result.status) : '';
  if (status === 'noop') {
    return 'noop_already_owned';
  }
  if (status === 'appended') {
    return 'append_owned_entry';
  }
  if (status === 'duplicate_blocked') {
    return 'blocked_duplicate';
  }

  return 'not_applicable';
}

function deriveContextBindingStatus(input = {}) {
  const approvedContextMarker = input.approved_context_marker || input.approvedContextMarker || null;
  const latestContextMarker = input.latest_context_marker || input.latestContextMarker || null;
  const executionContextMarker = input.execution_context_marker || input.executionContextMarker || latestContextMarker || null;

  if (!approvedContextMarker || !latestContextMarker || !executionContextMarker) {
    return 'unknown';
  }

  if (
    String(approvedContextMarker) === String(latestContextMarker) &&
    String(latestContextMarker) === String(executionContextMarker)
  ) {
    return 'matched';
  }

  return 'mismatched';
}

function mapCicdCapabilityOutcome(input = {}) {
  const candidate = input && typeof input === 'object' ? input : {};
  const allowedStatuses = new Set(['requested', 'applied', 'skipped', 'blocked', 'unavailable', 'failed']);
  const rawStatus = String(candidate.status || candidate.capability_status || '').toLowerCase();
  const normalizedStatus = allowedStatuses.has(rawStatus) ? rawStatus : 'skipped';

  return {
    selected_path: String(candidate.selected_path || candidate.selectedPath || 'none').toLowerCase(),
    status: normalizedStatus,
    reason_code: candidate.reason_code || candidate.reasonCode || null,
    reason_message: candidate.reason_message || candidate.reasonMessage || null,
  };
}

function buildExecutionOutcome(input = {}) {
  const executionResults = input.executionResults || input.execution_results || [];
  const runContext = input.runContext || input.run_context || {};
  const bulkCsvSubmission = input.bulk_csv_submission || input.bulkCsvSubmission || null;
  const summary = summarizeResults(executionResults, {
    operationLabel: input.operationLabel || input.operation_label || 'entity',
  });
  const remediationInstructions = buildRemediationInstructions(summary);
  const rollbackStatus = deriveRollbackStatus(summary);
  const ownedTopologyAction = deriveOwnedTopologyAction(input);
  const contextBindingStatus = deriveContextBindingStatus(input);
  const isTenantRepositoryOperation = summary.operation_label === 'tenant_repository';
  const processedLabel = summary.operation_label === 'membership'
    ? 'member(s)'
    : isTenantRepositoryOperation
      ? 'tenant repository action(s)'
      : `${summary.operation_label}(ies)`;
  const groupedLabel = summary.operation_label === 'membership'
    ? 'membership(s)'
    : isTenantRepositoryOperation
      ? 'tenant repository action(s)'
      : `${summary.operation_label}(ies)`;
  const terminalState = input.terminal_state || 'not_started';
  const waitingSummary = terminalState === 'waiting_for_attachment'
    ? 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.'
    : null;
  const awaitingApprovalSummary = terminalState === 'awaiting_approval' && summary.mutated.length === 0
    ? 'Request is validated and ready for approval. No mutation was attempted in this phase.'
    : null;
  const cicdCapability = mapCicdCapabilityOutcome(input.cicd_capability || input.cicdCapability || {});

  return {
    run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
    run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
    intake_mode: input.intake_mode || null,
    terminal_state: terminalState,
    mutation_count: summary.mutated.length,
    created_count: summary.mutated.length,
    linked_count: summary.mutated.length,
    noop_count: summary.noop.length,
    rejected_count: summary.rejected.length,
    pending_count: summary.pending.length,
    failure_count: summary.failed.length,
    granted_count: summary.mutated.length,
    removed_count: summary.removed.length,
    duplicate_row_count: input.duplicate_row_count ?? bulkCsvSubmission?.duplicate_row_count ?? 0,
    invalid_row_count: input.invalid_row_count ?? bulkCsvSubmission?.invalid_row_count ?? 0,
    attachment_rate_limit_snapshot: input.attachment_rate_limit_snapshot || null,
    created_teams: summary.mutated,
    noop_teams: summary.noop,
    failed_teams: summary.failed,
    rollback_status: rollbackStatus,
    owned_topology_action: ownedTopologyAction,
    approved_context_marker: input.approved_context_marker || input.approvedContextMarker || null,
    latest_context_marker: input.latest_context_marker || input.latestContextMarker || null,
    execution_context_marker: input.execution_context_marker || input.executionContextMarker || null,
    context_binding_status: contextBindingStatus,
    topology_mode: input.topology_mode || input.topologyMode || null,
    tenant_id: input.tenant_id || input.tenantId || null,
    tenant_team_slug: input.tenant_team_slug || input.tenantTeamSlug || null,
    repo_admin_team_slug: input.repo_admin_team_slug || input.repoAdminTeamSlug || null,
    cicd_capability_selected_path: cicdCapability.selected_path,
    cicd_capability_status: cicdCapability.status,
    cicd_capability_reason_code: cicdCapability.reason_code,
    cicd_capability_reason_message: cicdCapability.reason_message,
    cicd_topology_update_outcome: input.cicd_topology_update_outcome || input.cicdTopologyUpdateOutcome || null,
    repository_creation_result: input.repository_creation_result || null,
    repo_admin_grant_result: input.repo_admin_grant_result || null,
    repository_custom_properties_result: input.repository_custom_properties_result || null,
    repository_custom_properties_failure_reason: input.repository_custom_properties_failure_reason || null,
    repository_custom_properties_failure_status_code: input.repository_custom_properties_failure_status_code || null,
    repository_custom_properties_failure_detail: input.repository_custom_properties_failure_detail || null,
    audit_persistence_result: input.audit_persistence_result || null,
    topology_persistence_result: input.topology_persistence_result || input.topologyPersistenceResult || null,
    mutation_token_source: input.mutation_token_source || null,
    mutation_token_kind: input.mutation_token_kind || null,
    mutation_token_is_pat_backed: input.mutation_token_is_pat_backed === true,
    failed_subset: summary.failed,
    rejected_subset: summary.rejected,
    mutated_repositories: summary.mutated.map((entry) => entry.repository_full_name).filter(Boolean),
    noop_repositories: summary.noop.map((entry) => entry.repository_full_name).filter(Boolean),
    rejected_repositories: summary.rejected.map((entry) => entry.repository_full_name).filter(Boolean),
    failed_repositories: summary.failed.map((entry) => entry.repository_full_name).filter(Boolean),
    remediation_instructions: remediationInstructions,
    summary: waitingSummary || awaitingApprovalSummary || [
      `Processed ${summary.mutated.length} ${processedLabel},`,
      `${summary.noop.length} no-op ${groupedLabel},`,
      `${summary.rejected.length} rejected ${groupedLabel},`,
      `${summary.pending.length} pending ${groupedLabel},`,
      `and ${summary.failed.length} failed ${groupedLabel}.`,
      remediationInstructions[0] || '',
    ]
      .filter(Boolean)
      .join(' '),
    artifact_path: input.artifact_path || null,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
  };
}

module.exports = {
  buildExecutionOutcome,
  buildRemediationInstructions,
  deriveContextBindingStatus,
  deriveOwnedTopologyAction,
  deriveRollbackStatus,
  mapCicdCapabilityOutcome,
  normalizeExecutionResult,
  summarizeResults,
};