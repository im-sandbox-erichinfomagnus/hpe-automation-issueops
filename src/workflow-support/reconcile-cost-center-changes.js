'use strict';

// Buckets validated rows into a deterministic execution order: creates, then
// renames, then deletes. Only rows the validator marked actionable are carried.
function reconcileCostCenterChanges(input = {}) {
  const rows = input.requested_changes || input.rows || [];
  const dryRun = Boolean(input.dry_run);

  const actionable = rows.filter(
    (row) => row.validation_status === 'valid' || row.validation_status === 'unverified'
  );

  const creates = actionable.filter((row) => row.desired_action === 'create_cost_center');
  const renames = actionable.filter((row) => row.desired_action === 'rename_cost_center');
  const deletes = actionable.filter((row) => row.desired_action === 'delete_cost_center');
  const noops = rows.filter((row) => row.validation_status === 'noop');
  const rejected = rows.filter((row) => row.validation_status === 'rejected');

  const blockedReason = rows.length === 0 ? 'no_rows' : null;

  return {
    creates,
    renames,
    deletes,
    noops,
    rejected,
    ordered: [...creates, ...renames, ...deletes],
    mutation_count: creates.length + renames.length + deletes.length,
    noop_count: noops.length,
    rejected_count: rejected.length,
    dry_run: dryRun,
    blocked_reason: blockedReason,
    state: blockedReason ? 'blocked' : dryRun ? 'validated' : 'approved_for_execution',
  };
}

module.exports = {
  reconcileCostCenterChanges,
};
