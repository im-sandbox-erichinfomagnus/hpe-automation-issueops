'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGitHubTeamApi } = require('../../src/workflow-support/github-team-api');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    text: async () => JSON.stringify(payload),
  };
}

test('listTeamMaintainers filters out org owners who are only plain team members', async () => {
  const requestedPaths = [];
  const fetchImpl = async (url) => {
    const path = url.replace('https://api.github.com', '');
    requestedPaths.push(path);

    if (path === '/orgs/octo-org/teams/contosouk-root/members?role=maintainer&per_page=100') {
      // The role=maintainer listing includes the org owner despite their explicit member role.
      return jsonResponse([
        { login: 'org-owner-user' },
        { login: 'real-maintainer' },
      ]);
    }
    if (path === '/orgs/octo-org/teams/contosouk-root/memberships/org-owner-user') {
      return jsonResponse({ state: 'active', role: 'member' });
    }
    if (path === '/orgs/octo-org/teams/contosouk-root/memberships/real-maintainer') {
      return jsonResponse({ state: 'active', role: 'maintainer' });
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };

  const api = createGitHubTeamApi({ token: 'test-token', fetchImpl });
  const maintainers = await api.listTeamMaintainers({
    organization: 'octo-org',
    teamSlug: 'contosouk-root',
  });

  assert.deepEqual(maintainers, [
    { username: 'real-maintainer', role: 'member', state: 'active' },
  ]);
  assert.ok(
    requestedPaths.includes('/orgs/octo-org/teams/contosouk-root/memberships/org-owner-user'),
    'per-user membership endpoint must be consulted for the org owner'
  );
  assert.ok(
    requestedPaths.includes('/orgs/octo-org/teams/contosouk-root/memberships/real-maintainer'),
    'per-user membership endpoint must be consulted for the real maintainer'
  );
});

test('listTeamMaintainers skips candidates whose membership vanished (404) without failing', async () => {
  const fetchImpl = async (url) => {
    const path = url.replace('https://api.github.com', '');
    if (path === '/orgs/octo-org/teams/contosouk-root/members?role=maintainer&per_page=100') {
      return jsonResponse([
        { login: 'departed-user' },
        { login: 'real-maintainer' },
      ]);
    }
    if (path === '/orgs/octo-org/teams/contosouk-root/memberships/departed-user') {
      return jsonResponse({ message: 'Not Found' }, 404);
    }
    if (path === '/orgs/octo-org/teams/contosouk-root/memberships/real-maintainer') {
      return jsonResponse({ state: 'active', role: 'maintainer' });
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };

  const api = createGitHubTeamApi({ token: 'test-token', fetchImpl });
  const maintainers = await api.listTeamMaintainers({
    organization: 'octo-org',
    teamSlug: 'contosouk-root',
  });

  assert.deepEqual(maintainers.map((member) => member.username), ['real-maintainer']);
});
