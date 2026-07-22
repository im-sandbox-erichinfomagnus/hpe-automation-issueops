'use strict';

async function resolveTeamRepoApprover(input = {}, options = {}) {
  const getOrganizationMembership =
    options.getOrganizationMembership ||
    (options.api && options.api.getOrganizationMembership);

  const approverLogin = String(input.approverLogin || '').toLowerCase();
  const designatedApproverLogin = String(input.designatedApproverLogin || '').toLowerCase();

  if (!approverLogin) {
    return {
      approver_login: '',
      approver_role: 'other',
      approver_authorization_state: 'unknown',
      approver_membership_state: 'unknown',
    };
  }

  if (approverLogin !== designatedApproverLogin) {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unauthorized',
      approver_membership_state: 'unknown',
    };
  }

  if (typeof getOrganizationMembership !== 'function') {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unknown',
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
      approver_authorization_state: 'unauthorized',
      approver_membership_state: 'absent',
    };
  }

  const membershipRole = membership.membership && membership.membership.role
    ? membership.membership.role
    : 'other';
  const membershipState = membership.membership && membership.membership.state
    ? membership.membership.state
    : 'active';
  const authorized = membershipRole === 'admin' && membershipState === 'active';

  return {
    approver_login: approverLogin,
    approver_role: authorized ? 'target_org_owner' : 'other',
    approver_authorization_state: authorized ? 'authorized' : 'unauthorized',
    approver_membership_state: membershipState,
  };
}

module.exports = {
  resolveTeamRepoApprover,
};
