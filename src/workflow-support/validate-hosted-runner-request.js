'use strict';

const {
  ALLOWED_IMAGE_SOURCES,
  parseHostedRunnerRequest,
} = require('./parse-hosted-runner-request');
const {
  resolveNamespaceOwner,
  resolveTenantCicdContextFromRegistry,
} = require('./resolve-tenant-cicd-context-from-registry');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveRunnerGroupTarget(request, resolvedContext, options = {}) {
  const requestedGroupName = String(request.runner_group_name_input || '').trim();
  const resolution = {
    requested_group_name: requestedGroupName,
    resolution_mode: requestedGroupName ? 'explicit_tenant_group' : 'organization_default',
    resolved_group_id: null,
    resolved_group_name: '',
    resolution_status: 'not_found',
  };

  if (requestedGroupName && resolvedContext) {
    const tenantPrefix = `${String(resolvedContext.tenant_display_name || '').trim().replace(/\s+/g, '_').toLowerCase()}_`;
    if (!requestedGroupName.toLowerCase().startsWith(tenantPrefix)) {
      resolution.resolution_status = 'pattern_mismatch';
      return resolution;
    }
  }

  if (typeof options.listRunnerGroups !== 'function') {
    resolution.resolution_status = requestedGroupName ? 'not_found' : 'default_unresolved';
    return resolution;
  }

  const groups = await options.listRunnerGroups({ organization: request.organization });
  if (requestedGroupName) {
    const match = (groups || []).find(
      (group) => String(group.name || '').toLowerCase() === requestedGroupName.toLowerCase()
    );
    if (match) {
      resolution.resolved_group_id = match.id;
      resolution.resolved_group_name = match.name;
      resolution.resolution_status = 'resolved';
    }
    return resolution;
  }

  const defaultGroup = (groups || []).find((group) => group.default);
  if (defaultGroup) {
    resolution.resolved_group_id = defaultGroup.id;
    resolution.resolved_group_name = defaultGroup.name;
    resolution.resolution_status = 'resolved';
  } else {
    resolution.resolution_status = 'default_unresolved';
  }

  return resolution;
}

