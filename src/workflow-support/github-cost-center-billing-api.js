'use strict';

// Thin, dependency-free client for the GitHub Enterprise billing cost-center
// REST endpoints. Mirrors the fetch-wrapper conventions of github-team-api.js.
//
// Endpoints (enterprise-scoped, require a classic PAT with manage_billing:enterprise
// held by an enterprise owner or billing manager):
//   GET    /enterprises/{enterprise}/settings/billing/cost-centers
//   POST   /enterprises/{enterprise}/settings/billing/cost-centers           {name}
//   GET    /enterprises/{enterprise}/settings/billing/cost-centers/{id}
//   PATCH  /enterprises/{enterprise}/settings/billing/cost-centers/{id}       {name}
//   DELETE /enterprises/{enterprise}/settings/billing/cost-centers/{id}

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

function mapCostCenterState(costCenter = {}) {
  return {
    id: costCenter.id != null ? String(costCenter.id) : null,
    name: costCenter.name || '',
    state: costCenter.state || 'active',
    resources: Array.isArray(costCenter.resources)
      ? costCenter.resources.map((resource) => ({
          type: resource && resource.type ? String(resource.type) : '',
          name: resource && resource.name ? String(resource.name) : '',
        }))
      : [],
  };
}

function createGitHubCostCenterApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';
  // Cost-center endpoints are documented under a newer API version; default to the
  // repository-standard version and allow an override for environments that require it.
  const apiVersion = options.apiVersion || process.env.COST_CENTER_API_VERSION || '2022-11-28';

  if (!token) {
    throw new Error('GitHub cost-center API requires a workflow token');
  }

  const enc = (value) => encodeURIComponent(String(value));

  async function request(path, requestOptions = {}) {
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method: requestOptions.method || 'GET',
      headers: createHeaders(token, { 'X-GitHub-Api-Version': apiVersion, ...requestOptions.headers }),
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
    async listCostCenters({ enterprise, state = 'active' }) {
      const stateQuery = state ? `?state=${encodeURIComponent(state)}` : '';
      const result = await request(
        `/enterprises/${enc(enterprise)}/settings/billing/cost-centers${stateQuery}`
      );
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list cost centers'), result);
      }
      const list = result.payload && Array.isArray(result.payload.costCenters)
        ? result.payload.costCenters
        : Array.isArray(result.payload)
          ? result.payload
          : result.payload && Array.isArray(result.payload.cost_centers)
            ? result.payload.cost_centers
            : [];
      return list.map(mapCostCenterState);
    },

    async getCostCenter({ enterprise, costCenterId }) {
      const result = await request(
        `/enterprises/${enc(enterprise)}/settings/billing/cost-centers/${enc(costCenterId)}`
      );
      if (result.status === 404) {
        return { exists: false, cost_center: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load cost center'), result);
      }
      return { exists: true, cost_center: mapCostCenterState(result.payload || {}) };
    },

    async createCostCenter({ enterprise, name }) {
      const result = await request(`/enterprises/${enc(enterprise)}/settings/billing/cost-centers`, {
        method: 'POST',
        body: { name },
      });
      if (!result.ok) {
        throw Object.assign(new Error('Failed to create cost center'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }
      return mapCostCenterState(result.payload || {});
    },

    async renameCostCenter({ enterprise, costCenterId, name }) {
      const result = await request(
        `/enterprises/${enc(enterprise)}/settings/billing/cost-centers/${enc(costCenterId)}`,
        {
          method: 'PATCH',
          body: { name },
        }
      );
      if (!result.ok) {
        throw Object.assign(new Error('Failed to rename cost center'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }
      return mapCostCenterState(result.payload || {});
    },

    async deleteCostCenter({ enterprise, costCenterId }) {
      const result = await request(
        `/enterprises/${enc(enterprise)}/settings/billing/cost-centers/${enc(costCenterId)}`,
        {
          method: 'DELETE',
        }
      );
      if (result.status === 404) {
        return { deleted: false, not_found: true };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to delete cost center'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }
      return { deleted: true, not_found: false };
    },
  };
}

module.exports = {
  createGitHubCostCenterApi,
  getHeader,
  mapCostCenterState,
};
