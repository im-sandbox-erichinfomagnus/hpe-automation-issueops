'use strict';

const { parseTenantCreationRequest } = require('./parse-tenant-creation-request');

function isSafeTenantKey(value) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(String(value || ''));
}

async function validateTenantCreationRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTenantCreationRequest(input);
  const errors = [];
  const warnings = [];

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

  if (!request.designated_approver_login) {
    errors.push('A designated approver is required.');
  }

  if (!request.tenant_team_slug || !request.repo_admin_team_slug) {
    errors.push('Derived tenant team slugs are required.');
  }

  if (request.tenant_team_slug && request.repo_admin_team_slug && request.tenant_team_slug === request.repo_admin_team_slug) {
    errors.push('Derived tenant team slugs conflict and must be unique.');
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const orgResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(orgResult && orgResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  let designatedApproverAuthorization = {
    state: 'unknown',
    role: 'other',
  };

  if (request.organization && request.designated_approver_login && typeof options.getOrganizationMembership === 'function') {
    const membership = await options.getOrganizationMembership({
      organization: request.organization,
      username: request.designated_approver_login,
    });

    if (membership && membership.exists && membership.membership) {
      const role = membership.membership.role || 'member';
      const state = membership.membership.state || 'active';
      designatedApproverAuthorization = {
        state: state === 'active' && role === 'admin' ? 'authorized' : 'unauthorized',
        role,
      };
    } else {
      designatedApproverAuthorization = {
        state: 'unauthorized',
        role: 'other',
      };
    }

    if (designatedApproverAuthorization.state !== 'authorized') {
      errors.push('Designated approver must be an active target organization owner.');
    }
  }

  let requesterEligibility = {
    state: 'unknown',
    exists: false,
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
    };

    if (!requesterEligibility.exists || requesterEligibility.state !== 'active') {
      errors.push('Requester is not an active member of the target organization.');
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
  const repoAdminSlug = String(request.repo_admin_team_slug || '').toLowerCase();
  const existingParent = existingBySlug.get(tenantParentSlug) || null;
  const existingChild = existingBySlug.get(repoAdminSlug) || null;

  let requestedChildLinks = (request.requested_child_links || []).map((link) => ({
    ...link,
    desired_action: 'link_child',
    validation_status: 'valid',
    failure_reason: null,
  }));

  if (existingChild && existingChild.parent && existingChild.parent.slug) {
    const existingChildParentSlug = String(existingChild.parent.slug).toLowerCase();
    if (existingChildParentSlug !== tenantParentSlug) {
      errors.push('Derived repo-admin team is already linked under a different parent and re-parenting is blocked in this version.');
      requestedChildLinks = requestedChildLinks.map((link) => ({
        ...link,
        desired_action: 'reject',
        validation_status: 'reparent_blocked',
        failure_reason: 'reparent_blocked',
        current_parent_slug: existingChildParentSlug,
      }));
    } else {
      requestedChildLinks = requestedChildLinks.map((link) => ({
        ...link,
        desired_action: 'noop',
        validation_status: 'already_linked',
      }));
    }
  } else if (!existingParent || !existingChild) {
    requestedChildLinks = requestedChildLinks.map((link) => ({
      ...link,
      desired_action: 'pending_teams',
      validation_status: 'pending_teams',
    }));
  }

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
    requested_teams: requestedTeams,
    existing_teams: existingTeams,
    requested_child_links: requestedChildLinks,
    parent_team_exists: Boolean(existingBySlug.get(String(request.parent_team_slug || '').toLowerCase())),
    validation_findings: {
      tenant_key_safety: request.tenant_key && isSafeTenantKey(request.tenant_key) ? 'safe' : 'unsafe_or_missing',
      hierarchy_precondition: requestedChildLinks.some((entry) => entry.validation_status === 'reparent_blocked')
        ? 'reparent_blocked'
        : 'satisfied_or_pending',
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    request: {
      ...request,
      requested_teams: requestedTeams,
      requested_child_links: requestedChildLinks,
      request_status: requestStatus,
    },
  };
}

module.exports = {
  validateTenantCreationRequest,
};
