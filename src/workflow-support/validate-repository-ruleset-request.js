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

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeRulesetNameForComparison(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildRulesetContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: String(input.operation || 'repository_ruleset'),
    ruleset_operation: String(input.ruleset_operation || ''),
    organization: normalizeLogin(input.organization),
    tenant_key: normalizeLogin(input.tenant_key),
    repository: normalizeLogin(input.repository),
    ruleset_name: normalizeRulesetNameForComparison(input.ruleset_name),
    designated_approver_login: normalizeLogin(input.designated_approver_login),
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
  const tenantNameNormalized = normalizeTenantName(request.tenant_name_normalized || request.tenant_name_input);
  const rulesetOperation = String(request.ruleset_operation || '').toLowerCase();
  const repositoryTarget = String(request.repository_target_normalized || '').toLowerCase();
  const rulesetName = String(request.ruleset_name_input || request.ruleset_name_normalized || '');

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.repository_target_input) {
    errors.push('Target repository is required.');
  }

  if (!rulesetName) {
    errors.push('Ruleset name is required.');
  }

  if (!ALLOWED_RULESET_OPERATIONS.includes(rulesetOperation)) {
    errors.push(`Ruleset operation '${request.ruleset_operation || ''}' is invalid. Allowed values are: ${ALLOWED_RULESET_OPERATIONS.join(', ')}.`);
  }

  if (rulesetOperation === 'create') {
    if (!ALLOWED_RULESET_TARGETS.includes(String(request.ruleset_target || '').toLowerCase())) {
      errors.push(`Ruleset target '${request.ruleset_target || ''}' is invalid. Allowed values are: ${ALLOWED_RULESET_TARGETS.join(', ')}.`);
    }
    if (!ALLOWED_RULESET_ENFORCEMENTS.includes(String(request.enforcement || '').toLowerCase())) {
      errors.push(`Ruleset enforcement '${request.enforcement || ''}' is invalid. Allowed values are: ${ALLOWED_RULESET_ENFORCEMENTS.join(', ')}.`);
    }
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

  // Tenant context is OPTIONAL for repository ruleset operations. Repositories
  // may be imported outside the tenant model and must still be manageable, so
  // registry problems and unresolved tenants are recorded as context only, never
  // as validation failures.
  const registryResult = readTenantRegistryRecords({ registryDirectory: options.registryDirectory });
  if (registryResult.missing_directory) {
    warnings.push('Tenant registry directory is not present; proceeding without tenant context.');
  }
  if (registryResult.malformed_files && registryResult.malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }

  const orgViews = registryResult.records
    .map((record) => readTopologyView(record))
    .filter((view) => view.organization && view.organization === organization);
  const nameMatches = tenantNameNormalized
    ? orgViews.filter((view) => normalizeTenantName(view.tenant_display_name) === tenantNameNormalized)
    : [];

  let tenantResolutionStatus = 'no_match';
  if (nameMatches.length === 1) {
    tenantResolutionStatus = 'resolved';
  } else if (nameMatches.length > 1) {
    tenantResolutionStatus = 'ambiguous';
    warnings.push(`Tenant name '${request.tenant_name_input}' matched multiple tenant records in organization '${request.organization}'; proceeding with repository-level authorization only.`);
  }

  const resolvedView = tenantResolutionStatus === 'resolved' ? nameMatches[0] : null;
  const availableTenantDisplayNames = [...new Set(orgViews
    .map((view) => String(view.tenant_display_name || '').split(/[\r\n]+/)[0].trim())
    .filter(Boolean))];

  const tenantKey = resolvedView ? resolvedView.tenant_key : '';
  const tenantDisplayName = resolvedView ? resolvedView.tenant_display_name : '';
  const tenantTopTeamSlug = resolvedView ? resolvedView.tenant_root_team_slug : '';

  // Optional repository existence pre-check for a clean, specific error.
  let repositoryExists = false;
  if (repositoryTarget && typeof options.getRepository === 'function') {
    const repositoryResult = await options.getRepository({ owner: organization, repo: repositoryTarget });
    repositoryExists = Boolean(repositoryResult && repositoryResult.exists);
    if (!repositoryExists) {
      errors.push(`Repository '${organization}/${repositoryTarget}' does not exist or is not visible to the workflow identity.`);
    }
  }

  // Primary authorization: the requester must have admin permission on the
  // TARGET repository. Organization owners resolve to admin on every repository,
  // direct repository admins pass for their own repositories, and repo-admin
  // team members pass wherever the team was granted admin. This works for
  // imported repositories that are not in the tenant model.
  let requesterRepositoryPermission = 'unknown';
  let isRepositoryAdmin = false;
  let performedAuthorizationCheck = false;
  if (repositoryTarget && typeof options.getRepositoryCollaboratorPermission === 'function') {
    performedAuthorizationCheck = true;
    const permissionResult = await options.getRepositoryCollaboratorPermission({
      owner: organization,
      repo: repositoryTarget,
      username: requesterLogin,
    });
    requesterRepositoryPermission = permissionResult && permissionResult.permission
      ? String(permissionResult.permission).toLowerCase()
      : 'none';
    isRepositoryAdmin = requesterRepositoryPermission === 'admin';
  }

  // Additive authorization: an active MAINTAINER of the tenant top team may
  // manage rulesets on repositories that resolve to their tenant. This never
  // blocks a repository that is not in the registry.
  let requesterTenantMembershipState = 'not_applicable';
  let isTenantTopMaintainer = false;
  if (resolvedView && tenantTopTeamSlug && typeof options.getMembershipForUser === 'function') {
    performedAuthorizationCheck = true;
    const membership = await options.getMembershipForUser({
      organization,
      teamSlug: tenantTopTeamSlug,
      username: requesterLogin,
    });
    const state = membership && membership.state ? String(membership.state).toLowerCase() : 'absent';
    const role = membership && membership.membership && membership.membership.role
      ? String(membership.membership.role).toLowerCase()
      : '';
    requesterTenantMembershipState = state === 'active' && role === 'maintainer'
      ? 'active_maintainer'
      : state === 'active'
        ? 'active_member'
        : state === 'absent'
          ? 'absent'
          : 'unknown';
    isTenantTopMaintainer = requesterTenantMembershipState === 'active_maintainer';
  }

  const authorized = isRepositoryAdmin || isTenantTopMaintainer;
  const authorizationPath = isRepositoryAdmin
    ? 'repository_admin'
    : isTenantTopMaintainer
      ? 'tenant_top_team_maintainer'
      : 'none';

  if (performedAuthorizationCheck && !authorized) {
    const tenantClause = resolvedView
      ? ` and is not an active maintainer of the tenant top team '${tenantTopTeamSlug}'`
      : '';
    errors.push(`Requester '${request.requester_login}' does not have admin permission on repository '${organization}/${repositoryTarget}'${tenantClause} and cannot manage repository rulesets.`);
  }

  // Read current ruleset state so the reconciliation intent converges on re-runs.
  let rulesetExists = false;
  let existingRulesetId = null;
  if (repositoryTarget && rulesetName && typeof options.listRepositoryRulesets === 'function') {
    const rulesets = await options.listRepositoryRulesets({ owner: organization, repo: repositoryTarget });
    const existing = (rulesets || []).find(
      (ruleset) => normalizeRulesetNameForComparison(ruleset.name) === normalizeRulesetNameForComparison(rulesetName)
    );
    if (existing) {
      rulesetExists = true;
      existingRulesetId = existing.id != null ? existing.id : null;
    }
  }

  let plannedAction = 'unknown';
  if (rulesetOperation === 'create') {
    plannedAction = rulesetExists ? 'noop' : 'create';
    if (rulesetExists) {
      warnings.push(`A ruleset named '${rulesetName}' already exists on '${repositoryTarget}'; execution will converge as no-op.`);
    }
  } else if (rulesetOperation === 'delete') {
    plannedAction = rulesetExists ? 'delete' : 'noop';
    if (!rulesetExists && repositoryTarget) {
      warnings.push(`No ruleset named '${rulesetName}' was found on '${repositoryTarget}'; execution will converge as no-op.`);
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

  if (request.dry_run) {
    warnings.push('Dry-run is enabled; reconciliation intent is reported without mutation.');
  }

  const rulesetPayload = rulesetOperation === 'create' ? buildRepositoryRulesetPayload(request) : null;
  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';
  const contextMarker = buildRulesetContextMarker({
    operation: rulesetOperation === 'delete' ? 'repository_ruleset_deletion' : 'repository_ruleset_creation',
    ruleset_operation: rulesetOperation,
    organization,
    tenant_key: tenantKey,
    repository: repositoryTarget,
    ruleset_name: rulesetName,
    designated_approver_login: request.designated_approver_login,
    registry_ref: registryRef,
  });

  const canonicalTenantContext = resolvedView
    ? {
        tenant_key: tenantKey,
        tenant_display_name: tenantDisplayName,
        organization,
        registry_ref: registryRef,
        tenant_team_name: tenantTopTeamSlug,
        tenant_team_slug: tenantTopTeamSlug,
        tenant_resolution_status: tenantResolutionStatus,
        context_marker: contextMarker,
      }
    : null;

  const enrichedRequest = {
    ...request,
    tenant_key: tenantKey,
    tenant_display_name: tenantDisplayName,
    tenant_team_name: tenantTopTeamSlug,
    tenant_team_slug: tenantTopTeamSlug,
    requester_repository_permission: requesterRepositoryPermission,
    authorization_path: authorizationPath,
    context_marker: contextMarker,
    request_status: requestStatus,
  };

  const plan = {
    organization,
    ruleset_operation: rulesetOperation,
    repository: repositoryTarget,
    ruleset_name: rulesetName,
    ruleset_exists: rulesetExists,
    existing_ruleset_id: existingRulesetId,
    planned_action: plannedAction,
    ruleset_payload: rulesetPayload,
    dry_run: Boolean(request.dry_run),
  };

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    repository_exists: repositoryExists,
    ruleset_exists: rulesetExists,
    existing_ruleset_id: existingRulesetId,
    requester_repository_permission: requesterRepositoryPermission,
    is_repository_admin: isRepositoryAdmin,
    is_tenant_top_maintainer: isTenantTopMaintainer,
    authorization_path: authorizationPath,
    designated_approver_authorization: designatedApproverAuthorization,
    canonical_tenant_context: canonicalTenantContext,
    tenant_resolution: {
      tenant_match_count: nameMatches.length,
      tenant_resolution_status: tenantResolutionStatus,
      registry_ref: registryRef,
      registry_directory: registryResult.registry_directory,
      registry_malformed_files: registryResult.malformed_files,
      registry_missing_directory: registryResult.missing_directory,
      requested_tenant_name: request.tenant_name_input,
      requested_tenant_name_normalized: tenantNameNormalized,
      candidate_registry_record_count: nameMatches.length,
      available_tenant_display_names: availableTenantDisplayNames,
    },
    plan,
    validation_findings: {
      tenant_resolution_status: tenantResolutionStatus,
      requester_repository_permission: requesterRepositoryPermission,
      is_repository_admin: isRepositoryAdmin,
      requester_tenant_membership_state: requesterTenantMembershipState,
      is_tenant_top_maintainer: isTenantTopMaintainer,
      authorization_path: authorizationPath,
      ruleset_operation: rulesetOperation,
      ruleset_exists: rulesetExists,
      planned_action: plannedAction,
      context_marker: contextMarker,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  buildRulesetContextMarker,
  validateRepositoryRulesetRequest,
};
