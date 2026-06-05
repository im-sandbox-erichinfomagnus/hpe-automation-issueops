'use strict';

function reconcileHostedRunnerCreation(input = {}) {
  const request = input.request || {};
  const tenantContext = input.canonical_tenant_context || input.tenantContext || null;
  const organizationVisible = input.organization_visible !== false;
  const runnerExists = Boolean(input.runner_exists);
  const existingRunnerId = input.existing_runner_id || null;
  const runnerGroupResolution = input.runner_group_resolution || {
    resolution_status: 'not_found',
    resolved_group_id: null,
  };
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const creationAction = runnerExists ? 'noop' : 'create_hosted_runner';

  const blockedByBoundary = boundaryRevalidationStatus !== 'matched';
  const blockedByMissingContext = !organizationVisible || !tenantContext;
  const blockedByRunnerGroup = !runnerExists && runnerGroupResolution.resolution_status !== 'resolved';

  const blockedReason = blockedByBoundary
    ? 'boundary_mismatch'
    : blockedByMissingContext
      ? 'missing_tenant_context'
      : blockedByRunnerGroup
        ? 'unresolved_runner_group'
        : null;

  return {
    organization_visible: organizationVisible,
    runner_exists: runnerExists,
    existing_runner_id: existingRunnerId,
    runner_name_derived: request.runner_name_derived || '',
    runner_image_id: request.runner_image_id || '',
    runner_image_source: request.runner_image_source || '',
    runner_size: request.runner_size || '',
    maximum_runners: request.maximum_runners || null,
    runner_group_resolution: runnerGroupResolution,
    creation_action: blockedReason ? 'reject' : creationAction,
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
  reconcileHostedRunnerCreation,
};
