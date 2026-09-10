'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isActiveMembershipState,
  normalizeMembershipState,
  orderedTeamCandidates,
  probeTeamMembership,
} = require('../../src/workflow-support/probe-team-membership');

function membership(state, role) {
  return { state, membership: role ? { role } : null };
}

function membershipReader(map, calls) {
  return async ({ organization, teamSlug, username }) => {
    if (calls) {
      calls.push({ organization, teamSlug, username });
    }
    return map[teamSlug] || { state: 'absent' };
  };
}

test('orderedTeamCandidates normalizes slugs and keeps the caller order', () => {
  const candidates = orderedTeamCandidates({
    teamSlugs: [
      { slug: '  ContosoUK-CICD-Admin ', matched_on: 'cicd-admin' },
      { slug: 'ContosoUK-Admin', matched_on: 'admin' },
      { slug: 'contosouk-root', matched_on: 'root' },
    ],
  });

  assert.deepEqual(candidates, [
    { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
    { slug: 'contosouk-admin', matched_on: 'admin' },
    { slug: 'contosouk-root', matched_on: 'root' },
  ]);
});

test('orderedTeamCandidates accepts plain slug strings and labels them with the slug', () => {
  const candidates = orderedTeamCandidates({ teamSlugs: ['Contosouk-Admin', 'contosouk-root'] });

  assert.deepEqual(candidates, [
    { slug: 'contosouk-admin', matched_on: 'contosouk-admin' },
    { slug: 'contosouk-root', matched_on: 'contosouk-root' },
  ]);
});

test('orderedTeamCandidates drops blank slugs and keeps the first label for a repeated slug', () => {
  const candidates = orderedTeamCandidates({
    teamSlugs: [
      { slug: '', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
      { slug: '  ', matched_on: 'repo-admin' },
      { slug: 'CONTOSOUK-ADMIN', matched_on: 'root' },
    ],
  });

  assert.deepEqual(candidates, [{ slug: 'contosouk-admin', matched_on: 'admin' }]);
});

test('orderedTeamCandidates filters out teams that teamExists rejects', () => {
  const candidates = orderedTeamCandidates({
    teamSlugs: [
      { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
    ],
    teamExists: (slug) => slug === 'contosouk-admin',
  });

  assert.deepEqual(candidates, [{ slug: 'contosouk-admin', matched_on: 'admin' }]);
});

test('orderedTeamCandidates returns an empty list when teamSlugs is missing', () => {
  assert.deepEqual(orderedTeamCandidates(), []);
  assert.deepEqual(orderedTeamCandidates({}), []);
  assert.deepEqual(orderedTeamCandidates({ teamSlugs: [] }), []);
});

test('normalizeMembershipState separates members, maintainers, pending and absent', () => {
  assert.equal(normalizeMembershipState(membership('active', 'member')), 'active_member');
  assert.equal(normalizeMembershipState(membership('active', 'maintainer')), 'active_maintainer');
  assert.equal(normalizeMembershipState(membership('active')), 'active_member');
  assert.equal(normalizeMembershipState(membership('pending')), 'pending');
  assert.equal(normalizeMembershipState(membership('absent')), 'absent');
  assert.equal(normalizeMembershipState(null), 'absent');
  assert.equal(normalizeMembershipState({ state: 'sideways' }), 'unknown');
});

test('isActiveMembershipState treats members and maintainers as active', () => {
  assert.equal(isActiveMembershipState('active_member'), true);
  assert.equal(isActiveMembershipState('active_maintainer'), true);
  assert.equal(isActiveMembershipState('pending'), false);
  assert.equal(isActiveMembershipState('absent'), false);
  assert.equal(isActiveMembershipState('unknown'), false);
});

test('probeTeamMembership stops at the first team the user is active in', async () => {
  const calls = [];
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    getMembershipForUser: membershipReader({
      'contosouk-cicd-admin': membership('active', 'member'),
      'contosouk-admin': membership('active', 'maintainer'),
    }, calls),
    teamSlugs: [
      { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
    ],
  });

  assert.equal(result.team_slug, 'contosouk-cicd-admin');
  assert.equal(result.matched_on, 'cicd-admin');
  assert.equal(result.membership_state, 'active_member');
  assert.equal(result.authorized, true);
  assert.deepEqual(result.candidate_team_slugs, ['contosouk-cicd-admin', 'contosouk-admin']);
  assert.equal(calls.length, 1, 'must not probe further teams once a match is found');
  assert.deepEqual(calls[0], {
    organization: 'octo-org',
    teamSlug: 'contosouk-cicd-admin',
    username: 'octocat',
  });
});

test('probeTeamMembership walks past non-members and authorizes a later team', async () => {
  const calls = [];
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    getMembershipForUser: membershipReader({
      'contosouk-root': membership('active', 'maintainer'),
    }, calls),
    teamSlugs: [
      { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
      { slug: 'contosouk-root', matched_on: 'root' },
    ],
  });

  assert.equal(result.team_slug, 'contosouk-root');
  assert.equal(result.matched_on, 'root');
  assert.equal(result.membership_state, 'active_maintainer');
  assert.equal(result.authorized, true);
  assert.deepEqual(calls.map((call) => call.teamSlug), [
    'contosouk-cicd-admin',
    'contosouk-admin',
    'contosouk-root',
  ]);
});

test('probeTeamMembership probes a deduplicated slug exactly once', async () => {
  const calls = [];
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    getMembershipForUser: membershipReader({}, calls),
    teamSlugs: [
      { slug: 'contosouk-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
    ],
  });

  assert.deepEqual(result.candidate_team_slugs, ['contosouk-admin']);
  assert.equal(calls.length, 1);
  assert.equal(result.authorized, false);
});

