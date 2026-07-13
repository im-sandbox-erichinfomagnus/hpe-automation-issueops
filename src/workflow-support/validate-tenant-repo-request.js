'use strict';

const { parseTenantRepoRequest } = require('./parse-tenant-repo-request');
const {
  ALLOWED_REPOSITORY_VISIBILITIES,
  describeAllowedRepositoryVisibilities,
  normalizeRepositoryVisibility,
} = require('./repository-visibility');
const { normalizeRepositoryName } = require('./parse-tenant-repo-request');
const { resolveTenantContextFromRegistry } = require('./resolve-tenant-context-from-registry');

function isSafeRepositoryName(value) {
  return /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/.test(String(value || ''));
}

function normalizeOwnedRepositoryName(value) {
  return normalizeRepositoryName(value)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function validateTenantRepoRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTenantRepoRequest(input);
  const errors = [];
  const warnings = [];

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.tenant_name_input) {
    errors.push('Tenant name is required.');
  }

  if (!request.repository_name_input) {
    errors.push('Repository name is required.');
  }

  if (!request.repository_name_normalized || !isSafeRepositoryName(request.repository_name_normalized)) {
    errors.push('Repository name normalization failed or produced an unsafe repository slug.');
  }

  const { visibility: repositoryVisibility, source: repositoryVisibilitySource } = normalizeRepositoryVisibility(
    request.repository_visibility,
    { allowDefault: false }
  );
  const allowedRepositoryVisibilities = ALLOWED_REPOSITORY_VISIBILITIES;
  request.repository_visibility = repositoryVisibility;
  request.repository_visibility_source = request.repository_visibility_source || repositoryVisibilitySource;
  let visibilityValidationStatus = 'valid';
  let visibilityValidationReason = '';

  if (repositoryVisibilitySource === 'not_provided') {
    visibilityValidationStatus = 'missing_visibility';
    visibilityValidationReason = 'Repository visibility must be provided by the issue form and cannot be defaulted.';
    errors.push(visibilityValidationReason);
  } else if (!allowedRepositoryVisibilities.includes(repositoryVisibility)) {
    visibilityValidationStatus = 'invalid_visibility';
    visibilityValidationReason = `Repository visibility '${repositoryVisibility}' is invalid. Allowed values are: ${describeAllowedRepositoryVisibilities()}.`;
    errors.push(visibilityValidationReason);
  }

  if (
    allowedRepositoryVisibilities.includes(repositoryVisibility) &&
    typeof options.verifyRepositoryVisibilitySupport === 'function'
  ) {
    const supported = await options.verifyRepositoryVisibilitySupport({
      organization: request.organization,
      visibility: repositoryVisibility,
    });

    if (!supported) {
      visibilityValidationStatus = 'unsupported_visibility';
      visibilityValidationReason = `Requested repository visibility '${repositoryVisibility}' is not supported for organization '${request.organization}'. Allowed values are: ${describeAllowedRepositoryVisibilities()}.`;
      errors.push(visibilityValidationReason);
    }
  } else if (
    allowedRepositoryVisibilities.includes(repositoryVisibility) &&
    typeof options.getSupportedRepositoryVisibilities === 'function'
  ) {
    const supportedVisibilities = await options.getSupportedRepositoryVisibilities({
      organization: request.organization,
    });

    if (Array.isArray(supportedVisibilities) && !supportedVisibilities.includes(repositoryVisibility)) {
      visibilityValidationStatus = 'unsupported_visibility';
      visibilityValidationReason = `Requested repository visibility '${repositoryVisibility}' is not supported for organization '${request.organization}'. Allowed values are: ${describeAllowedRepositoryVisibilities()}.`;
      errors.push(visibilityValidationReason);
    }
  }

  if (visibilityValidationStatus === 'valid' && allowedRepositoryVisibilities.includes(repositoryVisibility)) {
    visibilityValidationReason = `Requested repository visibility '${repositoryVisibility}' is allowed.`;
  }

  const primaryContactDetectedType = request.primary_contact_type || 'absent';
  let primaryContactValidationStatus = 'valid';
  let primaryContactValidationReason = '';

  if (primaryContactDetectedType === 'absent') {
    primaryContactValidationStatus = 'missing';
    primaryContactValidationReason = 'Primary contact is required.';
    errors.push(primaryContactValidationReason);
  } else if (primaryContactDetectedType === 'invalid') {
    primaryContactValidationStatus = 'invalid_format';
    primaryContactValidationReason = `Primary contact '${request.primary_contact}' is not a valid GitHub handle or email address.`;
    errors.push(primaryContactValidationReason);
  } else if (primaryContactDetectedType === 'handle') {
    primaryContactValidationReason = 'Primary contact is a valid GitHub handle.';
  } else if (primaryContactDetectedType === 'email') {
    primaryContactValidationReason = 'Primary contact is a valid email address.';
  }

  const secondaryContactDetectedType = request.secondary_contact_type || 'absent';
  let secondaryContactValidationStatus = 'absent';
  let secondaryContactValidationReason = '';

  if (secondaryContactDetectedType === 'invalid') {
    secondaryContactValidationStatus = 'invalid_format';
    secondaryContactValidationReason = `Secondary contact '${request.secondary_contact}' is not a valid GitHub handle or email address.`;
    errors.push(secondaryContactValidationReason);
  } else if (secondaryContactDetectedType === 'handle') {
    secondaryContactValidationStatus = 'valid';
    secondaryContactValidationReason = 'Secondary contact is a valid GitHub handle.';
  } else if (secondaryContactDetectedType === 'email') {
    secondaryContactValidationStatus = 'valid';
    secondaryContactValidationReason = 'Secondary contact is a valid email address.';
  }

  if (!request.designated_approver_login) {
    errors.push('A designated approver is required.');
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const organizationResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  const tenantResolution = await resolveTenantContextFromRegistry(request, {
    registryDirectory: options.registryDirectory,
    registryRef: options.registryRef,
    listTeams: options.listTeams,
    getMembershipForUser: options.getMembershipForUser,
  });

  if (tenantResolution.registry_missing_directory) {
    errors.push('Tenant registry directory is missing in the workflow workspace.');
  }

  if (tenantResolution.registry_malformed_files && tenantResolution.registry_malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }

  if (tenantResolution.tenant_resolution_status === 'no_match') {
    if (request.tenant_name_input) {
      errors.push(`No authorized tenant context was found for tenant name '${request.tenant_name_input}' in organization '${request.organization}'.`);
      if (tenantResolution.available_tenant_display_names && tenantResolution.available_tenant_display_names.length > 0) {
        warnings.push(`Available tenant names in this organization: ${tenantResolution.available_tenant_display_names.join(', ')}`);
      }
    } else {
      errors.push('Requester could not be resolved as maintainer of exactly one valid tenant context.');
    }
  } else if (tenantResolution.tenant_resolution_status === 'ambiguous') {
    if (request.tenant_name_input) {
      errors.push(`Tenant name '${request.tenant_name_input}' matched multiple authorized tenant contexts and is ambiguous.`);
    } else {
      errors.push('Requester matched multiple authorized tenant contexts and the request is ambiguous.');
    }
  } else if (tenantResolution.tenant_resolution_status === 'registry_conflict') {
    errors.push('Tenant registry data is malformed or conflicting for the target organization.');
  }

  const resolvedContext = tenantResolution.resolved_context;
  if (!resolvedContext) {
    errors.push('Canonical tenant context did not resolve.');
  } else if (resolvedContext.governance_relation_status !== 'valid') {
    errors.push('Resolved tenant governance relationship is invalid for tenant and repo-admin teams.');
  }

  let canonicalTopologyValidationStatus = 'not_applicable';
  if (resolvedContext && resolvedContext.topology_mode === 'canonical') {
    canonicalTopologyValidationStatus = 'valid';
    const requiredRoles = ['tenant-admin', 'repo-admin', 'developer', 'viewer'];
    const accessRoles = Array.isArray(resolvedContext.access_model_roles)
      ? resolvedContext.access_model_roles
      : [];

    if (!resolvedContext.tenant_id) {
      canonicalTopologyValidationStatus = 'invalid';
      errors.push('Canonical topology tenantId is required for tenant context resolution.');
    }

    if (!resolvedContext.tenant_team_slug || !resolvedContext.repo_admin_team_slug) {
      canonicalTopologyValidationStatus = 'invalid';
      errors.push('Canonical topology teams.structure must resolve both tenant root and repo-admin team slugs.');
    }

    if (resolvedContext.repo_admin_parent_matches_root !== true) {
      canonicalTopologyValidationStatus = 'invalid';
      errors.push('Canonical topology repo-admin team must be a child of the tenant root team.');
    }

    if (resolvedContext.access_model_enforcement !== 'tenant-boundary') {
      canonicalTopologyValidationStatus = 'invalid';
      errors.push('Canonical topology access model enforcement must be tenant-boundary.');
    }

    const hasAllRoles = requiredRoles.every((role) => accessRoles.includes(role));
    if (!hasAllRoles) {
      canonicalTopologyValidationStatus = 'invalid';
      errors.push('Canonical topology access model roles are incomplete for tenant governance validation.');
    }
  }

  let duplicateOwnedRepositoryConflict = null;
  const duplicateOwnedRepositoryAllowNoop = Boolean(options.allowOwnedDuplicateWhenRepositoryExists);
  let duplicateOwnedRepositoryStatus = 'not_checked';
  if (resolvedContext) {
    const topologyMode = resolvedContext.topology_mode || 'legacy_projection';
    const ownedRepositoriesStatus = resolvedContext.owned_repositories_status || 'absent';
    const ownedRepositories = Array.isArray(resolvedContext.owned_repositories)
      ? resolvedContext.owned_repositories
      : [];

    if (topologyMode === 'canonical' && ownedRepositoriesStatus === 'invalid') {
      duplicateOwnedRepositoryStatus = 'invalid_owned_collection';
      errors.push('Canonical tenant topology contains an invalid repositories.owned collection and cannot be validated safely.');
    } else {
      const requestedNormalized = normalizeOwnedRepositoryName(request.repository_name_input || request.repository_name_normalized);
      const conflictingEntry = ownedRepositories.find((entry) => {
        const candidateName = entry && typeof entry === 'object' ? entry.repoName : '';
        const candidateTenantId = entry && typeof entry === 'object' ? String(entry.tenantId || '').trim().toLowerCase() : '';
        const contextTenantId = String(resolvedContext.tenant_id || resolvedContext.tenant_key || '').trim().toLowerCase();
        const candidateNormalized = normalizeOwnedRepositoryName(candidateName);
        if (!candidateNormalized || !requestedNormalized) {
          return false;
        }

        if (candidateTenantId && contextTenantId && candidateTenantId !== contextTenantId) {
          return false;
        }

        return candidateNormalized === requestedNormalized;
      }) || null;

      if (conflictingEntry) {
        duplicateOwnedRepositoryStatus = 'duplicate_conflict';
        duplicateOwnedRepositoryConflict = {
          normalized_name: normalizeOwnedRepositoryName(conflictingEntry.repoName),
          repo_name: String(conflictingEntry.repoName || ''),
          tenant_id: String(conflictingEntry.tenantId || resolvedContext.tenant_id || resolvedContext.tenant_key || ''),
        };
        errors.push(
          `Repository name '${request.repository_name_input}' is already present in tenant topology owned repositories (normalized conflict: '${duplicateOwnedRepositoryConflict.normalized_name}').`
        );
      } else {
        duplicateOwnedRepositoryStatus = 'available';
      }
    }
  }

  let designatedApproverAuthorization = {
    state: 'unknown',
    role: 'other',
  };
  if (request.organization && request.designated_approver_login && typeof options.getOrganizationMembership === 'function') {
    const approverMembership = await options.getOrganizationMembership({
      organization: request.organization,
      username: request.designated_approver_login,
    });

    const approverState = approverMembership && approverMembership.membership && approverMembership.membership.state
      ? String(approverMembership.membership.state).toLowerCase()
      : 'absent';
    const approverRole = approverMembership && approverMembership.membership && approverMembership.membership.role
      ? String(approverMembership.membership.role).toLowerCase()
      : 'other';

    designatedApproverAuthorization = {
      state: approverState === 'active' && approverRole === 'admin' ? 'authorized' : 'unauthorized',
      role: approverRole,
    };

    if (designatedApproverAuthorization.state !== 'authorized') {
      errors.push('Designated approver must be an active target organization owner.');
    }
  }

  let repositoryState = {
    exists: false,
    repository: null,
  };
  if (request.organization && request.repository_name_normalized && typeof options.getRepository === 'function') {
    repositoryState = await options.getRepository({
      owner: request.organization,
      repo: request.repository_name_normalized,
    });
  }

  let currentRepoAdminPermission = 'unknown';
  if (
    repositoryState &&
    repositoryState.exists &&
    resolvedContext &&
    resolvedContext.repo_admin_team_slug &&
    typeof options.getTeamRepositoryPermission === 'function'
  ) {
    const permissionState = await options.getTeamRepositoryPermission({
      organization: request.organization,
      teamSlug: resolvedContext.repo_admin_team_slug,
      owner: request.organization,
      repo: request.repository_name_normalized,
    });
    currentRepoAdminPermission = permissionState && permissionState.current_permission_api_value
      ? permissionState.current_permission_api_value
      : 'none';
  }

  if (duplicateOwnedRepositoryConflict && duplicateOwnedRepositoryAllowNoop && repositoryState && repositoryState.exists) {
    duplicateOwnedRepositoryStatus = 'already_owned_existing_repository';
    duplicateOwnedRepositoryConflict = null;
    errors.splice(0, errors.length, ...errors.filter((entry) => !/already present in tenant topology owned repositories/i.test(entry)));
  }

  // Per-request authorization gate (V2.2.1 create-repo rule): the requester must
  // be an active member or maintainer of the tenant repo-admin team, or an active
  // maintainer of the tenant top team (aka Tenant Admin). Evaluated once against
  // live team membership and stamped on every repository row.
  const repoAdminTeamSlug = resolvedContext ? resolvedContext.repo_admin_team_slug : '';
  const tenantTopTeamSlug = resolvedContext ? resolvedContext.tenant_team_slug : '';
  const gateMembershipCache = new Map();
  async function resolveGateMembership(teamSlug) {
    if (!teamSlug || typeof options.getMembershipForUser !== 'function') {
      return { state: 'unknown', role: '' };
    }
    if (gateMembershipCache.has(teamSlug)) {
      return gateMembershipCache.get(teamSlug);
    }
    const membership = await options.getMembershipForUser({
      organization: request.organization,
      teamSlug,
      username: request.requester_login,
    });
    const resolved = {
      state: membership && membership.state ? String(membership.state).toLowerCase() : 'absent',
      role: membership && membership.membership && membership.membership.role
        ? String(membership.membership.role).toLowerCase()
        : '',
    };
    gateMembershipCache.set(teamSlug, resolved);
    return resolved;
  }

  let requesterIsRepoAdminTeamMember = false;
  let requesterIsTenantTopMaintainer = false;
  if (resolvedContext) {
    const repoAdminMembership = await resolveGateMembership(repoAdminTeamSlug);
    requesterIsRepoAdminTeamMember = repoAdminMembership.state === 'active'
      && (repoAdminMembership.role === 'member' || repoAdminMembership.role === 'maintainer');
    const topMembership = await resolveGateMembership(tenantTopTeamSlug);
    requesterIsTenantTopMaintainer = topMembership.state === 'active' && topMembership.role === 'maintainer';
  }
  const requesterAuthorizedForTenant = requesterIsRepoAdminTeamMember || requesterIsTenantTopMaintainer;
  const requesterAuthorizationPath = requesterIsRepoAdminTeamMember
    ? 'tenant_repo_admin_team'
    : requesterIsTenantTopMaintainer
      ? 'tenant_admin_maintainer'
      : 'none';

  // Evaluate every requested repository row independently. The primary row (the
  // single-item fields or the first CSV row) also drives the backward-compatible
  // top-level findings above; additional rows are evaluated here and never fail
  // the whole request unless they are all rejected.
  const inputRepositoryEntries = Array.isArray(request.repository_entries) && request.repository_entries.length > 0
    ? request.repository_entries
    : [{
        repository_name_input: request.repository_name_input,
        repository_name_normalized: request.repository_name_normalized,
        repository_visibility: request.repository_visibility,
        repository_visibility_source: request.repository_visibility_source,
        primary_contact: request.primary_contact,
        primary_contact_type: request.primary_contact_type,
        secondary_contact: request.secondary_contact,
        secondary_contact_type: request.secondary_contact_type,
        source: 'form',
      }];

  const repositoryExistsCache = new Map();
  if (request.repository_name_normalized) {
    repositoryExistsCache.set(request.repository_name_normalized, repositoryState);
  }
  async function resolveEntryRepositoryState(repoName) {
    if (repositoryExistsCache.has(repoName)) {
      return repositoryExistsCache.get(repoName);
    }
    let state = { exists: false, repository: null };
    if (request.organization && repoName && typeof options.getRepository === 'function') {
      state = await options.getRepository({ owner: request.organization, repo: repoName });
    }
    repositoryExistsCache.set(repoName, state);
    return state;
  }

  function resolveOwnedDuplicate(entry) {
    if (!resolvedContext) {
      return false;
    }
    const ownedRepositories = Array.isArray(resolvedContext.owned_repositories)
      ? resolvedContext.owned_repositories
      : [];
    const requestedNormalized = normalizeOwnedRepositoryName(entry.repository_name_input || entry.repository_name_normalized);
    const contextTenantId = String(resolvedContext.tenant_id || resolvedContext.tenant_key || '').trim().toLowerCase();
    return ownedRepositories.some((owned) => {
      const candidateName = owned && typeof owned === 'object' ? normalizeOwnedRepositoryName(owned.repoName) : '';
      const candidateTenantId = owned && typeof owned === 'object' ? String(owned.tenantId || '').trim().toLowerCase() : '';
      if (!candidateName || !requestedNormalized) {
        return false;
      }
      if (candidateTenantId && contextTenantId && candidateTenantId !== contextTenantId) {
        return false;
      }
      return candidateName === requestedNormalized;
    });
  }

  async function evaluateRepositoryEntry(entry) {
    const repositoryNameNormalized = entry.repository_name_normalized
      || normalizeRepositoryName(entry.repository_name_input);
    const repoState = await resolveEntryRepositoryState(repositoryNameNormalized);
    const exists = Boolean(repoState && repoState.exists);
    const enriched = {
      repository_name_input: entry.repository_name_input || '',
      repository_name_normalized: repositoryNameNormalized,
      repository_visibility: entry.repository_visibility || '',
      repository_visibility_source: entry.repository_visibility_source || 'not_provided',
      primary_contact: entry.primary_contact ?? null,
      primary_contact_type: entry.primary_contact_type || 'absent',
      secondary_contact: entry.secondary_contact ?? null,
      secondary_contact_type: entry.secondary_contact_type || 'absent',
      source: entry.source || 'form',
      tenant_key: resolvedContext ? resolvedContext.tenant_key : '',
      tenant_id: resolvedContext ? (resolvedContext.tenant_id || resolvedContext.tenant_key || '') : '',
      repo_admin_team_slug: repoAdminTeamSlug,
      authorization_path: requesterAuthorizationPath,
      authorized: requesterAuthorizedForTenant,
      repository_exists: exists,
      existing_visibility: exists && repoState.repository && repoState.repository.visibility
        ? String(repoState.repository.visibility).toLowerCase()
        : null,
      action: 'reject',
      row_status: 'rejected',
      failure_reason: null,
    };

    if (!repositoryNameNormalized || !isSafeRepositoryName(repositoryNameNormalized)) {
      enriched.failure_reason = 'invalid_repository_name';
      return enriched;
    }
    if (!requesterAuthorizedForTenant) {
      enriched.failure_reason = 'unauthorized';
      return enriched;
    }
    if (enriched.repository_visibility_source === 'not_provided') {
      enriched.failure_reason = 'missing_visibility';
      return enriched;
    }
    if (!ALLOWED_REPOSITORY_VISIBILITIES.includes(enriched.repository_visibility)) {
      enriched.failure_reason = 'invalid_visibility';
      return enriched;
    }
    if (enriched.primary_contact_type === 'absent') {
      enriched.failure_reason = 'missing_primary_contact';
      return enriched;
    }
    if (enriched.primary_contact_type === 'invalid') {
      enriched.failure_reason = 'invalid_primary_contact';
      return enriched;
    }
    if (enriched.secondary_contact_type === 'invalid') {
      enriched.failure_reason = 'invalid_secondary_contact';
      return enriched;
    }
    if (exists) {
      // Idempotency: an already-existing repository is a per-row no-op.
      enriched.action = 'noop';
      enriched.row_status = 'valid';
      return enriched;
    }
    if (resolveOwnedDuplicate(entry)) {
      enriched.failure_reason = 'duplicate_owned_repository';
      return enriched;
    }
    enriched.action = 'create';
    enriched.row_status = 'valid';
    return enriched;
  }

  const repositoryPlanEntries = [];
  const seenEntryKeys = new Set();
  for (const entry of inputRepositoryEntries) {
    const enriched = await evaluateRepositoryEntry(entry);
    const dedupeKey = enriched.repository_name_normalized;
    if (dedupeKey && seenEntryKeys.has(dedupeKey)) {
      enriched.action = 'noop';
      enriched.row_status = 'rejected';
      enriched.failure_reason = 'duplicate_row';
      warnings.push(`Repository '${enriched.repository_name_input}' was requested more than once; the first occurrence is used.`);
    } else if (dedupeKey) {
      seenEntryKeys.add(dedupeKey);
    }
    if (enriched.row_status !== 'valid' && enriched.source === 'csv') {
      warnings.push(`Repository row '${enriched.repository_name_input || enriched.repository_name_normalized}' was rejected (${enriched.failure_reason}).`);
    }
    repositoryPlanEntries.push(enriched);
  }
  const validRepositoryEntryCount = repositoryPlanEntries.filter((entry) => entry.row_status === 'valid').length;
  const rejectedRepositoryEntryCount = repositoryPlanEntries.length - validRepositoryEntryCount;

  if (request.dry_run) {
    warnings.push('Dry-run is enabled; reconciliation intent is reported without mutation.');
  }

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';
  const canonicalTenantContext = resolvedContext
    ? {
        tenant_key: resolvedContext.tenant_key,
        tenant_display_name: resolvedContext.tenant_display_name,
        organization: resolvedContext.organization,
        registry_ref: resolvedContext.registry_ref,
        tenant_team_name: resolvedContext.tenant_team_name,
        tenant_team_slug: resolvedContext.tenant_team_slug,
        repo_admin_team_name: resolvedContext.repo_admin_team_name,
        repo_admin_team_slug: resolvedContext.repo_admin_team_slug,
        topology_mode: resolvedContext.topology_mode || 'legacy_projection',
        owned_repositories_status: resolvedContext.owned_repositories_status || 'absent',
        access_model_enforcement: resolvedContext.access_model_enforcement || '',
        access_model_roles: Array.isArray(resolvedContext.access_model_roles)
          ? resolvedContext.access_model_roles
          : [],
        canonical_fields_consulted: Array.isArray(resolvedContext.canonical_fields_consulted)
          ? resolvedContext.canonical_fields_consulted
          : [],
        source_file: resolvedContext.source_file || '',
        owned_repositories: Array.isArray(resolvedContext.owned_repositories)
          ? resolvedContext.owned_repositories
          : [],
        governance_relation_status: resolvedContext.governance_relation_status,
        tenant_match_count: tenantResolution.tenant_match_count,
        tenant_resolution_status: tenantResolution.tenant_resolution_status,
        context_marker: resolvedContext.context_marker,
      }
    : null;

  const enrichedRequest = {
    ...request,
    tenant_name_input: request.tenant_name_input,
    tenant_name_normalized: request.tenant_name_normalized,
    tenant_key: canonicalTenantContext ? canonicalTenantContext.tenant_key : '',
    tenant_display_name: canonicalTenantContext ? canonicalTenantContext.tenant_display_name : '',
    tenant_team_name: canonicalTenantContext ? canonicalTenantContext.tenant_team_name : '',
    tenant_team_slug: canonicalTenantContext ? canonicalTenantContext.tenant_team_slug : '',
    repo_admin_team_name: canonicalTenantContext ? canonicalTenantContext.repo_admin_team_name : '',
    repo_admin_team_slug: canonicalTenantContext ? canonicalTenantContext.repo_admin_team_slug : '',
    topology_mode: canonicalTenantContext ? canonicalTenantContext.topology_mode : '',
    context_marker: canonicalTenantContext ? canonicalTenantContext.context_marker : '',
    repository_entries: repositoryPlanEntries,
    request_status: requestStatus,
    no_mutation_evidence: request.dry_run
      ? {
          mode: 'dry_run_validation_only',
          no_mutation_planned: true,
        }
      : null,
  };

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    designated_approver_authorization: designatedApproverAuthorization,
    requester_authorization: {
      authorized: requesterAuthorizedForTenant,
      authorization_path: requesterAuthorizationPath,
      is_repo_admin_team_member: requesterIsRepoAdminTeamMember,
      is_tenant_top_team_maintainer: requesterIsTenantTopMaintainer,
      repo_admin_team_slug: repoAdminTeamSlug,
      tenant_top_team_slug: tenantTopTeamSlug,
    },
    entries: repositoryPlanEntries,
    valid_entry_count: validRepositoryEntryCount,
    rejected_entry_count: rejectedRepositoryEntryCount,
    plan: {
      organization: request.organization,
      entries: repositoryPlanEntries,
      valid_entry_count: validRepositoryEntryCount,
      rejected_entry_count: rejectedRepositoryEntryCount,
      dry_run: Boolean(request.dry_run),
    },
    canonical_tenant_context: canonicalTenantContext,
    tenant_resolution: {
      tenant_match_count: tenantResolution.tenant_match_count,
      tenant_resolution_status: tenantResolution.tenant_resolution_status,
      candidates: tenantResolution.candidates,
      registry_ref: tenantResolution.registry_ref,
      registry_directory: tenantResolution.registry_directory,
      registry_malformed_files: tenantResolution.registry_malformed_files,
      registry_missing_directory: tenantResolution.registry_missing_directory,
      requested_tenant_name: tenantResolution.requested_tenant_name,
      requested_tenant_name_normalized: tenantResolution.requested_tenant_name_normalized,
      candidate_registry_record_count: tenantResolution.candidate_registry_record_count,
      available_tenant_display_names: tenantResolution.available_tenant_display_names || [],
    },
    repository_exists: Boolean(repositoryState && repositoryState.exists),
    repository_state: repositoryState,
    current_repo_admin_permission: currentRepoAdminPermission,
    validation_findings: {
      tenant_resolution_status: tenantResolution.tenant_resolution_status,
      governance_relation_status: canonicalTenantContext ? canonicalTenantContext.governance_relation_status : 'unknown',
      context_marker: canonicalTenantContext ? canonicalTenantContext.context_marker : '',
      topology_mode: canonicalTenantContext ? canonicalTenantContext.topology_mode : 'unknown',
      owned_repositories_status: canonicalTenantContext ? canonicalTenantContext.owned_repositories_status : 'unknown',
      duplicate_owned_repository_status: duplicateOwnedRepositoryStatus,
      duplicate_owned_repository_conflict: duplicateOwnedRepositoryConflict,
      canonical_topology_validation_status: canonicalTopologyValidationStatus,
      access_model_enforcement: canonicalTenantContext ? canonicalTenantContext.access_model_enforcement : '',
      access_model_roles: canonicalTenantContext ? canonicalTenantContext.access_model_roles : [],
      canonical_fields_consulted: canonicalTenantContext ? canonicalTenantContext.canonical_fields_consulted : [],
      primary_contact_validation: {
        field: 'primary_contact',
        submitted_value: request.primary_contact,
        detected_type: primaryContactDetectedType,
        normalized_value: request.primary_contact,
        validation_status: primaryContactValidationStatus,
        validation_reason: primaryContactValidationReason,
      },
      secondary_contact_validation: {
        field: 'secondary_contact',
        submitted_value: request.secondary_contact,
        detected_type: secondaryContactDetectedType,
        normalized_value: request.secondary_contact,
        validation_status: secondaryContactValidationStatus,
        validation_reason: secondaryContactValidationReason,
      },
      requested_visibility: repositoryVisibility,
      allowed_repository_visibilities: allowedRepositoryVisibilities,
      visibility_validation_status: visibilityValidationStatus,
      visibility_validation_reason: visibilityValidationReason,
      repository_exists: Boolean(repositoryState && repositoryState.exists),
      current_repo_admin_permission: currentRepoAdminPermission,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    primary_contact_validation: {
      field: 'primary_contact',
      submitted_value: request.primary_contact,
      detected_type: primaryContactDetectedType,
      normalized_value: request.primary_contact,
      validation_status: primaryContactValidationStatus,
      validation_reason: primaryContactValidationReason,
    },
    secondary_contact_validation: {
      field: 'secondary_contact',
      submitted_value: request.secondary_contact,
      detected_type: secondaryContactDetectedType,
      normalized_value: request.secondary_contact,
      validation_status: secondaryContactValidationStatus,
      validation_reason: secondaryContactValidationReason,
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  isSafeRepositoryName,
  validateTenantRepoRequest,
};