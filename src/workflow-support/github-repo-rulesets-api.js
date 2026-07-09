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
  } catch (error) {
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

function mapRepositoryRulesetState(ruleset = {}) {
  return {
    id: ruleset.id != null ? ruleset.id : null,
    name: ruleset.name || '',
    target: ruleset.target || '',
    enforcement: ruleset.enforcement || '',
    source: ruleset.source || '',
    source_type: ruleset.source_type || '',
    created_at: ruleset.created_at || null,
    updated_at: ruleset.updated_at || null,
  };
}

function createGitHubRepoRulesetsApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';

  if (!token) {
    throw new Error('GitHub repository rulesets API requires a workflow token');
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
    async getRepository({ owner, repo }) {
      const result = await request(`/repos/${owner}/${encodeURIComponent(repo)}`);
      if (result.status === 404) {
        return { exists: false, repository: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load repository'), result);
      }
      return { exists: true, repository: result.payload || {} };
    },

    async getRepositoryCollaboratorPermission({ owner, repo, username }) {
      const result = await request(
        `/repos/${owner}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}/permission`
      );
      if (result.status === 404) {
        return { exists: false, permission: 'none', role_name: '' };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load repository collaborator permission'), result);
      }
      const payload = result.payload || {};
      return {
        exists: true,
        permission: String(payload.permission || 'none').toLowerCase(),
        role_name: payload.role_name || '',
      };
    },

    async listRepositoryRulesets({ owner, repo }) {
      const rulesets = [];
      let page = 1;
      // Repository rulesets are paginated; walk pages until the API returns
      // fewer than a full page so re-runs read the complete current state.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await request(
          `/repos/${owner}/${encodeURIComponent(repo)}/rulesets?per_page=100&page=${page}&includes_parents=false`
        );
        if (!result.ok) {
          throw Object.assign(new Error('Failed to list repository rulesets'), result);
        }
        const pageRulesets = Array.isArray(result.payload) ? result.payload : [];
        for (const ruleset of pageRulesets) {
          rulesets.push(mapRepositoryRulesetState(ruleset));
        }
        if (pageRulesets.length < 100) {
          break;
        }
        page += 1;
      }
      return rulesets;
    },

    async getRepositoryRuleset({ owner, repo, rulesetId }) {
      const result = await request(
        `/repos/${owner}/${encodeURIComponent(repo)}/rulesets/${encodeURIComponent(rulesetId)}`
      );
      if (result.status === 404) {
        return { exists: false, ruleset: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load repository ruleset'), result);
      }
      return { exists: true, ruleset: result.payload || {} };
    },

    async createRepositoryRuleset({ owner, repo, payload }) {
      const result = await request(`/repos/${owner}/${encodeURIComponent(repo)}/rulesets`, {
        method: 'POST',
        body: payload,
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create repository ruleset'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { created: true, ruleset: mapRepositoryRulesetState(result.payload || {}) };
    },

    async deleteRepositoryRuleset({ owner, repo, rulesetId }) {
      const result = await request(
        `/repos/${owner}/${encodeURIComponent(repo)}/rulesets/${encodeURIComponent(rulesetId)}`,
        {
          method: 'DELETE',
        }
      );

      if (result.status === 404) {
        return { deleted: false, not_found: true };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to delete repository ruleset'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { deleted: true, not_found: false };
    },
  };
}

module.exports = {
  createGitHubRepoRulesetsApi,
  getHeader,
  mapRepositoryRulesetState,
};
