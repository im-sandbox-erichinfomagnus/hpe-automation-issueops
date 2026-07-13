'use strict';

const crypto = require('crypto');

const {
  ALLOWED_RULESET_OPERATIONS,
  ALLOWED_RULESET_TARGETS,
  ALLOWED_RULESET_ENFORCEMENTS,
  buildRepositoryRulesetPayload,
  parseRepositoryRulesetRequest,
} = require('./parse-repository-ruleset-request');
const { readTenantRegistryRecords } = require('./resolve-tenant-context-from-registry');
const { readTopologyView } = require('./resolve-tenant-cicd-context-from-registry');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRepositoryNameForComparison(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRulesetNameForComparison(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractOwnedRepositories(record = {}) {
  const topology = record.topology && typeof record.topology === 'object' ? record.topology : null;
  const owned = topology && topology.repositories && Array.isArray(topology.repositories.owned)
    ? topology.repositories.owned
    : [];
  return owned
    .map((entry) => (typeof entry === 'string'
      ? entry
      : entry && (entry.name || entry.repository || entry.repo || entry.repo_name) || ''))
    .filter(Boolean);
}

// Index every registry-owned repository in the organization to its tenant so a
// row's target repository can resolve to a tenant. Repositories that are not in
// the model simply do not appear here, which is expected for imports.
function buildRepositoryTenantIndex(records, organization) {
  const index = new Map();
  for (const record of records) {
    const view = readTopologyView(record);
    if (!view.organization || view.organization !== organization) {
      continue;
    }
    for (const ownedRepo of extractOwnedRepositories(record)) {
      const key = normalizeRepositoryNameForComparison(ownedRepo);
      if (!key || index.has(key)) {
        continue;
      }
      index.set(key, {
        tenant_key: view.tenant_key,
        tenant_display_name: view.tenant_display_name,
        repo_admin_team_slug: view.repo_admin_team_slug,
        tenant_root_team_slug: view.tenant_root_team_slug,
      });
    }
  }
  return index;
}

function buildRulesetContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: String(input.operation || 'repository_ruleset'),
    ruleset_operation: String(input.ruleset_operation || ''),
    organization: normalizeLogin(input.organization),
    designated_approver_login: normalizeLogin(input.designated_approver_login),
    entries: [...(input.entries || [])].sort(),
    registry_ref: String(input.registry_ref || 'main'),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `repository-ruleset-context:${digest}`;
}

async function validateRepositoryRulesetRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseRepositoryRulesetRequest(input);
  const errors = [];
  const warnings = [];

  const registryRef = String(options.registryRef || process.env.TENANT_REGISTRY_REF || 'main');
  const organization = normalizeLogin(request.organization);
  const requesterLogin = normalizeLogin(request.requester_login);
  const rulesetOperation = String(request.ruleset_operation || '').toLowerCase();
  const inputEntries = Array.isArray(request.ruleset_entries) ? request.ruleset_entries : [];

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!ALLOWED_RULESET_OPERATIONS.includes(rulesetOperation)) {
    errors.push(`Ruleset operation '${request.ruleset_operation || ''}' is invalid. Allowed values are: ${ALLOWED_RULESET_OPERATIONS.join(', ')}.`);
  }

  if (inputEntries.length === 0) {
    errors.push('Provide at least one ruleset via the single-item fields or the CSV batch.');
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

  // Tenant context is OPTIONAL. Repositories may be imported outside the tenant
  // model and must still be manageable, so registry problems are context only.
  const registryResult = readTenantRegistryRecords({ registryDirectory: options.registryDirectory });
  if (registryResult.missing_directory) {
    warnings.push('Tenant registry directory is not present; proceeding without tenant context.');
  }
  if (registryResult.malformed_files && registryResult.malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }
  const repositoryTenantIndex = buildRepositoryTenantIndex(registryResult.records, organization);

  // Per-requester caches so repeated repositories/teams cost one lookup each.
  const permissionCache = new Map();
  const membershipCache = new Map();
  const repositoryExistsCache = new Map();
  const rulesetsCache = new Map();

  async function resolveRepositoryPermission(repo) {
    if (permissionCache.has(repo)) {
      return permissionCache.get(repo);
    }
    let permission = 'unknown';
    if (typeof options.getRepositoryCollaboratorPermission === 'function') {
      const result = await options.getRepositoryCollaboratorPermission({
        owner: organization,
        repo,
        username: requesterLogin,
      });
      permission = result && result.permission ? String(result.permission).toLowerCase() : 'none';
    }
    permissionCache.set(repo, permission);
    return permission;
  }

  async function resolveTeamMembership(teamSlug) {
    if (!teamSlug || typeof options.getMembershipForUser !== 'function') {
      return { state: 'unknown', role: '' };
    }
    if (membershipCache.has(teamSlug)) {
      return membershipCache.get(teamSlug);
    }
    const membership = await options.getMembershipForUser({
      organization,
      teamSlug,
      username: requesterLogin,
    });
    const resolved = {
      state: membership && membership.state ? String(membership.state).toLowerCase() : 'absent',
      role: membership && membership.membership && membership.membership.role
        ? String(membership.membership.role).toLowerCase()
        : '',
    };
    membershipCache.set(teamSlug, resolved);
    return resolved;
  }

  async function resolveRepositoryExists(repo) {
    if (typeof options.getRepository !== 'function') {
      return true;
    }
    if (repositoryExistsCache.has(repo)) {
      return repositoryExistsCache.get(repo);
    }
    const result = await options.getRepository({ owner: organization, repo });
    const exists = Boolean(result && result.exists);
    repositoryExistsCache.set(repo, exists);
    return exists;
  }

  async function resolveRulesets(repo) {
    if (typeof options.listRepositoryRulesets !== 'function') {
      return [];
    }
    if (rulesetsCache.has(repo)) {
      return rulesetsCache.get(repo);
    }
    const rulesets = (await options.listRepositoryRulesets({ owner: organization, repo })) || [];
    rulesetsCache.set(repo, rulesets);
    return rulesets;
  }

  const planEntries = [];
  const seenKeys = new Set();
  for (const entry of inputEntries) {
    const repository = normalizeRepositoryNameForComparison(entry.repository);
    const rulesetName = String(entry.ruleset_name || '');
    const enriched = {
      repository,
      repository_input: entry.repository_input || entry.repository || '',
      ruleset_name: rulesetName,
      source: entry.source || 'form',
      ruleset_operation: rulesetOperation,
      tenant_key: '',
      tenant_display_name: '',
      requester_repository_permission: 'unknown',
      authorization_path: 'none',
      authorized: false,
      repository_exists: false,
      ruleset_exists: false,
      existing_ruleset_id: null,
      action: 'reject',
      row_status: 'rejected',
      failure_reason: null,
      ruleset_payload: null,
    };

    if (rulesetOperation === 'create') {
      enriched.target = entry.target || 'branch';
      enriched.ref_name_pattern = entry.ref_name_pattern || '~DEFAULT_BRANCH';
      enriched.enforcement = entry.enforcement || 'active';
      enriched.require_pull_request = Boolean(entry.require_pull_request);
      enriched.block_force_pushes = Boolean(entry.block_force_pushes);
      enriched.require_linear_history = Boolean(entry.require_linear_history);
      enriched.restrict_deletions = Boolean(entry.restrict_deletions);
    }

    if (!repository || !rulesetName) {
      enriched.failure_reason = 'invalid_row';
      warnings.push('A ruleset row is missing a repository or ruleset name and was rejected.');
      planEntries.push(enriched);
      continue;
    }

    const dedupeKey = `${repository} ${normalizeRulesetNameForComparison(rulesetName)}`;
    if (seenKeys.has(dedupeKey)) {
      enriched.failure_reason = 'duplicate_row';
      enriched.action = 'noop';
      warnings.push(`Ruleset '${rulesetName}' on '${repository}' was requested more than once; the first occurrence is used.`);
      planEntries.push(enriched);
      continue;
    }
    seenKeys.add(dedupeKey);

    if (rulesetOperation === 'create') {
      if (!ALLOWED_RULESET_TARGETS.includes(String(enriched.target).toLowerCase())) {
        enriched.failure_reason = 'invalid_target';
        warnings.push(`Ruleset '${rulesetName}' on '${repository}' has invalid target '${enriched.target}' and was rejected.`);
        planEntries.push(enriched);
        continue;
      }
      if (!ALLOWED_RULESET_ENFORCEMENTS.includes(String(enriched.enforcement).toLowerCase())) {
        enriched.failure_reason = 'invalid_enforcement';
        warnings.push(`Ruleset '${rulesetName}' on '${repository}' has invalid enforcement '${enriched.enforcement}' and was rejected.`);
        planEntries.push(enriched);
        continue;
      }
    }

    const repositoryExists = await resolveRepositoryExists(repository);
    enriched.repository_exists = repositoryExists;
    if (!repositoryExists) {
      enriched.failure_reason = 'repository_not_found';
      warnings.push(`Repository '${organization}/${repository}' does not exist or is not visible; the row was rejected.`);
      planEntries.push(enriched);
      continue;
    }

    // Per-row authorization. Primary: admin permission on the target repository.
    const permission = await resolveRepositoryPermission(repository);
    enriched.requester_repository_permission = permission;
    const isRepositoryAdmin = permission === 'admin';

    // Additive: when the row's repository resolves to a tenant, an active
    // member/maintainer of that tenant's repo-admin team or an active maintainer
    // of the tenant top team is also authorized.
    const tenant = repositoryTenantIndex.get(repository) || null;
    let isRepoAdminTeamMember = false;
    let isTenantTopMaintainer = false;
    if (tenant) {
      enriched.tenant_key = tenant.tenant_key || '';
      enriched.tenant_display_name = tenant.tenant_display_name || '';
      if (tenant.repo_admin_team_slug) {
        const repoAdminMembership = await resolveTeamMembership(tenant.repo_admin_team_slug);
        isRepoAdminTeamMember = repoAdminMembership.state === 'active'
          && (repoAdminMembership.role === 'member' || repoAdminMembership.role === 'maintainer');
      }
      if (tenant.tenant_root_team_slug) {
        const topMembership = await resolveTeamMembership(tenant.tenant_root_team_slug);
        isTenantTopMaintainer = topMembership.state === 'active' && topMembership.role === 'maintainer';
      }
    }

    const authorized = isRepositoryAdmin || isRepoAdminTeamMember || isTenantTopMaintainer;
    enriched.authorized = authorized;
    enriched.authorization_path = isRepositoryAdmin
      ? 'repository_admin'
      : isRepoAdminTeamMember
        ? 'tenant_repo_admin_team'
        : isTenantTopMaintainer
          ? 'tenant_top_team_maintainer'
          : 'none';

    if (!authorized) {
      enriched.failure_reason = 'unauthorized';
      const tenantClause = tenant
        ? ` and is not an active member of the tenant repo-admin team '${tenant.repo_admin_team_slug}' or maintainer of the tenant top team '${tenant.tenant_root_team_slug}'`
        : '';
      warnings.push(`Requester '${request.requester_login}' does not have admin permission on repository '${organization}/${repository}'${tenantClause}; the row was rejected.`);
      planEntries.push(enriched);
      continue;
    }

    // Read current ruleset state so the reconciliation intent converges.
    const rulesets = await resolveRulesets(repository);
    const existing = rulesets.find(
      (ruleset) => normalizeRulesetNameForComparison(ruleset.name) === normalizeRulesetNameForComparison(rulesetName)
    );
    if (existing) {
      enriched.ruleset_exists = true;
      enriched.existing_ruleset_id = existing.id != null ? existing.id : null;
    }

    if (rulesetOperation === 'create') {
      enriched.ruleset_payload = buildRepositoryRulesetPayload(entry);
      enriched.action = enriched.ruleset_exists ? 'noop' : 'create';
    } else {
      enriched.action = enriched.ruleset_exists ? 'delete' : 'noop';
    }
    enriched.row_status = 'valid';
    planEntries.push(enriched);
  }

  const validEntries = planEntries.filter((entry) => entry.row_status === 'valid');
  if (inputEntries.length > 0 && validEntries.length === 0 && errors.length === 0) {
    errors.push('No ruleset rows are authorized or well-formed; there is nothing to execute.');
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

  if (request.dry_run) {
    warnings.push('Dry-run is enabled; reconciliation intent is reported without mutation.');
  }

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';
  const contextMarker = buildRulesetContextMarker({
    operation: rulesetOperation === 'delete' ? 'repository_ruleset_deletion' : 'repository_ruleset_creation',
    ruleset_operation: rulesetOperation,
    organization,
    designated_approver_login: request.designated_approver_login,
    entries: planEntries.map((entry) => `${entry.repository}#${normalizeRulesetNameForComparison(entry.ruleset_name)}`),
    registry_ref: registryRef,
  });

  const enrichedRequest = {
    ...request,
    ruleset_entries: planEntries,
    context_marker: contextMarker,
    request_status: requestStatus,
  };

  const plan = {
    organization,
    ruleset_operation: rulesetOperation,
    entries: planEntries,
    valid_entry_count: validEntries.length,
    rejected_entry_count: planEntries.length - validEntries.length,
    dry_run: Boolean(request.dry_run),
  };

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    designated_approver_authorization: designatedApproverAuthorization,
    entries: planEntries,
    plan,
    tenant_resolution: {
      registry_ref: registryRef,
      registry_directory: registryResult.registry_directory,
      registry_malformed_files: registryResult.malformed_files,
      registry_missing_directory: registryResult.missing_directory,
      indexed_repository_count: repositoryTenantIndex.size,
    },
    validation_findings: {
      ruleset_operation: rulesetOperation,
      requested_entry_count: inputEntries.length,
      valid_entry_count: validEntries.length,
      rejected_entry_count: planEntries.length - validEntries.length,
      context_marker: contextMarker,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  buildRepositoryTenantIndex,
  buildRulesetContextMarker,
  extractOwnedRepositories,
  validateRepositoryRulesetRequest,
};
