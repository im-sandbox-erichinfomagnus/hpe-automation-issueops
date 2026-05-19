'use strict';

async function resolveTeamHierarchyApprover(input = {}, options = {}) {
  const getTeamMembership =
    options.getTeamMembership ||
    (options.api && options.api.getMembershipForUser);

  const approverLogin = String(input.approverLogin || '').toLowerCase();
  const designatedApproverLogin = String(input.designatedApproverLogin || '').toLowerCase();
  const parentTeamSlug = String(input.parentTeamSlug || '').toLowerCase();
  const requestedChildLinks = Array.isArray(input.requestedChildLinks) ? input.requestedChildLinks : [];

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

  if (typeof getTeamMembership !== 'function') {
    return {
      approver_login: approverLogin,
      approver_role: 'other',
      approver_authorization_state: 'unknown',
    };
  }

  const teamSlugs = [parentTeamSlug, ...requestedChildLinks.map((entry) => String(entry.child_team_slug || '').toLowerCase())]
    .filter(Boolean);

  for (const teamSlug of teamSlugs) {
    const membership = await getTeamMembership({
      organization: input.organization,
      teamSlug,
      username: approverLogin,
    });

    const role = membership && membership.membership ? membership.membership.role || 'member' : 'absent';
    const state = membership && membership.membership ? membership.membership.state || 'active' : 'absent';
    if (role !== 'maintainer' || state !== 'active') {
      return {
        approver_login: approverLogin,
        approver_role: 'other',
        approver_authorization_state: 'unauthorized',
      };
    }
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