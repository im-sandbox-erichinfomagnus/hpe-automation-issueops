'use strict';

async function resolveApproverRole(input = {}, options = {}) {
  const getOrganizationMembership =
    options.getOrganizationMembership ||
    (options.api && options.api.getOrganizationMembership);

  if (!input.approverLogin) {
    return {
      approver_login: '',
      approver_role: 'other',
    };
  }

  if (typeof getOrganizationMembership !== 'function') {
    return {
      approver_login: input.approverLogin,
      approver_role: 'other',
    };
  }

  const membership = await getOrganizationMembership({
    organization: input.organization,
    username: input.approverLogin,
  });

  if (!membership || membership.exists === false) {
    return {
      approver_login: input.approverLogin,
      approver_role: 'other',
      approver_membership_state: 'absent',
    };
  }

  const membershipState = membership.membership && membership.membership.state
    ? String(membership.membership.state || '').toLowerCase()
    : 'active';
  const membershipRole = membership.membership && membership.membership.role
    ? String(membership.membership.role || '').toLowerCase()
    : 'member';

  if (membershipState !== 'active') {
    return {
      approver_login: input.approverLogin,
      approver_role: 'other',
      approver_membership_state: membershipState,
    };
  }

  return {
    approver_login: input.approverLogin,
    approver_role: membershipRole === 'admin' ? 'org_owner' : 'org_member',
    approver_membership_state: membershipState,
  };
}

module.exports = {
  resolveApproverRole,
};