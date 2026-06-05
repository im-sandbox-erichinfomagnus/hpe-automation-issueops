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
  const requestedVisibility = String(request.repository_visibility || 'private').toLowerCase();
  const existingVisibility = repositoryState && repositoryState.repository && repositoryState.repository.visibility
    ? String(repositoryState.repository.visibility).toLowerCase()
    : null;
  const visibilityConflict = repositoryExists && existingVisibility && requestedVisibility !== existingVisibility;

  const creationAction = repositoryExists ? 'noop' : 'create_repository';
  const permissionAction =
    currentPermission === 'admin'
      ? 'noop'
      : repositoryExists || creationAction === 'create_repository'
        ? 'grant_admin'
        : 'reject';

  const blockedByBoundary = boundaryRevalidationStatus !== 'matched';
  const blockedByMissingContext = !organizationVisible || !tenantContext;
  const blockedByVisibilityConflict = visibilityConflict;
  const blockedReason = blockedByBoundary
    ? 'boundary_mismatch'
    : blockedByMissingContext
      ? 'missing_tenant_context'
      : blockedByVisibilityConflict
        ? 'visibility_conflict'
        : null;
  const state = !organizationVisible || !tenantContext || blockedByBoundary || blockedByVisibilityConflict
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
    requested_visibility: requestedVisibility,
    existing_visibility: existingVisibility,
    visibility_conflict: visibilityConflict,
    desired_repository_visibility: requestedVisibility,
    actual_visibility: existingVisibility,
    creation_action: blockedReason ? 'reject' : creationAction,
    permission_action: blockedReason ? 'reject' : permissionAction,
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