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

function isTeamSyncBlocked(response, payload) {
  if (!response || response.status !== 403) {
    return false;
  }

  const message = String(payload && payload.message ? payload.message : '').toLowerCase();
  return message.includes('synchronization') || message.includes('sync');
}

function mapMemberState(member) {
  return {
    username: member.login.toLowerCase(),
    role: member.role || 'member',
    state: member.state || 'active',
  };
}

function mapTeamState(team) {
  return {
    id: team.id || null,
    name: team.name || '',
    slug: String(team.slug || '').toLowerCase(),
    privacy: team.privacy || 'closed',
    parent:
      team.parent && team.parent.slug
        ? {
            id: team.parent.id || null,
            name: team.parent.name || '',
            slug: String(team.parent.slug || '').toLowerCase(),
          }
        : null,
  };
}

function mapOrganizationRoleState(role) {
  return {
    id: role.id || null,
    name: String(role.name || '').trim(),
    description: role.description || null,
  };
}

function mapCustomRepositoryRoleState(role) {
  return {
    id: role.id || null,
    name: String(role.name || '').trim(),
    description: role.description || null,
    base_role: role.base_role || null,
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
  };
}

function createGitHubTeamApi(options = {}) {
  const token = options.token;
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';

  if (!token) {
    throw new Error('GitHub team API requires a workflow token');
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
      team_sync_blocked: isTeamSyncBlocked(response, payload),
    };
  }

  return {
    async getIssue({ repository, issueNumber }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load issue context'), result);
      }
      return result.payload;
    },

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

    async listIssueEvents({ repository, issueNumber }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/events?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list issue events'), result);
      }
      return result.payload || [];
    },

    async listIssueComments({ repository, issueNumber }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list issue comments'), result);
      }
      return result.payload || [];
    },

    async getAssignableOwners({ repository }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/assignees?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list assignable users'), result);
      }
      return (result.payload || []).map((assignee) => String(assignee.login || '').toLowerCase()).filter(Boolean);
    },

    async addIssueAssignees({ repository, issueNumber, assignees }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, {
        method: 'POST',
        body: { assignees },
      });
      if (!result.ok) {
        throw Object.assign(new Error('Failed to add issue assignees'), result);
      }
      return {
        status: 'assigned',
        assignees: (result.payload && result.payload.assignees
          ? result.payload.assignees.map((entry) => String(entry.login || '').toLowerCase())
          : assignees),
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

    async listIssueLabels({ repository, issueNumber }) {
      const [owner, repo] = String(repository || '').split('/');
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/labels?per_page=100`);

      if (!result.ok) {
        throw Object.assign(new Error('Failed to list issue labels'), result);
      }

      return (result.payload || []).map((label) => String(label.name || '').toLowerCase()).filter(Boolean);
    },

    async removeIssueLabel({ repository, issueNumber, label }) {
      const [owner, repo] = String(repository || '').split('/');
      const encodedLabel = encodeURIComponent(String(label || ''));
      const result = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodedLabel}`, {
        method: 'DELETE',
      });

      if (!result.ok && result.status !== 404) {
        throw Object.assign(new Error('Failed to remove issue label'), result);
      }

      return { removed: result.status !== 404, label: String(label || '').toLowerCase() };
    },

    async getTeamBySlug({ organization, teamSlug }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}`);
      if (result.status === 404) {
        return { exists: false, team: null, team_sync_blocked: false };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to load team by slug'), result);
      }
      return { exists: true, team: result.payload, team_sync_blocked: result.team_sync_blocked };
    },

    async getOrganizationMembership({ organization, username }) {
      const result = await request(`/orgs/${organization}/memberships/${username}`);
      if (result.status === 404) {
        return { exists: false, membership: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to inspect organization membership'), result);
      }
      return {
        exists: true,
        membership: result.payload,
      };
    },

    async listOrgTeams({ organization }) {
      const result = await request(`/orgs/${organization}/teams?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list organization teams'), result);
      }
      return (result.payload || []).map(mapTeamState);
    },

    async listTeamMembers({ organization, teamSlug }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}/members?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list team members'), result);
      }
      return (result.payload || []).map(mapMemberState);
    },

    async listTeamMaintainers({ organization, teamSlug }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}/members?role=maintainer&per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list team maintainers'), result);
      }
      return (result.payload || []).map(mapMemberState);
    },

    async getMembershipForUser({ organization, teamSlug, username }) {
      const result = await request(
        `/orgs/${organization}/teams/${teamSlug}/memberships/${username}`
      );
      if (result.status === 404) {
        return { state: 'absent', membership: null };
      }
      if (!result.ok) {
        throw Object.assign(new Error('Failed to inspect team membership'), result);
      }
      return {
        state: result.payload.state || 'active',
        membership: result.payload,
      };
    },

    async addOrUpdateTeamMembership({ organization, teamSlug, username, role = 'member' }) {
      const result = await request(
        `/orgs/${organization}/teams/${teamSlug}/memberships/${username}`,
        {
          method: 'PUT',
          body: { role },
        }
      );

      if (!result.ok) {
        throw Object.assign(new Error('Failed to add team membership'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
          team_sync_blocked: result.team_sync_blocked,
        });
      }

      return {
        username,
        state: result.payload.state || 'active',
        role: result.payload.role || role,
        membership: result.payload,
      };
    },

    async removeTeamMembership({ organization, teamSlug, username }) {
      const result = await request(
        `/orgs/${organization}/teams/${teamSlug}/memberships/${username}`,
        {
          method: 'DELETE',
        }
      );

      if (!result.ok && result.status !== 404) {
        throw Object.assign(new Error('Failed to remove team membership'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
          team_sync_blocked: result.team_sync_blocked,
        });
      }

      return {
        username,
        removed: result.status !== 404,
      };
    },

    async createTeam({ organization, name, privacy = 'closed' }) {
      const result = await request(`/orgs/${organization}/teams`, {
        method: 'POST',
        body: {
          name,
          privacy,
        },
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create team'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapTeamState(result.payload || {});
    },

    async listChildTeams({ organization, teamSlug }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}/teams?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list child teams'), result);
      }
      return (result.payload || []).map(mapTeamState);
    },

    async updateTeamParent({ organization, teamSlug, parentTeamId }) {
      const result = await request(`/orgs/${organization}/teams/${teamSlug}`, {
        method: 'PATCH',
        body: {
          parent_team_id: parentTeamId,
        },
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to update team parent'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapTeamState(result.payload || {});
    },

    async listOrganizationRoles({ organization }) {
      const result = await request(`/orgs/${organization}/organization-roles?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list organization roles'), result);
      }
      return (result.payload || []).map(mapOrganizationRoleState);
    },

    async createOrganizationRole({ organization, name, description = null, permissions = null }) {
      const body = {
        name,
      };

      if (description != null && String(description).trim() !== '') {
        body.description = description;
      }

      if (Array.isArray(permissions) && permissions.length > 0) {
        body.permissions = permissions;
      }

      const result = await request(`/orgs/${organization}/organization-roles`, {
        method: 'POST',
        body,
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create organization role'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapOrganizationRoleState(result.payload || {});
    },

    async assignTeamOrganizationRole({ organization, teamSlug, roleId }) {
      const result = await request(`/orgs/${organization}/organization-roles/teams/${teamSlug}/${roleId}`, {
        method: 'PUT',
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to assign organization role to team'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return {
        team_slug: String(teamSlug || '').toLowerCase(),
        role_id: roleId,
      };
    },

    async listCustomRepositoryRoles({ organization }) {
      const result = await request(`/orgs/${organization}/custom-repository-roles?per_page=100`);
      if (!result.ok) {
        throw Object.assign(new Error('Failed to list custom repository roles'), result);
      }

      const roles = result.payload && Array.isArray(result.payload.custom_roles)
        ? result.payload.custom_roles
        : Array.isArray(result.payload)
          ? result.payload
          : [];
      return roles.map(mapCustomRepositoryRoleState);
    },

    async createCustomRepositoryRole({ organization, name, description = null, base_role = 'read', permissions = [] }) {
      const body = {
        name,
        base_role,
        permissions: Array.isArray(permissions) ? permissions : [],
      };

      if (description != null && String(description).trim() !== '') {
        body.description = description;
      }

      const result = await request(`/orgs/${organization}/custom-repository-roles`, {
        method: 'POST',
        body,
      });

      if (!result.ok) {
        throw Object.assign(new Error('Failed to create custom repository role'), result, {
          retry_after: getHeader(result.headers, 'retry-after'),
        });
      }

      return mapCustomRepositoryRoleState(result.payload || {});
    },
  };
}

module.exports = {
  createGitHubTeamApi,
  getHeader,
  isTeamSyncBlocked,
};