'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamRepoAccessRequest } = require('../../src/workflow-support/parse-team-repo-access-request');
const { validateTeamRepoAccessRequest } = require('../../src/workflow-support/validate-team-repo-access-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'target team') {
      fields.target_team = value;
    } else if (heading === 'designated repository-access approver') {
      fields.designated_approver = value;
    } else if (heading === 'requested repositories') {
      fields.requested_repositories = value;
    } else if (heading === 'requested permission level') {
      fields.permission_level = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBaseFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  return parseFixtureMarkdown(markdown);
}

function createValidationDependencies(overrides = {}) {
  return {
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async () => ({
      exists: true,
      team: { id: 1, name: 'Platform Engineering', slug: 'platform-engineering' },
    }),
    getOrganizationMembership: async () => ({
      exists: true,
      membership: { role: 'admin', state: 'active' },
    }),
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        id: `${owner}/${repo}`,
        name: repo,
        full_name: `${owner}/${repo}`,
        owner,
        archived: false,
        private: true,
      },
    }),
    getTeamRepositoryPermission: async () => ({
      exists: false,
      current_permission_api_value: 'none',
    }),
    ...overrides,
  };
}

test('parses a valid add-team-repo-access fixture into a normalized request', () => {
  const parsedRequest = loadBaseFixture();
  const request = parseTeamRepoAccessRequest({
    parsedRequest,
    issue: { number: 701, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.team_slug, 'platform-engineering');
  assert.equal(request.designated_approver_login, 'octocat');
  assert.equal(request.requested_permission_label, 'write');
  assert.equal(request.requested_permission_api_value, 'push');
  assert.deepEqual(
    request.requested_repository_grants.map((grant) => grant.repository_full_name),
    ['octo-org/service-catalog', 'octo-org/developer-portal']
  );
  assert.equal(request.dry_run, true);
});

test('rejects duplicate repositories from a fixture-derived submission', async () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_repositories = `${parsedRequest.requested_repositories}\nservice-catalog`;

  const validation = await validateTeamRepoAccessRequest({
    parsedRequest,
    issue: { number: 702, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /duplicate requested repositories/i);
});

test('rejects mixed-organization repositories from a fixture-derived submission', async () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_repositories = 'octo-org/service-catalog\nanother-org/developer-portal';

  const validation = await validateTeamRepoAccessRequest({
    parsedRequest,
    issue: { number: 703, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /outside the target organization/i);
});

test('rejects archived repositories during validation', async () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_repositories = 'archived-portal';

  const validation = await validateTeamRepoAccessRequest({
    parsedRequest,
    issue: { number: 704, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        id: `${owner}/${repo}`,
        name: repo,
        full_name: `${owner}/${repo}`,
        owner,
        archived: true,
        private: true,
      },
    }),
  }));

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /archived repositories are blocked/i);
});

test('rejects malformed repository and unsupported input combinations', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: 'not a repo name???',
      permission_level: 'custom-role',
      requested_people: 'hubot',
      business_justification: 'Need access',
      dry_run: 'true',
    },
    issue: { number: 705, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /supported built-in repository role is required/i);
  assert.match(validation.errors.join('\n'), /member-management input is out of scope/i);
});

test('rejects team-creation and hierarchy inputs in repository-access submissions', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: 'service-catalog',
      permission_level: 'write',
      requested_team_names: 'New Team',
      parent_team: 'Platform Engineering',
      business_justification: 'Need access',
      dry_run: 'true',
    },
    issue: { number: 706, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /team-creation input is out of scope/i);
  assert.match(validation.errors.join('\n'), /team-hierarchy input is out of scope/i);
});