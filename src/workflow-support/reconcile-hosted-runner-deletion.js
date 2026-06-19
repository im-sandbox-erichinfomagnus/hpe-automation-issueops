'use strict';

function reconcileHostedRunnerDeletion(input = {}) {
  const request = input.request || {};
  const tenantContext = input.canonical_tenant_context || input.tenantContext || null;
  const organizationVisible = input.organization_visible !== false;
  const runnerExists = Boolean(input.runner_exists);
  const existingRunnerId = input.existing_runner_id || null;
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const deletionAction = runnerExists ? 'delete_hosted_runner' : 'noop';

  const blockedByBoundary = boundaryRevalidationStatus !== 'matched';
  const blockedByMissingContext = !organizationVisible || !tenantContext;

  const blockedReason = blockedByBoundary
    ? 'boundary_mismatch'
    : blockedByMissingContext
      ? 'missing_tenant_context'
      : null;

  return {
    organization_visible: organizationVisible,
    runner_exists: runnerExists,
    existing_runner_id: existingRunnerId,
    runner_name_derived: request.runner_name_derived || '',
    deletion_action: blockedReason ? 'reject' : deletionAction,
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
  reconcileHostedRunnerDeletion,
};
