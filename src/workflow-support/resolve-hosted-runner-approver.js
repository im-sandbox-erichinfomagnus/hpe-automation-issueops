'use strict';

async function resolveHostedRunnerApprover(input = {}, options = {}) {
  const getOrganizationMembership =
    options.getOrganizationMembership ||
    options.api && options.api.getOrganizationMembership;

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

  if (!designatedApproverLogin || approverLogin !== designatedApproverLogin) {
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

  if (!membership || membership.exists === false || !membership.membership) {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unauthorized',
      approver_membership_state: 'absent',
    };
  }

  const membershipState = membership.membership.state || 'active';
  const membershipRole = membership.membership.role || 'member';
  const authorized = membershipState === 'active' && membershipRole === 'admin';

  return {
    approver_login: approverLogin,
    approver_role: authorized ? 'target_org_owner' : 'other',
    approver_authorization_state: authorized ? 'authorized' : 'unauthorized',
    approver_membership_state: membershipState,
  };
}

module.exports = {
  resolveHostedRunnerApprover,
};
