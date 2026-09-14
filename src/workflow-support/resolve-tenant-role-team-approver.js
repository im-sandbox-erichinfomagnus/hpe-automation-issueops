'use strict';

const { probeTeamMembership, normalizeMembershipState } = require('./probe-team-membership');

function normalizeLogin(value) {
  return String(value || '').toLowerCase().trim();
}

// Approver model for the two tenant membership operations that route when the requester
// holds no tenant role (add-repo-admin, add-cicd-admin). The validator records which team
// slugs carry the authority for that request; this resolves the commenter against them, in
// the order the approval matrix names the alternates:
//
//   1. an active member of the tenant role team (repo-admin / cicd-admin) approves;
//   2. an active MAINTAINER of the tenant top team approves — plain membership of the top
//      team is not authority, which mirrors the requester gate in both validators;
//   3. an organization owner approves, as the matrix alternate of last resort.
//
// The requester is excluded from every path, and the owner fallback above all: an owner who
// files a request must not be able to walk down to their own comment and approve it. That
// is the create-tenant self-nomination hole, and it is closed here before it can open.
async function resolveTenantRoleTeamApprover(input = {}, options = {}) {
  const getMembershipForUser =
    options.getMembershipForUser ||
    options.api && options.api.getMembershipForUser;
  const getOrganizationMembership =
    options.getOrganizationMembership ||
    options.api && options.api.getOrganizationMembership;

  const approverLogin = normalizeLogin(input.approverLogin);
  const requesterLogin = normalizeLogin(input.requesterLogin);
  const eligibleTeamSlugs = (Array.isArray(input.eligibleApproverTeamSlugs)
    ? input.eligibleApproverTeamSlugs
    : []
  ).map(normalizeLogin).filter(Boolean);

  const base = {
    approver_login: approverLogin,
    approver_role: 'other',
    approver_authorization_state: 'unknown',
    approver_membership_state: 'unknown',
    approver_team_slug: null,
    eligible_approver_team_slugs: eligibleTeamSlugs,
    requester_self_approval_blocked: false,
  };

  if (!approverLogin) {
    return base;
  }

  // Self-approval is refused before any lookup, so no authority the requester happens to
  // hold — organization ownership included — can be walked back into their own request.
  if (requesterLogin && approverLogin === requesterLogin) {
    return {
      ...base,
      approver_authorization_state: 'unauthorized',
      requester_self_approval_blocked: true,
    };
  }

  // The role team comes first: it is the authority the operation is actually about.
  // The top team is probed separately because it demands maintainership, not membership.
  const roleTeamSlugs = eligibleTeamSlugs.slice(0, 1);
  const topTeamSlugs = eligibleTeamSlugs.slice(1);

  if (typeof getMembershipForUser === 'function' && roleTeamSlugs.length > 0) {
    const roleTeamProbe = await probeTeamMembership({
      organization: input.organization,
      username: approverLogin,
      getMembershipForUser,
      teamSlugs: roleTeamSlugs,
    });

    if (roleTeamProbe.authorized) {
      return {
        ...base,
        approver_role: 'tenant_role_team',
        approver_authorization_state: 'authorized',
        approver_membership_state: roleTeamProbe.membership_state,
        approver_team_slug: roleTeamProbe.team_slug,
      };
    }
  }

  let topTeamMembershipState = 'unknown';
  if (typeof getMembershipForUser === 'function' && topTeamSlugs.length > 0) {
    for (const teamSlug of topTeamSlugs) {
      const membership = await getMembershipForUser({
        organization: input.organization,
        teamSlug,
        username: approverLogin,
      });
      topTeamMembershipState = normalizeMembershipState(membership);

      if (topTeamMembershipState === 'active_maintainer') {
        return {
          ...base,
          approver_role: 'tenant_admin_maintainer',
          approver_authorization_state: 'authorized',
          approver_membership_state: topTeamMembershipState,
          approver_team_slug: teamSlug,
        };
      }
    }
  }

  if (typeof getOrganizationMembership !== 'function') {
    return {
      ...base,
      approver_authorization_state: 'unauthorized',
      approver_membership_state: topTeamMembershipState,
    };
  }

  const organizationMembership = await getOrganizationMembership({
    organization: input.organization,
    username: approverLogin,
  });

  if (!organizationMembership || organizationMembership.exists === false || !organizationMembership.membership) {
    return {
      ...base,
      approver_authorization_state: 'unauthorized',
      approver_membership_state: 'absent',
    };
  }

  const organizationState = organizationMembership.membership.state || 'active';
  const organizationRole = organizationMembership.membership.role || 'member';

  if (organizationState === 'active' && organizationRole === 'admin') {
    return {
      ...base,
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
      approver_membership_state: organizationState,
    };
  }

  return {
    ...base,
    approver_authorization_state: 'unauthorized',
    approver_membership_state: organizationState,
  };
}

module.exports = {
  resolveTenantRoleTeamApprover,
};