async function validateHostedRunnerRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseHostedRunnerRequest(input);
  const errors = [];
  const warnings = [];

  if (Array.isArray(request.csv_input_errors)) {
    errors.push(...request.csv_input_errors);
  }

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.tenant_name_input) {
    errors.push('Tenant name is required.');
  }

  if (!request.runner_base_name_input) {
    errors.push('Runner name is required.');
  }

  if (!request.runner_image_id) {
    errors.push('Runner image id is required.');
  }

  if (!ALLOWED_IMAGE_SOURCES.includes(request.runner_image_source)) {
    errors.push(`Runner image source '${request.runner_image_source}' is invalid. Allowed values are: ${ALLOWED_IMAGE_SOURCES.join(', ')}.`);
  }

  if (!request.runner_size) {
    errors.push('Runner machine size is required.');
  }

  if (request.maximum_runners_valid === false) {
    errors.push('Maximum runners must be a positive integer when provided.');
  }

  if (!request.designated_approver_login) {
    errors.push('A designated approver is required.');
  }

  const runnerNameDerivation = request.runner_name_derivation || {};
  if (runnerNameDerivation.derivation_status !== 'valid') {
    for (const finding of runnerNameDerivation.constraint_findings || []) {
      errors.push(finding);
    }
    if (!runnerNameDerivation.constraint_findings || runnerNameDerivation.constraint_findings.length === 0) {
      errors.push('Runner name derivation failed.');
    }
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const organizationResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  const tenantResolution = await resolveTenantCicdContextFromRegistry(
    {
      requester_login: request.requester_login,
      organization: request.organization,
      tenant_name_input: request.tenant_name_input,
      tenant_name_normalized: request.tenant_name_normalized,
      operation: 'hosted_runner_creation',
      target_resource_name: request.runner_name_derived,
      designated_approver_login: request.designated_approver_login,
    },
    {
      registryDirectory: options.registryDirectory,
      registryRef: options.registryRef,
      listTeams: options.listTeams,
      getMembershipForUser: options.getMembershipForUser,
    }
  );

  if (tenantResolution.registry_missing_directory) {
    errors.push('Tenant registry directory is missing in the workflow workspace.');
  }

  if (tenantResolution.registry_malformed_files && tenantResolution.registry_malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }

  if (tenantResolution.tenant_resolution_status === 'no_match') {
    const missingCicdTeamCandidate = (tenantResolution.candidates || []).find(
      (candidate) => candidate.governance_relation_status === 'missing_cicd_admin_team'
    );
    const unauthorizedCandidate = (tenantResolution.candidates || []).find(
      (candidate) => candidate.authorization_status === 'unauthorized'
    );

    if (missingCicdTeamCandidate) {
      errors.push(
        `The tenant topology admin team '${missingCicdTeamCandidate.cicd_admin_team_name}' does not exist in organization '${request.organization}'. Provision the team before requesting tenant runners.`
      );
    } else if (unauthorizedCandidate) {
      errors.push(
        `Requester '${request.requester_login}' is not an active member of the tenant CI/CD admin team '${unauthorizedCandidate.cicd_admin_team_name}'.`
      );
    } else if (request.tenant_name_input) {
      errors.push(`No authorized tenant CI/CD context was found for tenant name '${request.tenant_name_input}' in organization '${request.organization}'.`);
      if (tenantResolution.available_tenant_display_names && tenantResolution.available_tenant_display_names.length > 0) {
        warnings.push(`Available tenant names in this organization: ${tenantResolution.available_tenant_display_names.join(', ')}`);
      }
    } else {
      errors.push('Requester could not be resolved against exactly one valid tenant CI/CD context.');
    }
  } else if (tenantResolution.tenant_resolution_status === 'ambiguous') {
    errors.push(`Tenant name '${request.tenant_name_input}' matched multiple authorized tenant CI/CD contexts and is ambiguous.`);
  } else if (tenantResolution.tenant_resolution_status === 'registry_conflict') {
    errors.push('Tenant registry data is malformed or conflicting for the target organization.');
  }

  const resolvedContext = tenantResolution.resolved_context;
  if (!resolvedContext) {
    errors.push('Canonical tenant CI/CD context did not resolve.');
  }

  if (resolvedContext && request.runner_name_derived) {
    const namespaceOwner = resolveNamespaceOwner(
      request.runner_name_derived,
      tenantResolution.available_tenant_display_names
    );
    if (
      namespaceOwner &&
      normalizeLogin(namespaceOwner) !== normalizeLogin(resolvedContext.tenant_display_name)
    ) {
      errors.push(
        `Derived runner name '${request.runner_name_derived}' falls within the naming namespace of tenant '${namespaceOwner}' and cannot be managed through tenant '${resolvedContext.tenant_display_name}'.`
      );
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

  let runnerExists = false;
  let existingRunnerId = null;
  if (
    request.organization &&
    request.runner_name_derived &&
    typeof options.listHostedRunners === 'function'
  ) {
    const runners = await options.listHostedRunners({ organization: request.organization });
    const existingRunner = (runners || []).find(
      (runner) => normalizeLogin(runner.name) === normalizeLogin(request.runner_name_derived)
    );
    if (existingRunner) {
      runnerExists = true;
      existingRunnerId = existingRunner.id;
      warnings.push(`A hosted runner named '${request.runner_name_derived}' already exists; execution will converge as no-op.`);
    }
  }

  let runnerGroupResolution = {
    requested_group_name: request.runner_group_name_input || '',
    resolution_mode: request.runner_group_name_input ? 'explicit_tenant_group' : 'organization_default',
    resolved_group_id: null,
    resolved_group_name: '',
    resolution_status: 'not_found',
  };
  if (request.organization && resolvedContext) {
    if (request.runner_group_name_input) {
      const groupNamespaceOwner = resolveNamespaceOwner(
        request.runner_group_name_input,
        tenantResolution.available_tenant_display_names
      );
      if (
        groupNamespaceOwner &&
        normalizeLogin(groupNamespaceOwner) !== normalizeLogin(resolvedContext.tenant_display_name)
      ) {
        errors.push(
          `Runner group name '${request.runner_group_name_input}' falls within the naming namespace of tenant '${groupNamespaceOwner}' and cannot be targeted through tenant '${resolvedContext.tenant_display_name}'.`
        );
      }
    }

    runnerGroupResolution = await resolveRunnerGroupTarget(request, resolvedContext, options);

    if (runnerGroupResolution.resolution_status === 'pattern_mismatch') {
      errors.push(`Runner group name '${request.runner_group_name_input}' does not carry the tenant naming prefix for tenant '${resolvedContext.tenant_display_name}'.`);
    } else if (runnerGroupResolution.resolution_status === 'not_found') {
      errors.push(`Runner group '${request.runner_group_name_input}' was not found in organization '${request.organization}'.`);
    } else if (runnerGroupResolution.resolution_status === 'default_unresolved') {
      errors.push('No runner group was provided and the organization default runner group could not be resolved.');
    }
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
        cicd_admin_team_name: resolvedContext.cicd_admin_team_name,
        cicd_admin_team_slug: resolvedContext.cicd_admin_team_slug,
        governance_relation_status: resolvedContext.governance_relation_status,
        requester_cicd_membership_state: resolvedContext.requester_cicd_membership_state,
        tenant_match_count: tenantResolution.tenant_match_count,
        tenant_resolution_status: tenantResolution.tenant_resolution_status,
        context_marker: resolvedContext.context_marker,
      }
    : null;

  const enrichedRequest = {
    ...request,
    tenant_key: canonicalTenantContext ? canonicalTenantContext.tenant_key : '',
    tenant_display_name: canonicalTenantContext ? canonicalTenantContext.tenant_display_name : '',
    tenant_team_name: canonicalTenantContext ? canonicalTenantContext.tenant_team_name : '',
    tenant_team_slug: canonicalTenantContext ? canonicalTenantContext.tenant_team_slug : '',
    cicd_admin_team_name: canonicalTenantContext ? canonicalTenantContext.cicd_admin_team_name : '',
    cicd_admin_team_slug: canonicalTenantContext ? canonicalTenantContext.cicd_admin_team_slug : '',
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
    runner_exists: runnerExists,
    existing_runner_id: existingRunnerId,
    runner_group_resolution: runnerGroupResolution,
    validation_findings: {
      tenant_resolution_status: tenantResolution.tenant_resolution_status,
      governance_relation_status: canonicalTenantContext ? canonicalTenantContext.governance_relation_status : 'unknown',
      requester_cicd_membership_state: canonicalTenantContext ? canonicalTenantContext.requester_cicd_membership_state : 'unknown',
      context_marker: canonicalTenantContext ? canonicalTenantContext.context_marker : '',
      runner_name_derivation: request.runner_name_derivation,
      runner_exists: runnerExists,
      runner_group_resolution: runnerGroupResolution,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  resolveRunnerGroupTarget,
  validateHostedRunnerRequest,
};
