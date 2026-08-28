'use strict';

const { parseTenantCreationRequest } = require('./parse-tenant-creation-request');

function isValidEmail(value) {
  if (!value) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function validateCanonicalTopology(topology = {}, tenantKey = '') {
  const findings = [];

  const expectedRootSlug = `${tenantKey}-root`;
  const expectedAdminSlug = `${tenantKey}-admin`;
  const expectedRepoAdminSlug = `${tenantKey}-repo-admin`;
  const expectedCicdAdminSlug = `${tenantKey}-cicd-admin`;

  const structure = topology.teams && Array.isArray(topology.teams.structure)
    ? topology.teams.structure
    : [];

  const rootNode = structure.find((entry) => entry && entry.type === 'root');
  const adminNode = structure.find((entry) => entry && entry.type === 'admin');
  const repoAdminNode = structure.find((entry) => entry && entry.type === 'repo-admin');
  const cicdAdminNode = structure.find((entry) => entry && entry.type === 'cicd-admin');

  if (!rootNode || rootNode.team !== expectedRootSlug || rootNode.parent != null) {
    findings.push('Canonical topology root node is invalid.');
  }

  if (!adminNode || adminNode.team !== expectedAdminSlug || adminNode.parent !== expectedRootSlug) {
    findings.push('Canonical topology admin node is invalid.');
  }

  if (!repoAdminNode || repoAdminNode.team !== expectedRepoAdminSlug || repoAdminNode.parent !== expectedRootSlug) {
    findings.push('Canonical topology repo-admin node is invalid.');
  }

  if (!cicdAdminNode || cicdAdminNode.team !== expectedCicdAdminSlug || cicdAdminNode.parent !== expectedRootSlug) {
    findings.push('Canonical topology cicd-admin node is invalid.');
  }

  return findings;
}

function isSafeTenantKey(value) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(String(value || ''));
}

function isUnsafeOrgWidePrivilegeExpansion(capabilityIntent = {}) {
  if (!capabilityIntent || typeof capabilityIntent !== 'object') {
    return false;
  }

  const requestedScope = String(capabilityIntent.requested_scope || capabilityIntent.requestedScope || '').toLowerCase();
  const requiresBroadOrgScope = Boolean(
    capabilityIntent.requires_broad_org_scope ||
    capabilityIntent.requiresBroadOrgScope ||
    requestedScope === 'organization'
  );
  const requiresOrgOwnerGrant = Boolean(
    capabilityIntent.requires_org_owner_grant ||
    capabilityIntent.requiresOrgOwnerGrant
  );

  return requiresBroadOrgScope || requiresOrgOwnerGrant;
}

function evaluateCicdCapabilityPrerequisites(capabilityIntent = {}) {
  const intent = capabilityIntent && typeof capabilityIntent === 'object' ? capabilityIntent : {};
  const requested = intent.requested !== false;
  const primaryAvailable = Boolean(intent.primary_path_available || intent.primaryPathAvailable);
  const primaryApproved = Boolean(intent.primary_policy_approved || intent.primaryPolicyApproved);
  const fallbackAvailable = Boolean(intent.fallback_path_available || intent.fallbackPathAvailable);
  const fallbackApproved = Boolean(intent.fallback_policy_approved || intent.fallbackPolicyApproved);
  const tenantScopeResolvable = Boolean(intent.tenant_scope_resolvable || intent.tenantScopeResolvable);
  const unsafeScope = isUnsafeOrgWidePrivilegeExpansion(intent);

  if (!requested) {
    return {
      selected_path: 'none',
      status: 'skipped',
      reason_code: 'not_requested',
    };
  }

  if (unsafeScope) {
    return {
      selected_path: 'none',
      status: 'blocked',
      reason_code: 'unsafe_scope',
    };
  }

  if (primaryAvailable && primaryApproved && tenantScopeResolvable) {
    return {
      selected_path: 'primary',
      status: 'applied',
      reason_code: null,
    };
  }

  if (fallbackAvailable && fallbackApproved && tenantScopeResolvable) {
    return {
      selected_path: 'fallback',
      status: 'applied',
      reason_code: null,
    };
  }

  return {
    selected_path: 'none',
    status: 'unavailable',
    reason_code: 'capability_unavailable',
  };
}

