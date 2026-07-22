'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTeamRepoAccessRemovalRequest } = require('../../src/workflow-support/parse-team-repo-access-removal-request');
const { validateTeamRepoAccessRemovalRequest } = require('../../src/workflow-support/validate-team-repo-access-removal-request');

function createValidationApi(overrides = {}) {
  return {
    getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
    getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'platform-engineering' } }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        owner,
        name: repo,
        full_name: `${owner}/${repo}`,
        archived: false,
      },
    }),
    getTeamRepositoryPermission: async ({ repo }) => ({
      exists: true,
      current_permission_api_value: repo === 'developer-portal' ? 'none' : 'maintain',
    }),
    ...overrides,
  };
}

test('manual removal validation accepts a valid request and classifies remove/noop outcomes', async () => {
  const request = parseTeamRepoAccessRemovalRequest({
    parsedRequest: {
      organization: 'octo-org',
      team: 'Platform Engineering',
      designated_approver: 'octocat',
      intake_mode: 'manual',
      requested_repositories: 'service-catalog\ndeveloper-portal',
      dry_run: 'true',
    },
    issue: {
      number: 9201,
      user: { login: 'requester' },
    },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamRepoAccessRemovalRequest(request, createValidationApi());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.request.intake_mode, 'manual');
  assert.deepEqual(
    validation.requested_repository_removals.map((entry) => `${entry.repository_full_name}:${entry.desired_action}`),
    ['octo-org/service-catalog:remove_access', 'octo-org/developer-portal:noop_already_absent']
  );
});

test('manual removal validation rejects duplicate and mixed-organization repositories with clear errors', async () => {
  const request = parseTeamRepoAccessRemovalRequest({
    parsedRequest: {
      organization: 'octo-org',
      team: 'Platform Engineering',
      designated_approver: 'octocat',
      intake_mode: 'manual',
      requested_repositories: 'service-catalog\nservice-catalog\nother-org/foreign-repo',
      dry_run: 'true',
    },
    issue: {
      number: 9202,
      user: { login: 'requester' },
    },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamRepoAccessRemovalRequest(request, createValidationApi());

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /Duplicate requested repositories were detected/i);
  assert.match(validation.errors.join('\n'), /Repositories outside the target organization were detected/i);
});

test('manual removal validation rejects batches that imply multiple designated approvers and requires split requests', async () => {
  const request = parseTeamRepoAccessRemovalRequest({
    parsedRequest: {
      organization: 'octo-org',
      team: 'Platform Engineering',
      designated_approver: 'octocat, hubot',
      intake_mode: 'manual',
      requested_repositories: 'service-catalog',
      dry_run: 'true',
    },
    issue: {
      number: 9203,
      user: { login: 'requester' },
    },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamRepoAccessRemovalRequest(request, createValidationApi({
    getOrganizationMembership: async ({ username }) => ({
      exists: username === 'octocat',
      membership: username === 'octocat'
        ? { role: 'admin', state: 'active' }
        : null,
    }),
  }));

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /multiple distinct valid approvers/i);
  assert.match(validation.errors.join('\n'), /split requests/i);
});
