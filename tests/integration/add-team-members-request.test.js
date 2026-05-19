'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamMembershipRequest } = require('../../src/workflow-support/parse-team-membership-request');
const { validateTeamMembershipRequest } = require('../../src/workflow-support/validate-team-membership-request');

function loadValidationFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-validation.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createValidationDependencies(scenario) {
  return {
    getTeam: async () => scenario.team,
    resolveUser: async ({ username }) => scenario.memberships[username] || { exists: false },
  };
}

test('routes a valid existing-team request to approval-ready state', async () => {
  const fixture = loadValidationFixture().existing_team;
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: 'octocat\nhubot',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 201, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamMembershipRequest(
    request,
    createValidationDependencies(fixture)
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.team_exists, true);
  assert.deepEqual(
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
});

test('fails validation when the target team does not exist', async () => {
  const fixture = loadValidationFixture().missing_team;
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'missing-team',
      requested_people: 'octocat',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 202, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamMembershipRequest(
    request,
    createValidationDependencies(fixture)
  );

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /target team does not exist/i);
});