async function validateTenantCreationRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTenantCreationRequest(input);
  const errors = [];
  const warnings = [];

  if (Array.isArray(request.csv_input_errors)) {
    errors.push(...request.csv_input_errors);
  }

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.tenant_display_name) {
    errors.push('Tenant name is required.');
  }

  if (!request.tenant_key) {
    errors.push('Tenant key could not be derived from tenant name.');
  }

  if (request.tenant_key && !isSafeTenantKey(request.tenant_key)) {
    errors.push('Derived tenant key is unsafe for tenant-registry path usage.');
  }

  if (!request.tenant_admin_login) {
    errors.push('A tenant admin GitHub login is required.');
  }

  const allowedTenantTypes = ['application', 'platform', 'shared-services'];
  if (!allowedTenantTypes.includes(String(request.tenant_type || '').toLowerCase())) {
    errors.push('tenant_type must be one of application, platform, shared-services.');
  }

  const environment = request.external_mappings && request.external_mappings.environment;
  if (!['prod', 'nonprod'].includes(String(environment || '').toLowerCase())) {
    errors.push('environment must be one of prod, nonprod.');
  }

  const governance = request.governance || {};
  const governanceValues = [
    governance.code_scanning && governance.code_scanning.enabled,
    governance.secret_scanning && governance.secret_scanning.enabled,
    governance.dependabot && governance.dependabot.enabled,
  ];
  if (governanceValues.some((entry) => typeof entry !== 'boolean')) {
    errors.push('governance enabled values must parse to booleans.');
  }

  const governanceMandatorySatisfied = Boolean(
    governance.code_scanning && governance.code_scanning.mandatory === true &&
    governance.secret_scanning && governance.secret_scanning.mandatory === true
  );
  if (!governanceMandatorySatisfied) {
    errors.push('code_scanning.mandatory and secret_scanning.mandatory must remain true.');
  }

  const accessModel = request.topology && request.topology.accessModel || {};
  const expectedRoles = ['tenant-admin', 'repo-admin', 'developer', 'viewer'];
  const roles = Array.isArray(accessModel.roles) ? accessModel.roles : [];
  const organizationRoleSpecifications = Array.isArray(accessModel.organizationRoleSpecifications)
    ? accessModel.organizationRoleSpecifications
    : [];
  const accessModelValid = accessModel.enforcement === 'tenant-boundary' &&
    roles.length === expectedRoles.length &&
    expectedRoles.every((role, index) => roles[index] === role);
  if (!accessModelValid) {
    errors.push('topology.accessModel must enforce tenant-boundary with canonical role ordering.');
  }

  const organizationRoleSpecsValid = expectedRoles.every((roleKey) =>
    organizationRoleSpecifications.some((entry) =>
      entry &&
      entry.role_key === roleKey &&
      typeof entry.role_name === 'string' &&
      String(entry.role_name).trim() !== '' &&
      typeof entry.permission_intent === 'string' &&
      String(entry.permission_intent).trim() !== ''
    )
  );
  if (!organizationRoleSpecsValid) {
    errors.push('topology.accessModel.organizationRoleSpecifications must define canonical role-name and permission-intent mappings.');
  }

  if (request.primary_contact && !isValidEmail(request.primary_contact)) {
    errors.push('primary_contact must match email format when provided.');
  }

  if (request.secondary_contact && !isValidEmail(request.secondary_contact)) {
    errors.push('secondary_contact is optional and must match email format when provided.');
  }

  if (!request.tenant_team_slug || !request.repo_admin_team_slug) {
    errors.push('Derived tenant team slugs are required.');
  }

  const derivedSlugCandidates = [
    request.tenant_team_slug,
    request.admin_team_slug,
    request.repo_admin_team_slug,
    request.cicd_admin_team_slug,
  ]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  if (new Set(derivedSlugCandidates).size !== derivedSlugCandidates.length) {
    errors.push('Derived tenant team slugs conflict and must be unique.');
  }

  const topologyErrors = validateCanonicalTopology(request.topology || {}, request.tenant_key || '');
  errors.push(...topologyErrors);

  const cicdCapabilityIntent = request.cicd_capability_intent && typeof request.cicd_capability_intent === 'object'
    ? request.cicd_capability_intent
    : {
        requested: true,
        primary_path_available: true,
        primary_policy_approved: true,
        fallback_path_available: true,
        fallback_policy_approved: true,
        tenant_scope_resolvable: true,
        requested_scope: 'tenant',
        requires_broad_org_scope: false,
        requires_org_owner_grant: false,
      };
  const cicdCapabilityPreview = evaluateCicdCapabilityPrerequisites(cicdCapabilityIntent);
  const unsafeCicdPrivilegeExpansion = isUnsafeOrgWidePrivilegeExpansion(cicdCapabilityIntent);
  if (unsafeCicdPrivilegeExpansion) {
    errors.push('CI/CD capability request implies broad org-wide privilege expansion and is blocked by policy.');
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const orgResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(orgResult && orgResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  // Tenant creation is self-serve: the requester org-owner gate below is the authorization.
  const designatedApproverAuthorization = {
    state: 'not_applicable',
    role: 'not_applicable',
  };

  let requesterEligibility = {
    state: 'unknown',
    exists: false,
    role: 'other',
  };

  if (request.organization && request.requester_login && typeof options.getOrganizationMembership === 'function') {
    const requesterMembership = await options.getOrganizationMembership({
      organization: request.organization,
      username: request.requester_login,
    });

    requesterEligibility = {
      exists: Boolean(requesterMembership && requesterMembership.exists),
      state: requesterMembership && requesterMembership.membership
        ? requesterMembership.membership.state || 'active'
        : 'absent',
      role: requesterMembership && requesterMembership.membership
        ? requesterMembership.membership.role || 'member'
        : 'other',
    };

    if (!requesterEligibility.exists || requesterEligibility.state !== 'active' || requesterEligibility.role !== 'admin') {
      errors.push('Requester must be an active owner in the target organization to create a tenant.');
    }
  }

  let tenantAdminEligibility = {
    state: 'unknown',
    exists: false,
    role: 'other',
  };

  if (request.organization && request.tenant_admin_login && typeof options.getOrganizationMembership === 'function') {
    const tenantAdminMembership = await options.getOrganizationMembership({
      organization: request.organization,
      username: request.tenant_admin_login,
    });

    tenantAdminEligibility = {
      exists: Boolean(tenantAdminMembership && tenantAdminMembership.exists),
      state: tenantAdminMembership && tenantAdminMembership.membership
        ? tenantAdminMembership.membership.state || 'active'
        : 'absent',
      role: tenantAdminMembership && tenantAdminMembership.membership
        ? tenantAdminMembership.membership.role || 'member'
        : 'other',
    };

    if (!tenantAdminEligibility.exists || tenantAdminEligibility.state !== 'active') {
      errors.push(`Tenant admin '${request.tenant_admin_login}' must be an active member of the target organization.`);
    }
  }

  let existingTeams = [];
  if (request.organization && typeof options.listTeams === 'function') {
    existingTeams = await options.listTeams({ organization: request.organization });
  }

  const existingBySlug = new Map(
    (existingTeams || [])
      .filter((team) => team && team.slug)
      .map((team) => [String(team.slug).toLowerCase(), team])
  );

  const requestedTeams = request.requested_teams.map((team) => {
    const exists = existingBySlug.has(String(team.normalized_slug || '').toLowerCase());
    return {
      ...team,
      validation_status: exists ? 'existing' : 'valid',
      desired_action: exists ? 'noop' : 'create_team',
      current_team_id: exists ? existingBySlug.get(String(team.normalized_slug || '').toLowerCase()).id || null : null,
    };
  });

  const tenantParentSlug = String(request.tenant_team_slug || request.parent_team_slug || '').toLowerCase();
  const existingParent = existingBySlug.get(tenantParentSlug) || null;

  let requestedChildLinks = (request.requested_child_links || []).map((link) => ({
    ...link,
    desired_action: 'link_child',
    validation_status: 'valid',
    failure_reason: null,
  }));

  requestedChildLinks = requestedChildLinks.map((link) => {
    const childSlug = String(link.child_team_slug || '').toLowerCase();
    const existingChild = existingBySlug.get(childSlug) || null;

    if (!existingParent || !existingChild) {
      return {
        ...link,
        desired_action: 'pending_teams',
        validation_status: 'pending_teams',
      };
    }

    if (existingChild.parent && existingChild.parent.slug) {
      const existingChildParentSlug = String(existingChild.parent.slug).toLowerCase();
      if (existingChildParentSlug !== tenantParentSlug) {
        errors.push(`Derived team ${childSlug} is already linked under a different parent and re-parenting is blocked in this version.`);
        return {
          ...link,
          desired_action: 'reject',
          validation_status: 'reparent_blocked',
          failure_reason: 'reparent_blocked',
          current_parent_slug: existingChildParentSlug,
        };
      }

      return {
        ...link,
        desired_action: 'noop',
        validation_status: 'already_linked',
      };
    }

    return link;
  });

  if (request.dry_run) {
    warnings.push('Dry-run is enabled; validation emits reconciliation intent and no mutation is attempted.');
  }

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    designated_approver_authorization: designatedApproverAuthorization,
    requester_eligibility: requesterEligibility,
    tenant_admin_eligibility: tenantAdminEligibility,
    requested_teams: requestedTeams,
    existing_teams: existingTeams,
    requested_child_links: requestedChildLinks,
    parent_team_exists: Boolean(existingBySlug.get(String(request.parent_team_slug || '').toLowerCase())),
    validation_findings: {
      tenant_key_safety: request.tenant_key && isSafeTenantKey(request.tenant_key) ? 'safe' : 'unsafe_or_missing',
      tenant_type_validation: allowedTenantTypes.includes(String(request.tenant_type || '').toLowerCase()) ? 'valid' : 'invalid',
      environment_validation: ['prod', 'nonprod'].includes(String(environment || '').toLowerCase()) ? 'valid' : 'invalid',
      governance_boolean_validation: governanceValues.every((entry) => typeof entry === 'boolean') ? 'valid' : 'invalid',
      governance_mandatory_validation: governanceMandatorySatisfied ? 'valid' : 'invalid',
      access_model_validation: accessModelValid ? 'valid' : 'invalid',
      organization_role_spec_validation: organizationRoleSpecsValid ? 'valid' : 'invalid',
      primary_contact_validation: request.primary_contact
        ? (isValidEmail(request.primary_contact) ? 'valid' : 'invalid')
        : 'absent',
      secondary_contact_validation: request.secondary_contact
        ? (isValidEmail(request.secondary_contact) ? 'valid' : 'invalid')
        : 'absent',
      topology_draft_validation: topologyErrors.length === 0 ? 'valid' : 'invalid',
      compatibility_mode: request.compatibility && request.compatibility.mode ? request.compatibility.mode : 'canonical',
      hierarchy_precondition: requestedChildLinks.some((entry) => entry.validation_status === 'reparent_blocked')
        ? 'reparent_blocked'
        : 'satisfied_or_pending',
      cicd_policy_scope_validation: unsafeCicdPrivilegeExpansion ? 'unsafe_scope' : 'safe_or_not_requested',
      cicd_capability_selected_path: cicdCapabilityPreview.selected_path,
      cicd_capability_status: cicdCapabilityPreview.status,
      cicd_capability_reason_code: cicdCapabilityPreview.reason_code,
      dry_run_no_mutation: Boolean(request.dry_run),
      intake_mode: request.intake_mode,
      csv_row_count: request.csv_row_count || 0,
      requester_owner_gate: requesterEligibility.state === 'active' && requesterEligibility.role === 'admin'
        ? 'authorized'
        : 'unauthorized',
      tenant_admin_membership: tenantAdminEligibility.state === 'active'
        ? 'active'
        : 'inactive_or_unknown',
    },
    request: {
      ...request,
      cicd_capability_intent: cicdCapabilityIntent,
      cicd_capability_status: cicdCapabilityPreview.status,
      cicd_capability_reason_code: cicdCapabilityPreview.reason_code,
      requested_teams: requestedTeams,
      requested_child_links: requestedChildLinks,
      request_status: requestStatus,
    },
  };
}

module.exports = {
  isUnsafeOrgWidePrivilegeExpansion,
  validateTenantCreationRequest,
};
