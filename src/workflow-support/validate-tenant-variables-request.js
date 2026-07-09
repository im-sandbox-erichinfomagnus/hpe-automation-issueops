'use strict';

const crypto = require('crypto');

const {
  ALLOWED_VARIABLE_OPERATIONS,
  VARIABLE_NAME_PATTERN,
  applyTenantVariablePrefix,
  deriveTenantVariablePrefix,
  normalizeVariableName,
  parseTenantVariablesRequest,
} = require('./parse-tenant-variables-request');
const { readTenantRegistryRecords } = require('./resolve-tenant-context-from-registry');
const { readTopologyView } = require('./resolve-tenant-cicd-context-from-registry');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildVariableContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: 'tenant_variable_management',
    organization: normalizeLogin(input.organization),
    variable_operation: String(input.variable_operation || ''),
    tenant_key: normalizeLogin(input.tenant_key),
    tenant_team_slug: normalizeLogin(input.tenant_team_slug),
    designated_approver_login: normalizeLogin(input.designated_approver_login),
    effective_names: [...(input.effective_names || [])].sort(),
    registry_ref: String(input.registry_ref || 'main'),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `tenant-variable-context:${digest}`;
}

async function validateTenantVariablesRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTenantVariablesRequest(input);
  const errors = [];
  const warnings = [];

  const registryRef = String(options.registryRef || process.env.TENANT_REGISTRY_REF || 'main');
  const organization = normalizeLogin(request.organization);
  const requesterLogin = normalizeLogin(request.requester_login);
  const tenantNameNormalized = normalizeTenantName(request.tenant_name_normalized || request.tenant_name_input);
  const variableOperation = String(request.variable_operation || '').toLowerCase();
  const entries = Array.isArray(request.variable_entries) ? request.variable_entries : [];

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.tenant_name_input) {
    errors.push('Tenant name is required.');
  }

  if (!ALLOWED_VARIABLE_OPERATIONS.includes(variableOperation)) {
    errors.push(`Variable operation '${request.variable_operation || ''}' is invalid. Allowed values are: ${ALLOWED_VARIABLE_OPERATIONS.join(', ')}.`);
  }

  if (entries.length === 0) {
    errors.push('Provide at least one variable via the single variable name or the batch CSV.');
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

  const registryResult = readTenantRegistryRecords({ registryDirectory: options.registryDirectory });
  if (registryResult.missing_directory) {
    errors.push('Tenant registry directory is missing in the workflow workspace.');
  }
  if (registryResult.malformed_files && registryResult.malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }

  const orgViews = registryResult.records
    .map((record) => readTopologyView(record))
    .filter((view) => view.organization && view.organization === organization);
  const nameMatches = tenantNameNormalized
    ? orgViews.filter((view) => normalizeTenantName(view.tenant_display_name) === tenantNameNormalized)
    : orgViews;

  let tenantResolutionStatus = 'no_match';
  if (registryResult.malformed_files.length > 0 && orgViews.length === 0) {
    tenantResolutionStatus = 'registry_conflict';
  } else if (nameMatches.length === 1) {
    tenantResolutionStatus = 'resolved';
  } else if (nameMatches.length > 1) {
    tenantResolutionStatus = 'ambiguous';
  }

  const resolvedView = tenantResolutionStatus === 'resolved' ? nameMatches[0] : null;
  const availableTenantDisplayNames = [...new Set(orgViews
    .map((view) => String(view.tenant_display_name || '').split(/[\r\n]+/)[0].trim())
    .filter(Boolean))];

  if (!resolvedView) {
    if (tenantResolutionStatus === 'ambiguous') {
      errors.push(`Tenant name '${request.tenant_name_input}' matched multiple tenant records in organization '${request.organization}' and is ambiguous.`);
    } else if (tenantResolutionStatus === 'registry_conflict') {
      errors.push('Tenant registry data is malformed or conflicting for the target organization.');
    } else if (request.tenant_name_input) {
      errors.push(`No tenant record was found for tenant name '${request.tenant_name_input}' in organization '${request.organization}'.`);
      if (availableTenantDisplayNames.length > 0) {
        warnings.push(`Available tenant names in this organization: ${availableTenantDisplayNames.join(', ')}`);
      }
    } else {
      errors.push('Tenant context could not be resolved from the registry.');
    }
  }

  const tenantKey = resolvedView ? resolvedView.tenant_key : '';
  const tenantDisplayName = resolvedView ? resolvedView.tenant_display_name : '';
  const tenantTeamSlug = resolvedView ? resolvedView.tenant_root_team_slug : '';
  const cicdAdminTeamSlug = resolvedView ? resolvedView.admin_team_slug : '';
  const prefix = deriveTenantVariablePrefix(tenantKey);

  // Authorization gate: the requester must be an active MAINTAINER of the tenant
  // top (root) team. This is stricter than the runner operations, which allow an
  // active member or maintainer of the tenant -admin team.
  let requesterMembershipState = 'unknown';
  if (resolvedView && !tenantTeamSlug) {
    errors.push(`Tenant '${tenantDisplayName}' has no resolvable top team and cannot authorize variable management.`);
  } else if (resolvedView && typeof options.getMembershipForUser === 'function') {
    const membership = await options.getMembershipForUser({
      organization,
      teamSlug: tenantTeamSlug,
      username: requesterLogin,
    });
    const state = membership && membership.state ? String(membership.state).toLowerCase() : 'absent';
    const role = membership && membership.membership && membership.membership.role
      ? String(membership.membership.role).toLowerCase()
      : '';

    requesterMembershipState = state === 'active' && role === 'maintainer'
      ? 'active_maintainer'
      : state === 'active'
        ? 'active_member'
        : state === 'absent'
          ? 'absent'
          : 'unknown';

    if (requesterMembershipState !== 'active_maintainer') {
      errors.push(`Requester '${request.requester_login}' is not an active maintainer of the tenant top team '${tenantTeamSlug}' and cannot manage variables for tenant '${tenantDisplayName}'.`);
    }
  }

  // Other tenant prefixes in the same organization define namespaces that this
  // request cannot target, preventing cross-tenant variable collisions.
  const otherTenantPrefixes = orgViews
    .filter((view) => normalizeLogin(view.tenant_key) !== normalizeLogin(tenantKey))
    .map((view) => ({
      tenant_display_name: view.tenant_display_name,
      prefix: deriveTenantVariablePrefix(view.tenant_key),
    }))
    .filter((entry) => entry.prefix);

  const planEntries = [];
  const seenEffectiveNames = new Set();
  for (const entry of entries) {
    const providedName = normalizeVariableName(entry.name);
    if (!providedName) {
      errors.push('A variable name is required and cannot be empty after normalization.');
      continue;
    }

    const crossTenant = otherTenantPrefixes.find(
      (other) => providedName.startsWith(other.prefix) && (!prefix || !providedName.startsWith(prefix))
    );
    if (crossTenant) {
      errors.push(`Variable name '${providedName}' targets the namespace of tenant '${crossTenant.tenant_display_name}' and cannot be managed through tenant '${tenantDisplayName || request.tenant_name_input}'.`);
      continue;
    }

    const effectiveName = applyTenantVariablePrefix(prefix, providedName);
    const baseName = prefix && effectiveName.startsWith(prefix) ? effectiveName.slice(prefix.length) : effectiveName;

    if (!baseName) {
      errors.push(`Variable name '${providedName}' has no base name after removing the tenant prefix.`);
      continue;
    }

    if (!VARIABLE_NAME_PATTERN.test(effectiveName)) {
      errors.push(`Variable name '${effectiveName}' is invalid. Organization Actions variable names must match ${VARIABLE_NAME_PATTERN}.`);
      continue;
    }

    if (effectiveName.startsWith('GITHUB_')) {
      errors.push(`Variable name '${effectiveName}' is invalid. Organization Actions variable names must not start with GITHUB_.`);
      continue;
    }

    const hasValue = entry.value != null && String(entry.value) !== '';
    if ((variableOperation === 'create' || variableOperation === 'update') && !hasValue) {
      errors.push(`Variable '${effectiveName}' requires a value for the ${variableOperation} operation.`);
      continue;
    }
    if (variableOperation === 'delete' && hasValue) {
      errors.push(`Variable '${effectiveName}' must not include a value for the delete operation.`);
      continue;
    }

    if (seenEffectiveNames.has(effectiveName)) {
      warnings.push(`Variable '${effectiveName}' was requested more than once; the first occurrence is used.`);
      continue;
    }
    seenEffectiveNames.add(effectiveName);

    planEntries.push({
      name: effectiveName,
      base_name: baseName,
      value: variableOperation === 'delete' ? null : (hasValue ? String(entry.value) : null),
    });
  }

  // Read current state so the reconciliation intent converges on re-runs.
  const currentByName = new Map();
  if (resolvedView && planEntries.length > 0) {
    if (typeof options.getOrganizationVariable === 'function') {
      for (const entry of planEntries) {
        const currentResult = await options.getOrganizationVariable({ organization, name: entry.name });
        if (currentResult && currentResult.exists && currentResult.variable) {
          currentByName.set(entry.name, currentResult.variable);
        }
      }
    } else if (typeof options.listOrganizationVariables === 'function') {
      const currentVariables = await options.listOrganizationVariables({ organization });
      for (const variable of currentVariables || []) {
        currentByName.set(normalizeVariableName(variable.name), variable);
      }
    }
  }

  for (const entry of planEntries) {
    const current = currentByName.get(entry.name) || null;
    entry.current_exists = Boolean(current);
    entry.current_value = current ? String(current.value ?? '') : null;

    if (variableOperation === 'delete') {
      entry.action = current ? 'delete' : 'noop';
    } else {
      const desiredValue = entry.value == null ? '' : String(entry.value);
      entry.action = !current
        ? 'create'
        : String(current.value ?? '') === desiredValue
          ? 'noop'
          : 'update';
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

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';
  const contextMarker = resolvedView
    ? buildVariableContextMarker({
        organization,
        variable_operation: variableOperation,
        tenant_key: tenantKey,
        tenant_team_slug: tenantTeamSlug,
        designated_approver_login: request.designated_approver_login,
        effective_names: planEntries.map((entry) => entry.name),
        registry_ref: registryRef,
      })
    : '';

  const canonicalTenantContext = resolvedView
    ? {
        tenant_key: tenantKey,
        tenant_display_name: tenantDisplayName,
        organization,
        registry_ref: registryRef,
        tenant_team_name: tenantTeamSlug,
        tenant_team_slug: tenantTeamSlug,
        cicd_admin_team_slug: cicdAdminTeamSlug,
        requester_membership_state: requesterMembershipState,
        tenant_resolution_status: tenantResolutionStatus,
        context_marker: contextMarker,
      }
    : null;

  const enrichedRequest = {
    ...request,
    tenant_key: tenantKey,
    tenant_display_name: tenantDisplayName,
    tenant_team_name: tenantTeamSlug,
    tenant_team_slug: tenantTeamSlug,
    cicd_admin_team_slug: cicdAdminTeamSlug,
    variable_prefix: prefix,
    variable_entries: planEntries,
    context_marker: contextMarker,
    request_status: requestStatus,
  };

  const plan = {
    organization,
    variable_operation: variableOperation,
    variable_prefix: prefix,
    entries: planEntries,
    dry_run: Boolean(request.dry_run),
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
      requester_membership_state: requesterMembershipState,
      variable_operation: variableOperation,
      variable_prefix: prefix,
      variable_plan: planEntries,
      context_marker: contextMarker,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  buildVariableContextMarker,
  validateTenantVariablesRequest,
};