test('probeTeamMembership honours teamExists and never probes a missing team', async () => {
  const calls = [];
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    getMembershipForUser: membershipReader({
      'contosouk-admin': membership('active', 'member'),
    }, calls),
    teamSlugs: [
      { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
    ],
    teamExists: (slug) => slug === 'contosouk-admin',
  });

  assert.deepEqual(result.candidate_team_slugs, ['contosouk-admin']);
  assert.deepEqual(calls.map((call) => call.teamSlug), ['contosouk-admin']);
  assert.equal(result.team_slug, 'contosouk-admin');
  assert.equal(result.matched_on, 'admin');
  assert.equal(result.authorized, true);
});

test('probeTeamMembership reports unknown when any probed team returned an unknown state', async () => {
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    getMembershipForUser: membershipReader({
      'contosouk-cicd-admin': { state: 'sideways' },
      'contosouk-admin': membership('pending'),
    }),
    teamSlugs: [
      { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
    ],
  });

  assert.equal(result.membership_state, 'unknown');
  assert.equal(result.authorized, false);
  assert.equal(result.matched_on, null);
  assert.equal(result.team_slug, 'contosouk-cicd-admin', 'unauthorized results report the first candidate');
});

test('probeTeamMembership returns an unauthorized base result without a membership reader', async () => {
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    teamSlugs: [
      { slug: 'contosouk-cicd-admin', matched_on: 'cicd-admin' },
      { slug: 'contosouk-admin', matched_on: 'admin' },
    ],
  });

  assert.equal(result.membership_state, 'unknown');
  assert.equal(result.authorized, false);
  assert.equal(result.team_slug, 'contosouk-cicd-admin');
  assert.deepEqual(result.candidate_team_slugs, ['contosouk-cicd-admin', 'contosouk-admin']);
});

test('probeTeamMembership returns an empty team slug when no candidate survives', async () => {
  const calls = [];
  const result = await probeTeamMembership({
    organization: 'octo-org',
    username: 'octocat',
    getMembershipForUser: membershipReader({}, calls),
    teamSlugs: [{ slug: '', matched_on: 'cicd-admin' }],
  });

  assert.equal(result.team_slug, '');
  assert.equal(result.matched_on, null);
  assert.equal(result.membership_state, 'unknown');
  assert.equal(result.authorized, false);
  assert.deepEqual(result.candidate_team_slugs, []);
  assert.equal(calls.length, 0);
});
