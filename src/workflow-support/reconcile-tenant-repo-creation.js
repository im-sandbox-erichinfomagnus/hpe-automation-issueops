'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeRepositoryName } = require('./parse-tenant-repo-request');

function normalizeOwnedRepositoryName(value) {
  return normalizeRepositoryName(value)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildOwnedEntryDefaults(request = {}) {
  const requested = {
    repoType: String(request.repo_type || request.repository_type || '').trim(),
    lifecycle: String(request.lifecycle || '').trim(),
    migrationWave: String(request.migration_wave || request.migrationWave || '').trim(),
    source: String(request.source || '').trim(),
  };

  const defaults = {
    repoType: requested.repoType || 'service',
    lifecycle: requested.lifecycle || 'active',
    migrationWave: requested.migrationWave || 'wave-1',
    source: requested.source || 'ghec',
  };

  return {
    defaults,
    defaults_applied: {
      repoType: !requested.repoType,
      lifecycle: !requested.lifecycle,
      migrationWave: !requested.migrationWave,
      source: !requested.source,
    },
  };
}

function buildOwnedRepositoryEntry(request = {}, tenantContext = {}) {
  const tenantId = String(tenantContext.tenant_id || tenantContext.tenant_key || request.tenant_key || '').trim();
  const repoName = String(request.repository_name_normalized || request.repository_name_input || '').trim();
  const visibility = String(request.repository_visibility || '').trim().toLowerCase();
  const adminTeam = String(tenantContext.repo_admin_team_slug || request.repo_admin_team_slug || '').trim();
  const defaults = buildOwnedEntryDefaults(request);

  return {
    entry: {
      repoName,
      tenantId,
      visibility,
      repoType: defaults.defaults.repoType,
      lifecycle: defaults.defaults.lifecycle,
      migrationWave: defaults.defaults.migrationWave,
      source: defaults.defaults.source,
      adminTeam,
    },
    defaults_applied: defaults.defaults_applied,
  };
}

function resolveOwnedRepositoryMatch(ownedRepositories = [], request = {}, tenantContext = {}) {
  const targetName = normalizeOwnedRepositoryName(request.repository_name_input || request.repository_name_normalized);
  const targetTenantId = String(tenantContext.tenant_id || tenantContext.tenant_key || request.tenant_key || '').trim().toLowerCase();
  if (!targetName) {
    return null;
  }

  return (ownedRepositories || []).find((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidateName = normalizeOwnedRepositoryName(entry.repoName);
    const candidateTenantId = String(entry.tenantId || '').trim().toLowerCase();
    if (!candidateName) {
      return false;
    }

    if (candidateTenantId && targetTenantId && candidateTenantId !== targetTenantId) {
      return false;
    }

    return candidateName === targetName;
  }) || null;
}

function hasRequiredOwnedEntryFields(entry = {}) {
  const requiredFields = ['repoName', 'tenantId', 'visibility', 'repoType', 'lifecycle', 'migrationWave', 'source', 'adminTeam'];
  return requiredFields.every((field) => String(entry[field] || '').trim() !== '');
}

function resolveTenantRegistryFilePath(input = {}) {
  const request = input.request || {};
  const tenantContext = input.tenantContext || input.canonical_tenant_context || {};
  const registryDirectory = path.resolve(input.registryDirectory || process.env.TENANT_REGISTRY_DIR || 'tenant-registry');
  const sourceFile = String(tenantContext.source_file || '').trim();
  if (sourceFile) {
    return {
      registry_directory: registryDirectory,
      registry_path: path.join(registryDirectory, sourceFile),
      source_hint: 'resolved_context_source_file',
    };
  }

  const candidates = [
    String(tenantContext.tenant_id || '').trim(),
    String(tenantContext.tenant_key || '').trim(),
    String(request.tenant_key || '').trim(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const candidatePath = path.join(registryDirectory, `${candidate}.json`);
    if (fs.existsSync(candidatePath)) {
      return {
        registry_directory: registryDirectory,
        registry_path: candidatePath,
        source_hint: 'tenant_key_or_id',
      };
    }
  }

  const fallbackKey = candidates[0] || 'unknown-tenant';
  return {
    registry_directory: registryDirectory,
    registry_path: path.join(registryDirectory, `${fallbackKey}.json`),
    source_hint: 'fallback',
  };
}

function persistOwnedRepositoryEntry(input = {}) {
  const request = input.request || {};
  const tenantContext = input.tenantContext || input.canonical_tenant_context || {};
  const ownedEntry = input.ownedEntry || input.owned_entry || buildOwnedRepositoryEntry(request, tenantContext).entry;
  const registryFileInfo = resolveTenantRegistryFilePath({
    request,
    tenantContext,
    registryDirectory: input.registryDirectory,
  });

  try {
    const registryPath = registryFileInfo.registry_path;
    const rawRecord = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!rawRecord || typeof rawRecord !== 'object') {
      return {
        status: 'failed',
        failure_reason: 'invalid_registry_record_shape',
        registry_path: registryPath,
      };
    }

    rawRecord.topology = rawRecord.topology && typeof rawRecord.topology === 'object' ? rawRecord.topology : {};
    rawRecord.topology.repositories = rawRecord.topology.repositories && typeof rawRecord.topology.repositories === 'object'
      ? rawRecord.topology.repositories
      : {};
    const ownedCollection = rawRecord.topology.repositories.owned;
    if (ownedCollection != null && !Array.isArray(ownedCollection)) {
      return {
        status: 'failed',
        failure_reason: 'invalid_owned_collection',
        registry_path: registryPath,
      };
    }

    const owned = Array.isArray(ownedCollection) ? ownedCollection : [];
    rawRecord.topology.repositories.owned = owned;

    if (!hasRequiredOwnedEntryFields(ownedEntry)) {
      return {
        status: 'failed',
        failure_reason: 'owned_entry_missing_required_fields',
        registry_path: registryPath,
      };
    }

    const existingMatch = resolveOwnedRepositoryMatch(owned, request, tenantContext);
    if (existingMatch) {
      return {
        status: 'noop',
        registry_path: registryPath,
        matched_entry: existingMatch,
        source_hint: registryFileInfo.source_hint,
      };
    }

    owned.push(ownedEntry);
    fs.writeFileSync(registryPath, `${JSON.stringify(rawRecord, null, 2)}\n`, 'utf8');
    return {
      status: 'appended',
      registry_path: registryPath,
      appended_entry: ownedEntry,
      owned_count: owned.length,
      source_hint: registryFileInfo.source_hint,
    };
  } catch (error) {
    return {
      status: 'failed',
      failure_reason: 'registry_read_or_write_failed',
      detail: error && error.message ? error.message : 'unknown_error',
      registry_path: registryFileInfo.registry_path,
    };
  }
}

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
  const topologyMode = tenantContext && tenantContext.topology_mode
    ? String(tenantContext.topology_mode)
    : 'legacy_projection';
  const ownedRepositories = tenantContext && Array.isArray(tenantContext.owned_repositories)
    ? tenantContext.owned_repositories
    : [];
  const existingVisibility = repositoryState && repositoryState.repository && repositoryState.repository.visibility
    ? String(repositoryState.repository.visibility).toLowerCase()
    : null;
  const visibilityConflict = repositoryExists && existingVisibility && requestedVisibility !== existingVisibility;
  const duplicateOwnedRepositoryConflict = input.duplicate_owned_repository_conflict || null;
  const ownedEntryBuilder = buildOwnedRepositoryEntry(request, tenantContext || {});
  const ownedEntryExistingMatch = resolveOwnedRepositoryMatch(ownedRepositories, request, tenantContext || {});

  const blockedByDuplicateOwnedRepository = Boolean(duplicateOwnedRepositoryConflict);

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
      : blockedByDuplicateOwnedRepository
        ? 'duplicate_owned_repository'
      : blockedByVisibilityConflict
        ? 'visibility_conflict'
        : null;
  const state = !organizationVisible || !tenantContext || blockedByBoundary || blockedByVisibilityConflict || blockedByDuplicateOwnedRepository
    ? 'blocked'
    : dryRun
      ? 'validated'
      : 'approved_for_execution';

  const ownedTopologyAction = blockedByDuplicateOwnedRepository
    ? 'blocked_duplicate'
    : ownedEntryExistingMatch
      ? 'noop_already_owned'
      : 'append_owned_entry';

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
    topology_mode: topologyMode,
    owned_repositories_status: tenantContext && tenantContext.owned_repositories_status
      ? tenantContext.owned_repositories_status
      : 'absent',
    owned_entry_candidate: ownedEntryBuilder.entry,
    defaults_applied: ownedEntryBuilder.defaults_applied,
    owned_entry_match: ownedEntryExistingMatch,
    owned_topology_action: ownedTopologyAction,
    topology_persistence_action: ownedTopologyAction === 'append_owned_entry'
      ? 'append'
      : ownedTopologyAction === 'noop_already_owned'
        ? 'noop'
        : 'reject',
    duplicate_owned_repository_conflict: duplicateOwnedRepositoryConflict,
    state,
  };
}

module.exports = {
  buildOwnedRepositoryEntry,
  hasRequiredOwnedEntryFields,
  normalizeOwnedRepositoryName,
  persistOwnedRepositoryEntry,
  reconcileTenantRepoCreation,
  resolveTenantRegistryFilePath,
  resolveOwnedRepositoryMatch,
};