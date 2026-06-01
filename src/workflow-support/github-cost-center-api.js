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

function mapCostCenter(raw = {}) {
  return {
    id: raw.id ?? null,
    name: raw.name ?? '',
    state: raw.state ?? 'active',
    resources: Array.isArray(raw.resources)
      ? raw.resources.map((resource) => ({
          type: resource.type ?? '',
          name: resource.name ?? '',
        }))
      : [],
  };
}

function buildResourceBody({ users = [], organizations = [], repositories = [] }) {
  const body = {};
  if (Array.isArray(users) && users.length > 0) {
    body.users = users;
  }
  if (Array.isArray(organizations) && organizations.length > 0) {
    body.organizations = organizations;
  }
  if (Array.isArray(repositories) && repositories.length > 0) {
    body.repositories = repositories;
  }
  return body;
}

function createGitHubCostCenterApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';

  if (!token) {
    throw new Error('GitHub cost center API requires a workflow token');
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

  function basePath(enterprise) {
    return `/enterprises/${enterprise}/settings/billing/cost-centers`;
  }

  return {
    async listIssueComments({ repository, issueNumber }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list issue comments'), result);
      }
      return result.payload || [];
    },

    async listCostCenters({ enterprise, state }) {
      const query = state ? `?state=${state}` : '';
      const result = await request(`${basePath(enterprise)}${query}`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list cost centers'), result);
      }

      const payload = result.payload;
      const costCenters = Array.isArray(payload)
        ? payload
        : (payload && (payload.costCenters || payload.cost_centers)) || [];

      return costCenters.map(mapCostCenter);
    },

    async getCostCenter({ enterprise, costCenterId }) {
      const result = await request(`${basePath(enterprise)}/${costCenterId}`);
      if (result.status === 404) {
        return { exists: false, costCenter: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load cost center'), result);
      }
      return {
        exists: true,
        costCenter: mapCostCenter(result.payload || {}),
      };
    },

    async createCostCenter({ enterprise, name }) {
      const result = await request(basePath(enterprise), {
        method: 'POST',
        body: { name },
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create cost center'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapCostCenter(result.payload || {});
    },

    async addResource({ enterprise, costCenterId, users = [], organizations = [], repositories = [] }) {
      const result = await request(`${basePath(enterprise)}/${costCenterId}/resource`, {
        method: 'POST',
        body: buildResourceBody({ users, organizations, repositories }),
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to add cost center resource'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { ok: true, status: result.status, payload: result.payload };
    },

    async removeResource({ enterprise, costCenterId, users = [], organizations = [], repositories = [] }) {
      const result = await request(`${basePath(enterprise)}/${costCenterId}/resource`, {
        method: 'DELETE',
        body: buildResourceBody({ users, organizations, repositories }),
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to remove cost center resource'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return { ok: true, status: result.status, payload: result.payload };
    },
  };
}

module.exports = {
  createGitHubCostCenterApi,
  mapCostCenter,
};
