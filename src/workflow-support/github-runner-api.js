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

function mapHostedRunnerState(runner) {
  return {
    id: runner.id || null,
    name: runner.name || '',
    runner_group_id: runner.runner_group_id || null,
    platform: runner.platform || '',
    status: runner.status || '',
    maximum_runners: runner.maximum_runners || null,
    public_ip_enabled: Boolean(runner.public_ip_enabled),
    image_details: runner.image_details || null,
    machine_size_details: runner.machine_size_details || null,
    last_active_on: runner.last_active_on || null,
  };
}

function mapRunnerGroupState(group) {
  return {
    id: group.id || null,
    name: group.name || '',
    visibility: group.visibility || '',
    default: Boolean(group.default),
    inherited: Boolean(group.inherited),
    allows_public_repositories: Boolean(group.allows_public_repositories),
    restricted_to_workflows: Boolean(group.restricted_to_workflows),
    selected_workflows: group.selected_workflows || [],
    network_configuration_id: group.network_configuration_id || null,
  };
}

function createGitHubRunnerApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';

  if (!token) {
    throw new Error('GitHub runner API requires a workflow token');
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
    async getOrganization({ organization }) {
      const result = await request(`/orgs/${organization}`);
      if (result.status === 404) {
        return { exists: false, organization: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load organization'), result);
      }
      return {
        exists: true,
        organization: result.payload,
      };
    },

    async listHostedRunners({ organization }) {
      const result = await request(`/orgs/${organization}/actions/hosted-runners?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list organization hosted runners'), result);
      }
      return (result.payload && result.payload.runners ? result.payload.runners : []).map(mapHostedRunnerState);
    },

    async getHostedRunner({ organization, hostedRunnerId }) {
      const result = await request(`/orgs/${organization}/actions/hosted-runners/${hostedRunnerId}`);
      if (result.status === 404) {
        return { exists: false, runner: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load hosted runner'), result);
      }
      return { exists: true, runner: mapHostedRunnerState(result.payload || {}) };
    },

    async createHostedRunner({ organization, name, imageId, imageSource, size, runnerGroupId, maximumRunners, enableStaticIp }) {
      const body = {
        name,
        image: {
          id: imageId,
          source: imageSource,
        },
        size,
        runner_group_id: runnerGroupId,
      };
      if (maximumRunners != null) {
        body.maximum_runners = maximumRunners;
      }
      if (enableStaticIp != null) {
        body.enable_static_ip = Boolean(enableStaticIp);
      }

      const result = await request(`/orgs/${organization}/actions/hosted-runners`, {
        method: 'POST',
        body,
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create hosted runner'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapHostedRunnerState(result.payload || {});
    },

    async deleteHostedRunner({ organization, hostedRunnerId }) {
      const result = await request(`/orgs/${organization}/actions/hosted-runners/${hostedRunnerId}`, {
        method: 'DELETE',
      });

      if (result.status === 404) {
        return { deleted: false, not_found: true };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to delete hosted runner'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return {
        deleted: true,
        not_found: false,
        runner: result.payload ? mapHostedRunnerState(result.payload) : null,
      };
    },

    async listRunnerGroups({ organization }) {
      const result = await request(`/orgs/${organization}/actions/runner-groups?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list organization runner groups'), result);
      }
      return (result.payload && result.payload.runner_groups ? result.payload.runner_groups : []).map(mapRunnerGroupState);
    },

    async createRunnerGroup({ organization, name, visibility, selectedRepositoryIds, allowsPublicRepositories, restrictedToWorkflows, selectedWorkflows }) {
      const body = { name };
      if (visibility) {
        body.visibility = visibility;
      }
      if (Array.isArray(selectedRepositoryIds) && selectedRepositoryIds.length > 0) {
        body.selected_repository_ids = selectedRepositoryIds;
      }
      if (allowsPublicRepositories != null) {
        body.allows_public_repositories = Boolean(allowsPublicRepositories);
      }
      if (restrictedToWorkflows != null) {
        body.restricted_to_workflows = Boolean(restrictedToWorkflows);
      }
      if (Array.isArray(selectedWorkflows) && selectedWorkflows.length > 0) {
        body.selected_workflows = selectedWorkflows;
      }

      const result = await request(`/orgs/${organization}/actions/runner-groups`, {
        method: 'POST',
        body,
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create runner group'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapRunnerGroupState(result.payload || {});
    },

    async listGitHubOwnedImages({ organization }) {
      const result = await request(`/orgs/${organization}/actions/hosted-runners/images/github-owned`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list GitHub-owned hosted runner images'), result);
      }
      return (result.payload && result.payload.images ? result.payload.images : []);
    },

    async listPartnerImages({ organization }) {
      const result = await request(`/orgs/${organization}/actions/hosted-runners/images/partner`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list partner hosted runner images'), result);
      }
      return (result.payload && result.payload.images ? result.payload.images : []);
    },

    async listMachineSizes({ organization }) {
      const result = await request(`/orgs/${organization}/actions/hosted-runners/machine-sizes`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list hosted runner machine sizes'), result);
      }
      return (result.payload && result.payload.machine_specs ? result.payload.machine_specs : []);
    },
  };
}

module.exports = {
  createGitHubRunnerApi,
  getHeader,
  mapHostedRunnerState,
  mapRunnerGroupState,
};
