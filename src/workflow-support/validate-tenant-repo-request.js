'use strict';

const { parseTenantRepoRequest } = require('./parse-tenant-repo-request');
const {
  ALLOWED_REPOSITORY_VISIBILITIES,
  describeAllowedRepositoryVisibilities,
  normalizeRepositoryVisibility,
} = require('./repository-visibility');
const { resolveTenantContextFromRegistry } = require('./resolve-tenant-context-from-registry');

function isSafeRepositoryName(value) {
  return /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/.test(String(value || ''));
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

  const { visibility: repositoryVisibility, source: repositoryVisibilitySource } = normalizeRepositoryVisibility(request.repository_visibility);
  const allowedRepositoryVisibilities = ALLOWED_REPOSITORY_VISIBILITIES;
  request.repository_visibility = repositoryVisibility;
  request.repository_visibility_source = request.repository_visibility_source || repositoryVisibilitySource;
  let visibilityValidationStatus = 'valid';
  let visibilityValidationReason = '';

  if (!allowedRepositoryVisibilities.includes(repositoryVisibility)) {
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
    context_marker: canonicalTenantContext ? canonicalTenantContext.context_marker : '',
    request_status: requestStatus,
  };

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    designated_approver_authorization: designatedApproverAuthorization,
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