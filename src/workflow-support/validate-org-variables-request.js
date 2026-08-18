'use strict';

const crypto = require('crypto');

const {
  ALLOWED_ORG_VARIABLE_OPERATIONS,
  ALLOWED_ORG_VARIABLE_VISIBILITIES,
  ORG_VARIABLE_NAME_PATTERN,
  normalizeOrgVariableName,
  parseOrgVariablesRequest,
} = require('./parse-org-variables-request');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function buildOrgVariableContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: 'org_variable_management',
    organization: normalizeLogin(input.organization),
    org_variable_operation: String(input.org_variable_operation || ''),
    effective_entries: [...(input.effective_entries || [])].sort(),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `org-variable-context:${digest}`;
}

async function validateOrgVariablesRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseOrgVariablesRequest(input);
  const errors = [];
  const warnings = [];

  const organization = normalizeLogin(request.organization);
  const requesterLogin = normalizeLogin(request.requester_login);
  const defaultOperation = String(request.org_variable_operation || '').toLowerCase();
  const entries = Array.isArray(request.org_variable_entries) ? request.org_variable_entries : [];

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!ALLOWED_ORG_VARIABLE_OPERATIONS.includes(defaultOperation)) {
    errors.push(`Org variable operation '${request.org_variable_operation || ''}' is invalid. Allowed values are: ${ALLOWED_ORG_VARIABLE_OPERATIONS.join(', ')}.`);
  }

  if (entries.length === 0) {
    errors.push('Provide at least one variable via the single variable name or the batch CSV.');
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const organizationResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  // Authorization gate: org-wide Actions variables may only be managed by an
  // active owner (org admin) of the target organization. This is deliberately
  // stricter than the tenant-scoped variables op and involves no tenant teams.
  let requesterOrgMembershipState = 'unknown';
  let requesterOrgRole = 'other';
  let isOrgOwner = false;
  if (request.organization && requesterLogin && typeof options.getOrganizationMembership === 'function') {
    const requesterMembership = await options.getOrganizationMembership({
      organization: request.organization,
      username: requesterLogin,
    });

    requesterOrgMembershipState = requesterMembership && requesterMembership.membership && requesterMembership.membership.state
      ? String(requesterMembership.membership.state).toLowerCase()
      : 'absent';
    requesterOrgRole = requesterMembership && requesterMembership.membership && requesterMembership.membership.role
      ? String(requesterMembership.membership.role).toLowerCase()
      : 'other';
    isOrgOwner = requesterOrgMembershipState === 'active' && requesterOrgRole === 'admin';

    if (!isOrgOwner) {
      errors.push(`Requester '${request.requester_login}' is not an active owner of the target organization '${request.organization}' and cannot manage organization Actions variables.`);
    }
  }

  const planEntries = [];
  const seenEffectiveNames = new Set();
  for (const entry of entries) {
    const providedName = normalizeOrgVariableName(entry.name);
    if (!providedName) {
      errors.push('A variable name is required and cannot be empty after normalization.');
      continue;
    }

    if (entry.column_count && entry.column_count > 4) {
      errors.push(`Variable row for '${providedName}' has too many columns. Expected name,value[,operation[,visibility]].`);
      continue;
    }

    if (!ORG_VARIABLE_NAME_PATTERN.test(providedName)) {
      errors.push(`Variable name '${providedName}' is invalid. Organization Actions variable names must match ${ORG_VARIABLE_NAME_PATTERN}.`);
      continue;
    }

    if (providedName.startsWith('GITHUB_')) {
      errors.push(`Variable name '${providedName}' is invalid. Organization Actions variable names must not start with GITHUB_.`);
      continue;
    }

    // Per-row operation overrides the form default so a single CSV can mix
    // create/update/delete rows (pending Uma's confirmation of the final set).
    const effectiveOperation = String(entry.operation || '').toLowerCase() || defaultOperation;
    if (!ALLOWED_ORG_VARIABLE_OPERATIONS.includes(effectiveOperation)) {
      errors.push(`Variable '${providedName}' requests operation '${entry.operation}' which is invalid. Allowed values are: ${ALLOWED_ORG_VARIABLE_OPERATIONS.join(', ')}.`);
      continue;
    }

    const requestedVisibility = String(entry.visibility || '').toLowerCase();
    if (requestedVisibility && !ALLOWED_ORG_VARIABLE_VISIBILITIES.includes(requestedVisibility)) {
      errors.push(`Variable '${providedName}' requests visibility '${entry.visibility}' which is not supported. Allowed values are: ${ALLOWED_ORG_VARIABLE_VISIBILITIES.join(', ')}.`);
      continue;
    }
    if (requestedVisibility && effectiveOperation !== 'create') {
      warnings.push(`Variable '${providedName}' specifies visibility '${requestedVisibility}' but visibility only applies when a variable is created; it is ignored for ${effectiveOperation}.`);
    }

    const hasValue = entry.value != null && String(entry.value) !== '';
    if ((effectiveOperation === 'create' || effectiveOperation === 'update') && !hasValue) {
      errors.push(`Variable '${providedName}' requires a value for the ${effectiveOperation} operation.`);
      continue;
    }
    if (effectiveOperation === 'delete' && hasValue) {
      errors.push(`Variable '${providedName}' must not include a value for the delete operation.`);
      continue;
    }

    if (seenEffectiveNames.has(providedName)) {
      warnings.push(`Variable '${providedName}' was requested more than once; the first occurrence is used.`);
      continue;
    }
    seenEffectiveNames.add(providedName);

    planEntries.push({
      name: providedName,
      value: effectiveOperation === 'delete' ? null : (hasValue ? String(entry.value) : null),
      operation: effectiveOperation,
      visibility: effectiveOperation === 'create' ? (requestedVisibility || 'all') : '',
    });
  }

  // Read current state so the reconciliation intent converges on re-runs.
  const currentByName = new Map();
  if (organizationVisible && planEntries.length > 0) {
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
        currentByName.set(normalizeOrgVariableName(variable.name), variable);
      }
    }
  }

  for (const entry of planEntries) {
    const current = currentByName.get(entry.name) || null;
    entry.current_exists = Boolean(current);
    entry.current_value = current ? String(current.value ?? '') : null;

    if (entry.operation === 'delete') {
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

  if (request.dry_run) {
    warnings.push('Dry-run is enabled; reconciliation intent is reported without mutation.');
  }

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';
  const contextMarker = errors.length === 0
    ? buildOrgVariableContextMarker({
        organization,
        org_variable_operation: defaultOperation,
        effective_entries: planEntries.map((entry) => `${entry.operation}:${entry.name}`),
      })
    : '';

  const requesterAuthorization = {
    state: isOrgOwner ? 'authorized' : 'unauthorized',
    role: requesterOrgRole,
    membership_state: requesterOrgMembershipState,
  };

  const enrichedRequest = {
    ...request,
    org_variable_entries: planEntries,
    context_marker: contextMarker,
    request_status: requestStatus,
  };

  const plan = {
    organization,
    org_variable_operation: defaultOperation,
    entries: planEntries,
    dry_run: Boolean(request.dry_run),
  };

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    requester_authorization: requesterAuthorization,
    plan,
    validation_findings: {
      requester_org_membership_state: requesterOrgMembershipState,
      requester_org_role: requesterOrgRole,
      org_variable_operation: defaultOperation,
      org_variable_plan: planEntries,
      context_marker: contextMarker,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  buildOrgVariableContextMarker,
  validateOrgVariablesRequest,
};
