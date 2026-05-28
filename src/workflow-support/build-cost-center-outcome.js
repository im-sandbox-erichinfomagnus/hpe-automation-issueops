'use strict';

const MUTATION_RESULTS = new Set(['created', 'added', 'removed']);

function normalizeResult(result) {
  return {
    entity_id: result.cost_center && result.login
      ? `${result.cost_center}:${result.login}`
      : result.cost_center || result.login || null,
    cost_center: result.cost_center || null,
    cost_center_id: result.cost_center_id || null,
    login: result.login || null,
    source_row_number: result.source_row_number || null,
    result: result.execution_result || result.result || 'not_started',
    failure_reason: result.failure_reason || null,
  };
}

function buildCostCenterOutcome(input = {}) {
  const executionResults = (input.executionResults || []).map(normalizeResult);
  const runContext = input.runContext || {};

  const createdCostCenters = executionResults.filter((entry) => entry.result === 'created' && !entry.login);
  const added = executionResults.filter((entry) => entry.result === 'added');
  const removed = executionResults.filter((entry) => entry.result === 'removed');
  const noop = executionResults.filter((entry) => entry.result === 'noop');
  const rejected = executionResults.filter((entry) => entry.result === 'rejected');
  const failed = executionResults.filter((entry) => entry.result === 'failed');
  const mutationCount = executionResults.filter((entry) => MUTATION_RESULTS.has(entry.result)).length;

  const rollbackStatus =
    failed.length === 0
      ? 'not_needed'
      : mutationCount > 0
        ? 'compensating_action_required'
        : 'manual_follow_up_required';

  const remediationInstructions =
    failed.length === 0
      ? []
      : [
          `Retry the failed subset only: ${failed.map((entry) => entry.entity_id).join(', ')}`,
          'The audit artifact records the successful subset to avoid duplicate writes on rerun.',
        ];

  return {
    run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
    run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
    intake_mode: input.intake_mode || null,
    cost_centers_created_count: createdCostCenters.length,
    added_count: added.length,
    removed_count: removed.length,
    mutation_count: mutationCount,
    noop_count: noop.length,
    rejected_count: rejected.length,
    failure_count: failed.length,
    duplicate_row_count: input.duplicate_row_count || 0,
    invalid_row_count: input.invalid_row_count || 0,
    results: executionResults,
    failed_subset: failed,
    rejected_subset: rejected,
    rollback_status: rollbackStatus,
    remediation_instructions: remediationInstructions,
    summary: [
      `Created ${createdCostCenters.length} cost center(s),`,
      `added ${added.length} user assignment(s),`,
      `removed ${removed.length} user assignment(s),`,
      `${noop.length} no-op,`,
      `${rejected.length} rejected,`,
      `and ${failed.length} failed.`,
      remediationInstructions[0] || '',
    ]
      .filter(Boolean)
      .join(' '),
    artifact_path: input.artifact_path || null,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
  };
}

module.exports = {
  buildCostCenterOutcome,
  normalizeResult,
};
