'use strict';

function normalizeExecutionResult(result) {
  const entityId = result.username || result.normalized_slug || result.team_slug || result.requested_name;
  return {
    entity_id: entityId,
    requested_name: result.requested_name || null,
    result: result.result || result.execution_result || 'not_started',
    failure_reason: result.failure_reason || null,
  };
}

function summarizeResults(results, options = {}) {
  const operationLabel = options.operationLabel || 'entity';
  const summary = {
    mutated: [],
    noop: [],
    pending: [],
    failed: [],
    operation_label: operationLabel,
  };

  for (const result of results.map(normalizeExecutionResult)) {
    if (['added', 'created', 'mutated', 'linked'].includes(result.result)) {
      summary.mutated.push(result.entity_id);
    } else if (result.result === 'noop') {
      summary.noop.push(result.entity_id);
    } else if (result.result === 'pending') {
      summary.pending.push(result.entity_id);
    } else if (result.result === 'failed') {
      summary.failed.push({ entity_id: result.entity_id, failure_reason: result.failure_reason });
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

  const failedEntities = summary.failed.map((entry) => entry.entity_id);
  return [
    `Retry or re-request the failed subset only: ${failedEntities.join(', ')}`,
    'Preserve the successful subset in the audit artifact to avoid duplicate writes on rerun.',
  ];
}

function buildExecutionOutcome(input = {}) {
  const executionResults = input.executionResults || input.execution_results || [];
  const runContext = input.runContext || input.run_context || {};
  const summary = summarizeResults(executionResults, {
    operationLabel: input.operationLabel || input.operation_label || 'entity',
  });
  const remediationInstructions = buildRemediationInstructions(summary);
  const rollbackStatus = deriveRollbackStatus(summary);

  return {
    run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
    run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
    mutation_count: summary.mutated.length,
    created_count: summary.mutated.length,
    linked_count: summary.mutated.length,
    noop_count: summary.noop.length,
    pending_count: summary.pending.length,
    failure_count: summary.failed.length,
    rollback_status: rollbackStatus,
    failed_subset: summary.failed,
    remediation_instructions: remediationInstructions,
    summary: [
      `Processed ${summary.mutated.length} ${summary.operation_label}(ies),`,
      `${summary.noop.length} no-op ${summary.operation_label}(ies),`,
      `${summary.pending.length} pending ${summary.operation_label}(ies),`,
      `and ${summary.failed.length} failed ${summary.operation_label}(ies).`,
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
  deriveRollbackStatus,
  summarizeResults,
};