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

function mapOrganizationVariableState(variable = {}) {
  return {
    name: variable.name || '',
    value: variable.value != null ? variable.value : '',
    visibility: variable.visibility || '',
    selected_repositories_url: variable.selected_repositories_url || null,
    created_at: variable.created_at || null,
    updated_at: variable.updated_at || null,
  };
}

function createGitHubOrgVariablesApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';

  if (!token) {
    throw new Error('GitHub org variables API requires a workflow token');
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
    async listOrganizationVariables({ organization }) {
      const variables = [];
      let page = 1;
      // Organization Actions variables are paginated; walk pages until the API
      // returns fewer than a full page so re-runs read the complete current state.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await request(`/orgs/${organization}/actions/variables?per_page=100&page=${page}`);
        if (!result.ok) {
          throw Object.assign(new Error('Failed to list organization Actions variables'), result);
        }
        const pageVariables = result.payload && result.payload.variables ? result.payload.variables : [];
        for (const variable of pageVariables) {
          variables.push(mapOrganizationVariableState(variable));
        }
        if (pageVariables.length < 100) {
          break;
        }
        page += 1;
      }
      return variables;
    },

    async getOrganizationVariable({ organization, name }) {
      const result = await request(`/orgs/${organization}/actions/variables/${encodeURIComponent(name)}`);
      if (result.status === 404) {
        return { exists: false, variable: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load organization Actions variable'), result);
      }
      return { exists: true, variable: mapOrganizationVariableState(result.payload || {}) };
    },

    async createOrganizationVariable({ organization, name, value, visibility }) {
      const result = await request(`/orgs/${organization}/actions/variables`, {
        method: 'POST',
        body: {
          name,
          value,
          visibility: visibility || 'all',
        },
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create organization Actions variable'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { created: true, name };
    },

    async updateOrganizationVariable({ organization, name, value }) {
      const result = await request(`/orgs/${organization}/actions/variables/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: { value },
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to update organization Actions variable'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { updated: true, name };
    },

    async deleteOrganizationVariable({ organization, name }) {
      const result = await request(`/orgs/${organization}/actions/variables/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });

      if (result.status === 404) {
        return { deleted: false, not_found: true };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to delete organization Actions variable'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { deleted: true, not_found: false };
    },
  };
}

module.exports = {
  createGitHubOrgVariablesApi,
  getHeader,
  mapOrganizationVariableState,
};
