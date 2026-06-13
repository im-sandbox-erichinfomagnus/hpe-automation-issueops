'use strict';

function getGlobalFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('A fetch implementation is required to call the GitHub API');
  }

  return fetch;
}

function createHeaders(token, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'issueops-speckit',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extraHeaders,
  };
}

async function parsePayload(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getHeader(headers, name) {
  if (!headers) {
    return undefined;
  }

  if (typeof headers.get === 'function') {
    return headers.get(name);
  }

  return headers[name] || headers[name.toLowerCase()];
}

function mapRepositoryState(repository) {
  return {
    id: repository.id || null,
    name: String(repository.name || '').toLowerCase(),
    full_name: String(repository.full_name || '').toLowerCase(),
    owner: repository.owner && repository.owner.login
      ? String(repository.owner.login).toLowerCase()
      : '',
    archived: Boolean(repository.archived),
    private: Boolean(repository.private),
    visibility: String(repository.visibility || (repository.private ? 'private' : 'public')).toLowerCase(),
  };
}

function mapRoleNameToPermissionApiValue(roleName = '') {
  const normalizedRoleName = String(roleName || '').trim().toLowerCase();

  if (normalizedRoleName === 'read') {
    return 'pull';
  }

  if (normalizedRoleName === 'write') {
    return 'push';
  }

  if (['triage', 'maintain', 'admin', 'pull', 'push'].includes(normalizedRoleName)) {
    return normalizedRoleName;
  }

  return 'none';
}

function createGitHubTeamRepoApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';

  if (!token) {
    throw new Error('GitHub team repository API requires a workflow token');
  }

  async function request(path, requestOptions = {}) {
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method: requestOptions.method || 'GET',
      headers: createHeaders(token, requestOptions.headers),
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
    });

    const payload = await parsePayload(response);
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      payload,
    };
  }

  return {
    async listIssueComments({ repository, issueNumber }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`);

      if (!result.ok) {
        throw Object.assign(new Error('Failed to list issue comments'), result);
      }

      return Array.isArray(result.payload) ? result.payload : [];
    },

    async getOrganization({ organization }) {
      const result = await request(`/orgs/${organization}`);
      if (result.status === 404) {
        return { exists: false, organization: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load organization'), result);
      }
      return { exists: true, organization: result.payload };
    },

    async getOrganizationMembership({ organization, username }) {
      const result = await request(`/orgs/${organization}/memberships/${username}`);
      if (result.status === 404) {
        return { exists: false, membership: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to inspect organization membership'), result);
      }
      return { exists: true, membership: result.payload };
    },

    async getTeamBySlug({ organization, teamSlug }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}`);
      if (result.status === 404) {
        return { exists: false, team: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load team by slug'), result);
      }
      return { exists: true, team: result.payload };
    },

    async getRepository({ owner, repo }) {
      const result = await request(`/repos/${owner}/${repo}`);
      if (result.status === 404) {
        return { exists: false, repository: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load repository'), result);
      }
      return {
        exists: true,
        repository: mapRepositoryState(result.payload || {}),
      };
    },

    async createOrganizationRepository({ organization, name, privateVisibility = true, visibility = null, description = '' }) {
      const body = {
        name,
        description: String(description || ''),
        auto_init: false,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
      };

      if (visibility) {
        body.visibility = String(visibility);
      } else {
        body.private = Boolean(privateVisibility);
      }

      const result = await request(`/orgs/${organization}/repos`, {
        method: 'POST',
        body,
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create organization repository'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return {
        exists: true,
        repository: mapRepositoryState(result.payload || {}),
      };
    },

    async getTeamRepositoryPermission({ organization, teamSlug, owner, repo }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}/repos/${owner}/${repo}`, {
        headers: {
          Accept: 'application/vnd.github.v3.repository+json',
        },
      });
      if (result.status === 404) {
        return {
          exists: false,
          repository: null,
          current_permission_api_value: 'none',
          current_permission_rank: 0,
        };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to inspect team repository permission'), result);
      }

      const repository = mapRepositoryState(result.payload || {});
      const permissions = result.payload && result.payload.permissions ? result.payload.permissions : {};
      const orderedPermissions = ['admin', 'maintain', 'push', 'triage', 'pull'];
      const currentPermissionApiValue = mapRoleNameToPermissionApiValue(
        result.payload && result.payload.role_name
      ) !== 'none'
        ? mapRoleNameToPermissionApiValue(result.payload && result.payload.role_name)
        : orderedPermissions.find((permission) => permissions[permission]) || 'none';

      return {
        exists: true,
        repository,
        current_permission_api_value: currentPermissionApiValue,
      };
    },

    async addOrUpdateTeamRepositoryPermission({ organization, teamSlug, owner, repo, permission }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}/repos/${owner}/${repo}`, {
        method: 'PUT',
        body: { permission },
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to add team repository permission'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return {
        repository_full_name: `${owner}/${repo}`.toLowerCase(),
        permission,
      };
    },

    async removeTeamRepositoryPermission({ organization, teamSlug, owner, repo }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}/repos/${owner}/${repo}`, {
        method: 'DELETE',
      });

      if (!result.ok && result.status !== 404) {
        throw Object.assign(new Error('Failed to remove team repository permission'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return {
        repository_full_name: `${owner}/${repo}`.toLowerCase(),
      };
    },

    async addIssueLabels({ repository, issueNumber, labels }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
        method: 'POST',
        body: { labels },
      });
      if (!result.ok) {
        throw Object.assign(new Error('Failed to add issue labels'), result);
      }
      return (result.payload || []).map((label) => String(label.name || '').toLowerCase()).filter(Boolean);
    },
  };
}

module.exports = {
  createGitHubTeamRepoApi,
  getHeader,
  mapRoleNameToPermissionApiValue,
  mapRepositoryState,
};