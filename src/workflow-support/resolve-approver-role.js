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
    };
  }

  return {
    approver_login: input.approverLogin,
    approver_role: membership.membership && membership.membership.role === 'admin'
      ? 'org_owner'
      : 'other',
  };
}

module.exports = {
  resolveApproverRole,
};