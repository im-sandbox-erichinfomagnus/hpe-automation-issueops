'use strict';

function normalizeLogin(value) {
  return String(value || '').toLowerCase().trim();
}

// Tenant creation approval model:
//   - the person named as tenant admin on the request approves it;
//   - except when the requester named themselves as tenant admin, in which case only
//     an organization owner may approve, so one person cannot stand up tenants alone;
//   - an organization owner may approve in any case.
// The owner check runs first because it is unconditional, and it is answered from live
// organization membership rather than from a login supplied on the request.
async function resolveTenantCreationApprover(input = {}, options = {}) {
  const getOrganizationMembership =
    options.getOrganizationMembership ||
    options.api && options.api.getOrganizationMembership;

  const approverLogin = normalizeLogin(input.approverLogin);
  const tenantAdminLogin = normalizeLogin(input.tenantAdminLogin);
  const requesterLogin = normalizeLogin(input.requesterLogin);
  const selfNominated = Boolean(requesterLogin && requesterLogin === tenantAdminLogin);

  if (!approverLogin) {
    return {
      approver_login: '',
      approver_role: 'other',
      approver_authorization_state: 'unknown',
      approver_membership_state: 'unknown',
      tenant_admin_login: tenantAdminLogin,
      requester_self_nominated_tenant_admin: selfNominated,
    };
  }

  if (typeof getOrganizationMembership !== 'function') {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unknown',
      approver_membership_state: 'unknown',
      tenant_admin_login: tenantAdminLogin,
      requester_self_nominated_tenant_admin: selfNominated,
    };
  }

  const membership = await getOrganizationMembership({
    organization: input.organization,
    username: approverLogin,
  });

  if (!membership || membership.exists === false || !membership.membership) {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unauthorized',
      approver_membership_state: 'absent',
      tenant_admin_login: tenantAdminLogin,
      requester_self_nominated_tenant_admin: selfNominated,
    };
  }

  const membershipState = membership.membership.state || 'active';
  const membershipRole = membership.membership.role || 'member';
  const isActive = membershipState === 'active';

  // An organization owner may approve any tenant creation request, including one where
  // the requester nominated themselves.
  if (isActive && membershipRole === 'admin') {
    return {
      approver_login: approverLogin,
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
      approver_membership_state: membershipState,
      tenant_admin_login: tenantAdminLogin,
      requester_self_nominated_tenant_admin: selfNominated,
    };
  }

  // The named tenant admin approves, unless they are also the requester. Self-nomination
  // leaves the owner branch above as the only way through.
  if (isActive && !selfNominated && tenantAdminLogin && approverLogin === tenantAdminLogin) {
    return {
      approver_login: approverLogin,
      approver_role: 'tenant_admin',
      approver_authorization_state: 'authorized',
      approver_membership_state: membershipState,
      tenant_admin_login: tenantAdminLogin,
      requester_self_nominated_tenant_admin: selfNominated,
    };
  }

  return {
    approver_login: approverLogin,
    approver_role: 'other',
    approver_authorization_state: 'unauthorized',
    approver_membership_state: membershipState,
    tenant_admin_login: tenantAdminLogin,
    requester_self_nominated_tenant_admin: selfNominated,
  };
}

module.exports = {
  resolveTenantCreationApprover,
};
