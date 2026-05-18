'use strict';

async function resolveTeamCreationApprover(input = {}, options = {}) {
  const getOrganizationMembership =
    options.getOrganizationMembership ||
    (options.api && options.api.getOrganizationMembership);

  const approverLogin = String(input.approverLogin || '').toLowerCase();
  const intendedOwnerLogin = String(input.intendedOwnerLogin || '').toLowerCase();

  if (!approverLogin) {
    return {
      approver_login: '',
      approver_role: 'other',
      approver_membership_state: 'unknown',
    };
  }

  if (approverLogin !== intendedOwnerLogin) {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_membership_state: 'unknown',
    };
  }

  if (typeof getOrganizationMembership !== 'function') {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_membership_state: 'unknown',
    };
  }

  const membership = await getOrganizationMembership({
    organization: input.organization,
    username: approverLogin,
  });

  if (!membership || membership.exists === false) {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_membership_state: 'absent',
    };
  }

  const membershipState = membership.membership && membership.membership.state
    ? membership.membership.state
    : 'active';

  return {
    approver_login: approverLogin,
    approver_role: membershipState === 'active' ? 'intended_owner' : 'other',
    approver_membership_state: membershipState,
  };
}

module.exports = {
  resolveTeamCreationApprover,
};