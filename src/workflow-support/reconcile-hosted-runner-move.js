'use strict';

function reconcileHostedRunnerMove(input = {}) {
  const request = input.request || {};
  const tenantContext = input.canonical_tenant_context || input.tenantContext || null;
  const organizationVisible = input.organization_visible !== false;
  const runnerExists = Boolean(input.runner_exists);
  const existingRunnerId = input.existing_runner_id ?? null;
  const currentRunnerGroupId = input.current_runner_group_id ?? null;
  const targetRunnerGroupResolution = input.target_runner_group_resolution || {};
  const targetRunnerGroupId = targetRunnerGroupResolution.resolved_group_id ?? null;
  const runnerAlreadyInTargetGroup = Boolean(input.runner_already_in_target_group);
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const blockedReason = boundaryRevalidationStatus !== 'matched'
    ? 'boundary_mismatch'
    : !organizationVisible || !tenantContext
      ? 'missing_tenant_context'
      : !runnerExists
        ? 'runner_not_found'
        : targetRunnerGroupResolution.resolution_status !== 'resolved'
          ? 'target_runner_group_not_found'
          : null;
  const moveAction = blockedReason
    ? 'reject'
    : runnerAlreadyInTargetGroup
      ? 'noop'
      : 'move_hosted_runner';

  return {
    organization_visible: organizationVisible,
    runner_exists: runnerExists,
    existing_runner_id: existingRunnerId,
    runner_name_derived: request.runner_name_derived || '',
    current_runner_group_id: currentRunnerGroupId,
    target_runner_group_resolution: targetRunnerGroupResolution,
    target_runner_group_id: targetRunnerGroupId,
    target_runner_group_name: targetRunnerGroupResolution.resolved_group_name || request.target_runner_group_name_input || '',
    runner_already_in_target_group: runnerAlreadyInTargetGroup,
    move_action: moveAction,
    blocked_reason: blockedReason,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    boundary_revalidation_status: boundaryRevalidationStatus,
    state: blockedReason
      ? 'blocked'
      : dryRun
        ? 'validated'
        : 'approved_for_execution',
  };
}

module.exports = {
  reconcileHostedRunnerMove,
};
