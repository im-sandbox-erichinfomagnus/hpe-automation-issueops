'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveCanonicalTenantTeams,
  deriveCicdAdminTeam,
  orderedCicdTeamCandidates,
  probeCicdTeamMembership,
  readTopologyView,
} = require('../../src/workflow-support/resolve-tenant-cicd-context-from-registry');

function canonicalRecord(structure) {
  return {
    tenantId: 'contosouk',
    tenantName: 'ContosoUK',
    organization: 'octo-org',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: { tenantRootTeam: 'contosouk-root', structure },
    },
  };
}

const FULL_STRUCTURE = [
  { team: 'contosouk-root', parent: null, type: 'root' },
  { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
  { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
  { team: 'contosouk-cicd-admin', parent: 'contosouk-root', type: 'cicd-admin' },
];

function membership(state, role) {
  return { state, membership: role ? { role } : null };
}

test('deriveCanonicalTenantTeams derives the dedicated cicd-admin team', () => {
  const teams = deriveCanonicalTenantTeams('ContosoUK');
  assert.equal(teams.admin_team_slug, 'contosouk-admin');
  assert.equal(teams.cicd_admin_team_slug, 'contosouk-cicd-admin');
});

test('deriveCicdAdminTeam returns the dedicated cicd-admin team, not the admin team', () => {
  const derived = deriveCicdAdminTeam('ContosoUK');
  assert.equal(derived.cicd_admin_team_name, 'contosouk-cicd-admin');
  assert.equal(derived.cicd_admin_team_slug, 'contosouk-cicd-admin');
});

test('readTopologyView surfaces the cicd-admin node from a canonical record', () => {
  const view = readTopologyView(canonicalRecord(FULL_STRUCTURE));
  assert.equal(view.schema, 'canonical');
  assert.equal(view.admin_team_slug, 'contosouk-admin');
  assert.equal(view.cicd_admin_team_slug, 'contosouk-cicd-admin');
});

test('readTopologyView leaves the cicd-admin slug empty when the canonical record has no such node', () => {
  const view = readTopologyView(canonicalRecord(FULL_STRUCTURE.filter((node) => node.type !== 'cicd-admin')));
  assert.equal(view.admin_team_slug, 'contosouk-admin');
  assert.equal(view.cicd_admin_team_slug, '');
});

test('readTopologyView projects a cicd-admin slug for a legacy record', () => {
  const view = readTopologyView({ tenant_key: 'legacycorp', tenant_display_name: 'Legacy Corp', organization: 'octo-org' });
  assert.equal(view.schema, 'legacy_projection');
  assert.equal(view.admin_team_slug, 'legacy-corp-admin');
  assert.equal(view.cicd_admin_team_slug, 'legacy-corp-cicd-admin');
});

test('orderedCicdTeamCandidates puts cicd-admin first and drops teams missing from the org', () => {
  const both = orderedCicdTeamCandidates({
    cicdAdminTeamSlug: 'contosouk-cicd-admin',
    adminTeamSlug: 'contosouk-admin',
  });
  assert.deepEqual(both.map((candidate) => candidate.matched_on), ['cicd-admin', 'admin']);

  const onlyAdminExists = orderedCicdTeamCandidates({
    cicdAdminTeamSlug: 'contosouk-cicd-admin',
    adminTeamSlug: 'contosouk-admin',
    teamExists: (slug) => slug === 'contosouk-admin',
  });
  assert.deepEqual(onlyAdminExists.map((candidate) => candidate.slug), ['contosouk-admin']);
});

test('probeCicdTeamMembership authorizes a member of the cicd-admin team', async () => {
  const probed = [];
  const result = await probeCicdTeamMembership({
    organization: 'octo-org',
    username: 'cicd-only-user',
    cicdAdminTeamSlug: 'contosouk-cicd-admin',
    adminTeamSlug: 'contosouk-admin',
    getMembershipForUser: async ({ teamSlug }) => {
      probed.push(teamSlug);
      return teamSlug === 'contosouk-cicd-admin' ? membership('active', 'member') : membership('absent');
    },
  });

  assert.equal(result.authorized, true);
  assert.equal(result.cicd_admin_team_slug, 'contosouk-cicd-admin');
  assert.equal(result.cicd_admin_team_matched_on, 'cicd-admin');
  assert.deepEqual(probed, ['contosouk-cicd-admin'], 'stops at the first authorizing team');
});

test('probeCicdTeamMembership falls back to the admin team', async () => {
  const probed = [];
  const result = await probeCicdTeamMembership({
    organization: 'octo-org',
    username: 'admin-only-user',
    cicdAdminTeamSlug: 'contosouk-cicd-admin',
    adminTeamSlug: 'contosouk-admin',
    getMembershipForUser: async ({ teamSlug }) => {
      probed.push(teamSlug);
      return teamSlug === 'contosouk-admin' ? membership('active', 'maintainer') : membership('absent');
    },
  });

  assert.equal(result.authorized, true);
  assert.equal(result.cicd_admin_team_slug, 'contosouk-admin');
  assert.equal(result.cicd_admin_team_matched_on, 'admin');
  assert.equal(result.membership_state, 'active_maintainer');
  assert.deepEqual(probed, ['contosouk-cicd-admin', 'contosouk-admin']);
});

test('probeCicdTeamMembership blocks a member of neither team and reports both candidates', async () => {
  const result = await probeCicdTeamMembership({
    organization: 'octo-org',
    username: 'outsider-user',
    cicdAdminTeamSlug: 'contosouk-cicd-admin',
    adminTeamSlug: 'contosouk-admin',
    getMembershipForUser: async () => membership('absent'),
  });

  assert.equal(result.authorized, false);
  assert.equal(result.cicd_admin_team_matched_on, null);
  assert.deepEqual(result.candidate_team_slugs, ['contosouk-cicd-admin', 'contosouk-admin']);
  assert.equal(result.membership_state, 'absent');
});

test('probeCicdTeamMembership reports unknown when any probe is indeterminate', async () => {
  const result = await probeCicdTeamMembership({
    organization: 'octo-org',
    username: 'ambiguous-user',
    cicdAdminTeamSlug: 'contosouk-cicd-admin',
    adminTeamSlug: 'contosouk-admin',
    getMembershipForUser: async ({ teamSlug }) => (
      teamSlug === 'contosouk-cicd-admin' ? membership('mystery') : membership('absent')
    ),
  });

  assert.equal(result.authorized, false);
  assert.equal(result.membership_state, 'unknown');
});
