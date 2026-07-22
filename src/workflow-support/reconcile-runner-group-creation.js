'use strict';

function reconcileRunnerGroupCreation(input = {}) {
  const request = input.request || {};
  const tenantContext = input.canonical_tenant_context || input.tenantContext || null;
  const organizationVisible = input.organization_visible !== false;
  const runnerGroupExists = Boolean(input.runner_group_exists);
  const existingRunnerGroupId = input.existing_runner_group_id || null;
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const creationAction = runnerGroupExists ? 'noop' : 'create_runner_group';

  const blockedByBoundary = boundaryRevalidationStatus !== 'matched';
  const blockedByMissingContext = !organizationVisible || !tenantContext;

  const blockedReason = blockedByBoundary
    ? 'boundary_mismatch'
    : blockedByMissingContext
      ? 'missing_tenant_context'
      : null;

  return {
    organization_visible: organizationVisible,
    runner_group_exists: runnerGroupExists,
    existing_runner_group_id: existingRunnerGroupId,
    runner_group_name_derived: request.runner_group_name_derived || '',
    runner_group_visibility: request.runner_group_visibility || 'selected',
    allows_public_repositories: Boolean(request.allows_public_repositories),
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
  reconcileRunnerGroupCreation,
};
