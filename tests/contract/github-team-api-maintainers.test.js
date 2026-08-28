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
    { username: 'real-maintainer', role: 'maintainer', state: 'active' },
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

test('listOrgTeams walks every page so tenant resolution sees teams past the first 100', async () => {
  const requestedPaths = [];
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, slug: `team-${String(i + 1).padStart(3, '0')}`, name: `Team ${i + 1}`, parent: null }));
  const page2 = Array.from({ length: 56 }, (_, i) => ({ id: 101 + i, slug: `realc01-${i}`, name: `RealC01 ${i}`, parent: null }));

  const fetchImpl = async (url) => {
    const path = url.replace('https://api.github.com', '');
    requestedPaths.push(path);

    if (path.startsWith('/orgs/octo-org/teams?')) {
      // A request with no page parameter behaves as page 1, matching the API default.
      const match = /[?&]page=(\d+)/.exec(path);
      const page = match ? Number(match[1]) : 1;
      return jsonResponse(page === 1 ? page1 : page === 2 ? page2 : []);
    }
    return jsonResponse([], 200);
  };

  const api = createGitHubTeamApi({ token: 'test-token', fetchImpl });
  const teams = await api.listOrgTeams({ organization: 'octo-org' });

  assert.equal(teams.length, 156);
  assert.equal(requestedPaths.filter((p) => p.startsWith('/orgs/octo-org/teams?')).length, 2);
  assert.ok(teams.some((team) => team.slug === 'team-001'), 'first page must be included');
  assert.ok(teams.some((team) => team.slug === 'realc01-55'), 'second page must be included');
});

test('listOrgTeams stops after a short first page', async () => {
  const requestedPaths = [];
  const fetchImpl = async (url) => {
    const path = url.replace('https://api.github.com', '');
    requestedPaths.push(path);
    return jsonResponse([{ id: 1, slug: 'only-team', name: 'Only Team', parent: null }]);
  };

  const api = createGitHubTeamApi({ token: 'test-token', fetchImpl });
  const teams = await api.listOrgTeams({ organization: 'octo-org' });

  assert.equal(teams.length, 1);
  assert.deepEqual(requestedPaths, ['/orgs/octo-org/teams?per_page=100&page=1']);
});
