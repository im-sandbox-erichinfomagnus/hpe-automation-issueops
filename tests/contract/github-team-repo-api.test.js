'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGitHubTeamRepoApi } = require('../../src/workflow-support/github-team-repo-api');

test('getTeamRepositoryPermission requests repository media type and maps role_name to API permission value', async () => {
  const requests = [];
  const api = createGitHubTeamRepoApi({
    token: 'pat-token',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          id: 101,
          name: 'service-catalog',
          full_name: 'octo-org/service-catalog',
          owner: { login: 'octo-org' },
          archived: false,
          private: true,
          role_name: 'read',
          permissions: {
            admin: false,
            maintain: false,
            push: false,
            triage: false,
            pull: true,
          },
        }),
      };
    },
  });

  const result = await api.getTeamRepositoryPermission({
    organization: 'octo-org',
    teamSlug: 'platform-engineering',
    owner: 'octo-org',
    repo: 'service-catalog',
  });

  assert.equal(
    requests[0].options.headers.Accept,
    'application/vnd.github.v3.repository+json'
  );
  assert.equal(result.exists, true);
  assert.equal(result.current_permission_api_value, 'pull');
});

test('getTeamRepositoryPermission maps role_name write to push', async () => {
  const api = createGitHubTeamRepoApi({
    token: 'pat-token',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        id: 102,
        name: 'developer-portal',
        full_name: 'octo-org/developer-portal',
        owner: { login: 'octo-org' },
        archived: false,
        private: true,
        role_name: 'write',
        permissions: {
          admin: false,
          maintain: false,
          push: true,
          triage: false,
          pull: true,
        },
      }),
    }),
  });

  const result = await api.getTeamRepositoryPermission({
    organization: 'octo-org',
    teamSlug: 'platform-engineering',
    owner: 'octo-org',
    repo: 'developer-portal',
  });

  assert.equal(result.current_permission_api_value, 'push');
});