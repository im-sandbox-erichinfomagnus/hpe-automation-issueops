'use strict';

async function resolveTeamHierarchyApprover(input = {}, options = {}) {
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
    };
  }

  if (approverLogin !== designatedApproverLogin) {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unauthorized',
    };
  }

  if (typeof getOrganizationMembership !== 'function') {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unknown',
    };
  }

  const membership = await getOrganizationMembership({
    organization: input.organization,
    username: approverLogin,
  });

  const exists = Boolean(membership && membership.exists);
  const state = membership && membership.membership && membership.membership.state
    ? String(membership.membership.state || '').toLowerCase()
    : 'absent';

  if (!exists || state !== 'active') {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unauthorized',
    };
  }

  return {
    approver_login: approverLogin,
    approver_role: 'designated_hierarchy_approver',
    approver_authorization_state: 'authorized',
  };
}

module.exports = {
  resolveTeamHierarchyApprover,
};