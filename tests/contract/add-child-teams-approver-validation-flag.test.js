'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateTeamHierarchyRequest } = require('../../src/workflow-support/validate-team-hierarchy-request');

const CURRENT_TEAMS = [
  { id: 1, name: 'Platform Engineering', slug: 'platform-engineering', parent: null },
  { id: 2, name: 'Application Platform', slug: 'application-platform', parent: null },
  { id: 3, name: 'Release Engineering', slug: 'release-engineering', parent: null },
];

function buildInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      parent_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_child_teams: 'Application Platform\nRelease Engineering',
      business_justification: 'Need hierarchy updates',
      dry_run: 'true',
      ...overrides,
    },
    issue: { number: 640, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  };
}

// The diagnostic block only runs when organization, designated_approver_login and
// resolveTeamMembership are all present, so every option below is required.
function buildOptions(overrides = {}) {
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => CURRENT_TEAMS,
    resolveTeamMembership: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
    ...overrides,
  };
}

test('an add-child-teams request reaches a coherent verdict instead of throwing', async () => {
  const validation = await validateTeamHierarchyRequest(buildInput(), buildOptions());

  assert.equal(typeof validation.is_valid, 'boolean');
  assert.doesNotMatch(validation.errors.join('\n'), /is not defined/);
  assert.doesNotMatch(validation.errors.join('\n'), /skipDesignatedApproverValidation/);
});

test('the designated approver child-team roles are collected when the diagnostic block runs', async () => {
  const validation = await validateTeamHierarchyRequest(buildInput(), buildOptions());

  // Prove the block was entered rather than skipped for one of its other conditions.
  assert.equal(validation.request.organization, 'octo-org');
  assert.equal(validation.request.designated_approver_login, 'octocat');

  const childTeamRoles = validation.designated_approver_authorization.child_team_roles;
  assert.ok(childTeamRoles.length > 0, JSON.stringify(validation.designated_approver_authorization));
  assert.deepEqual(
    childTeamRoles.map((entry) => entry.child_team_slug).sort(),
    ['application-platform', 'release-engineering']
  );
  assert.equal(childTeamRoles.every((entry) => entry.role === 'maintainer'), true);
});

test('skipDesignatedApproverValidation suppresses only the diagnostic block, not the verdict', async () => {
  const enriched = await validateTeamHierarchyRequest(buildInput(), buildOptions());
  const skipped = await validateTeamHierarchyRequest(
    buildInput(),
    buildOptions({ skipDesignatedApproverValidation: true })
  );

  assert.deepEqual(skipped.designated_approver_authorization.child_team_roles, []);
  assert.ok(enriched.designated_approver_authorization.child_team_roles.length > 0);
  assert.equal(skipped.is_valid, enriched.is_valid);
  assert.deepEqual(skipped.errors, enriched.errors);
});

test('a designated approver outside the organization is still rejected by the enforcing check', async () => {
  const validation = await validateTeamHierarchyRequest(
    buildInput(),
    buildOptions({ getOrganizationMembership: async () => ({ exists: false, membership: null }) })
  );

  assert.equal(validation.is_valid, false);
  assert.match(
    validation.errors.join('\n'),
    /must be an active member of the target organization/
  );
  assert.equal(validation.designated_approver_authorization.state, 'unauthorized');
});
