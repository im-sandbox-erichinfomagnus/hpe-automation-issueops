'use strict';

function reconcileTenantRepoCreation(input = {}) {
  const request = input.request || {};
  const tenantContext = input.tenantContext || input.canonical_tenant_context || null;
  const organizationVisible = input.organization_visible !== false;
  const repositoryState = input.repository_state || { exists: false, repository: null };
  const repositoryExists = Boolean(repositoryState && repositoryState.exists);
  const currentPermission = String(input.current_repo_admin_permission || 'unknown').toLowerCase();
  const dryRun = Boolean(input.dry_run ?? request.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const creationAction = repositoryExists ? 'noop' : 'create_repository';
  const permissionAction =
    currentPermission === 'admin'
      ? 'noop'
      : repositoryExists || creationAction === 'create_repository'
        ? 'grant_admin'
        : 'reject';

  const blockedByBoundary = boundaryRevalidationStatus !== 'matched';
  const blockedByMissingContext = !organizationVisible || !tenantContext;
  const blockedReason = blockedByBoundary
    ? 'boundary_mismatch'
    : blockedByMissingContext
      ? 'missing_tenant_context'
      : null;
  const state = !organizationVisible || !tenantContext || blockedByBoundary
    ? 'blocked'
    : dryRun
      ? 'validated'
      : 'approved_for_execution';

  return {
    organization_visible: organizationVisible,
    repository_exists: repositoryExists,
    repository_full_name: `${request.organization || ''}/${request.repository_name_normalized || ''}`.replace(/^\//, ''),
    current_repo_admin_permission: currentPermission,
    desired_repo_admin_permission: 'admin',
    creation_action: blockedByBoundary ? 'reject' : creationAction,
    permission_action: blockedByBoundary ? 'reject' : permissionAction,
    direct_admin_avoidance: 'enforced_team_only',
    blocked_reason: blockedReason,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    boundary_revalidation_status: boundaryRevalidationStatus,
    state,
  };
}

module.exports = {
  reconcileTenantRepoCreation,
};