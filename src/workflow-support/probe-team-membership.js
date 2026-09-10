'use strict';

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

// Candidates may be plain slug strings or { slug, matched_on } entries so a caller
// can label each team with the role it represents in that caller's model.
function orderedTeamCandidates(input = {}) {
  const seen = new Set();
  const entries = Array.isArray(input.teamSlugs) ? input.teamSlugs : [];

  return entries
    .map((entry) => (entry && typeof entry === 'object'
      ? { slug: normalizeLogin(entry.slug), matched_on: entry.matched_on }
      : { slug: normalizeLogin(entry), matched_on: normalizeLogin(entry) || null }))
    .filter((candidate) => {
      if (!candidate.slug || seen.has(candidate.slug)) {
        return false;
      }
      seen.add(candidate.slug);
      return typeof input.teamExists === 'function' ? Boolean(input.teamExists(candidate.slug)) : true;
    });
}

function normalizeMembershipState(membership) {
  const state = membership && membership.state ? String(membership.state).toLowerCase() : 'absent';
  const role = membership && membership.membership && membership.membership.role
    ? String(membership.membership.role).toLowerCase()
    : '';

  if (state === 'active') {
    return role === 'maintainer' ? 'active_maintainer' : 'active_member';
  }
  return state === 'pending' ? 'pending' : state === 'absent' ? 'absent' : 'unknown';
}

function isActiveMembershipState(state) {
  return state === 'active_member' || state === 'active_maintainer';
}

// Team-generic membership probe. Walks the ordered candidates and stops at the
// first team the user is active in. Role-specific ordering belongs to the caller.
async function probeTeamMembership(input = {}) {
  const candidates = orderedTeamCandidates(input);
  const base = {
    team_slug: candidates.length ? candidates[0].slug : '',
    matched_on: null,
    candidate_team_slugs: candidates.map((candidate) => candidate.slug),
    membership_state: 'unknown',
    authorized: false,
  };

  if (typeof input.getMembershipForUser !== 'function' || candidates.length === 0) {
    return base;
  }

  const observedStates = [];
  for (const candidate of candidates) {
    const membership = await input.getMembershipForUser({
      organization: input.organization,
      teamSlug: candidate.slug,
      username: input.username,
    });
    const membershipState = normalizeMembershipState(membership);
    observedStates.push(membershipState);

    if (isActiveMembershipState(membershipState)) {
      return {
        ...base,
        team_slug: candidate.slug,
        matched_on: candidate.matched_on,
        membership_state: membershipState,
        authorized: true,
      };
    }
  }

  return {
    ...base,
    membership_state: observedStates.includes('unknown') ? 'unknown' : observedStates[0],
  };
}

module.exports = {
  isActiveMembershipState,
  normalizeMembershipState,
  orderedTeamCandidates,
  probeTeamMembership,
};
