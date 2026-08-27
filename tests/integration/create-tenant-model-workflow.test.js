'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

const PAT_TOKEN_INFO = {
  token: 'pat-token',
  source: 'ISSUEOPS_GITHUB_TOKEN',
  token_kind: 'pat',
  is_pat_backed: true,
  supports_team_hierarchy_mutation: true,
  supports_org_mutation: true,
};

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 100);
}

function buildExecutionApi(state) {
  return {
    async listOrgTeams() {
      return state.teams.map((team) => ({
        ...team,
        parent: team.parent ? { ...team.parent } : null,
      }));
    },
    async createTeam({ name }) {
      const team = {
        id: state.nextTeamId++,
        name,
        slug: normalizeSlug(name),
        parent: null,
      };
      state.teams.push(team);
      return team;
    },
    async updateTeamParent({ teamSlug, parentTeamId }) {
      const childTeam = state.teams.find((team) => team.slug === teamSlug);
      const parentTeam = state.teams.find((team) => team.id === parentTeamId);
      childTeam.parent = {
        id: parentTeam.id,
        slug: parentTeam.slug,
      };
      return childTeam;
    },
    async addOrUpdateTeamMembership({ teamSlug, username, role }) {
      const existingMembership = state.memberships.find((membership) =>
        membership.teamSlug === teamSlug && membership.username === username
      );
      if (existingMembership) {
        existingMembership.role = role;
      } else {
        state.memberships.push({ teamSlug, username, role });
      }
      return {
        state: 'active',
        role,
      };
    },
    async removeTeamMembership({ teamSlug, username }) {
      const before = state.memberships.length;
      state.memberships = state.memberships.filter((membership) =>
        !(membership.teamSlug === teamSlug && membership.username === username)
      );
      return {
        username,
        removed: state.memberships.length !== before,
      };
    },
    async getMembershipForUser({ teamSlug, username }) {
      const membership = state.memberships.find((entry) =>
        entry.teamSlug === teamSlug && entry.username === username
      );
      if (!membership) {
        return {
          state: 'absent',
          membership: null,
        };
      }

      return {
        state: 'active',
        membership: {
          state: 'active',
          role: membership.role,
        },
      };
    },
  };
}

test('runApprovedExecution for create-tenant-model completes full tenant bootstrap and persists registry record', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-workflow-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1000,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '207',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Fabrikam',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Fabrikam tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705713',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 301,
          body: 'approved',
          created_at: '2026-05-28T10:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705713',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  const registryPath = path.join(registryDirectory, 'fabrikam.json');
  const registryRecord = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const repoAdminTeam = state.teams.find((team) => team.slug === 'fabrikam-repo-admin');

  assert.equal(result.request.request_id, 'im-sandbox-himanshu/issueops-speckit#207/26559705713.1');
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.assignment.assignment_status, 'assigned');
  assert.equal(result.assignment.assigned_login, 'aeruvakalpanaa');
  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.validation.is_valid, true);
  assert.equal(result.reconciliation.teams_to_create.length, 4);
  assert.equal(result.reconciliation.teams_already_present.length, 0);
  assert.equal(result.reconciliation.child_links_to_apply.length, 0);
  assert.equal(result.reconciliation.cicd_admin_team_requested, true);
  assert.equal(result.reconciliation.requester_bootstrap_action, 'ensure_maintainer');
  assert.equal(result.reconciliation.registry_persistence_action, 'write');
  assert.equal(result.reconciliation.registry_persistence_result.status, 'created');
  assert.equal(result.execution.mutation_count, 11);
  assert.equal(result.execution.noop_count, 4);
  assert.equal(result.execution.pending_count, 0);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.rollback_status, 'not_needed');
  assert.equal(fs.existsSync(registryPath), true);
  assert.equal(state.teams.length, 4);
  assert.equal(state.memberships.length, 4);
  assert.deepEqual(
    state.memberships.map((membership) => membership.teamSlug).sort(),
    ['fabrikam-admin', 'fabrikam-cicd-admin', 'fabrikam-repo-admin', 'fabrikam-root']
  );
  assert.equal(state.memberships.every((membership) => membership.username === 'himanshu-im'), true);
  assert.equal(state.memberships.every((membership) => membership.role === 'maintainer'), true);
  assert.equal(repoAdminTeam.parent.slug, 'fabrikam-root');
  assert.equal(registryRecord.tenant_key, 'fabrikam');
  assert.equal(registryRecord.tenant_team_slug, 'fabrikam-root');
  assert.equal(registryRecord.repo_admin_team_slug, 'fabrikam-repo-admin');
  assert.equal(registryRecord.cicd_admin_team_slug, 'fabrikam-cicd-admin');
  assert.equal(registryRecord.requester_login, 'himanshu-im');
  assert.equal(registryRecord.approver_login, 'himanshu-im');
  assert.match(result.execution.summary, /Approved tenant bootstrap execution completed\./i);
  assert.match(result.execution.summary, /Processed 11 tenant_bootstrap\(ies\), 4 no-op tenant_bootstrap\(ies\)/i);
  assert.match(result.execution.summary, /authenticated creator a team maintainer/i);
});

test('runApprovedExecution for create-tenant-model provisions canonical organization roles when API supports it', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-org-roles-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1800,
    teams: [],
    memberships: [],
    nextRoleId: 500,
    organizationRoles: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '350',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Roleful Tenant',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-350',
      PARSED_COST_CENTER: 'CC-350',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Provision org roles',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559707000',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 400,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559707000',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => state.organizationRoles,
      createOrganizationRole: async ({ name, description }) => {
        const role = {
          id: state.nextRoleId++,
          name,
          description,
        };
        state.organizationRoles.push(role);
        return role;
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(state.organizationRoles.length, 4);
  assert.deepEqual(
    state.organizationRoles.map((role) => role.name),
    [
      'roleful-tenant-tenant-admin',
      'roleful-tenant-repo-admin',
      'roleful-tenant-developer',
      'roleful-tenant-viewer',
    ]
  );
  assert.equal(result.reconciliation.organization_roles_to_create.length, 4);
  assert.equal(result.reconciliation.organization_roles_failed.length, 0);
  assert.equal(result.execution.mutation_count, 15);
  assert.match(result.execution.summary, /Processed 15 tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model skips org-role provisioning when endpoint is unavailable', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-org-roles-unavailable-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1800,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '351',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Unavailable Role Tenant',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-351',
      PARSED_COST_CENTER: 'CC-351',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Org role endpoint unavailable',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559707001',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 401,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559707001',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => {
        const error = new Error('Failed to list organization roles');
        error.status = 404;
        error.payload = { message: 'Not Found' };
        throw error;
      },
      createOrganizationRole: async () => {
        throw new Error('createOrganizationRole should not be called when list endpoint is unavailable');
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.reconciliation.organization_roles_failed.length, 0);
  assert.equal(result.reconciliation.organization_roles_skipped.length, 4);
  assert.ok(result.reconciliation.organization_roles_skipped.every((entry) => entry.skip_reason === 'organization_role_provisioning_skipped_http_404'));
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.mutation_count, 11);
  assert.equal(result.execution.noop_count, 4);
  assert.match(result.execution.summary, /processed 11 tenant_bootstrap\(ies\), 4 no-op tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model skips org-role provisioning on generic role API failures', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-org-roles-generic-failure-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1900,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '352',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Generic Failure Role Tenant',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-352',
      PARSED_COST_CENTER: 'CC-352',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Org role endpoint returns generic 403',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559707002',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 402,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559707002',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => {
        const error = new Error('Failed to list organization roles');
        error.status = 403;
        error.payload = { message: 'Forbidden' };
        throw error;
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.reconciliation.organization_roles_failed.length, 0);
  assert.equal(result.reconciliation.organization_roles_skipped.length, 4);
  assert.ok(result.reconciliation.organization_roles_skipped.every((entry) => entry.skip_reason === 'organization_role_provisioning_skipped_http_403'));
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.mutation_count, 11);
  assert.equal(result.execution.noop_count, 4);
  assert.match(result.execution.summary, /processed 11 tenant_bootstrap\(ies\), 4 no-op tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model falls back to custom repository role APIs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-org-roles-fallback-custom-repo-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1950,
    teams: [],
    memberships: [],
    nextRoleId: 900,
    customRepositoryRoles: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '353',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Fallback Role Tenant',
      PARSED_TENANT_TYPE: 'platform',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-353',
      PARSED_COST_CENTER: 'CC-353',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'prod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Fallback to custom repository role API',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559707003',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 403,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559707003',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => {
        const error = new Error('Failed to list organization roles');
        error.status = 404;
        error.payload = { message: 'Not Found' };
        throw error;
      },
      listCustomRepositoryRoles: async () => state.customRepositoryRoles,
      createCustomRepositoryRole: async ({ name, description, base_role, permissions }) => {
        const role = {
          id: state.nextRoleId++,
          name,
          description,
          base_role,
          permissions,
        };
        state.customRepositoryRoles.push(role);
        return role;
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(state.customRepositoryRoles.length, 4);
  assert.equal(result.reconciliation.organization_roles_to_create.length, 4);
  assert.equal(result.reconciliation.organization_roles_failed.length, 0);
  assert.equal(result.reconciliation.organization_roles_skipped.length, 0);
  assert.ok(result.reconciliation.organization_roles_to_create.every((entry) => entry.role_api_provider === 'custom_repository_role'));
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.mutation_count, 15);
  assert.match(result.execution.summary, /Processed 15 tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model persists canonical topology-first record fields', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-canonical-record-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1200,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '216',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Canonical Corp',
      PARSED_TENANT_TYPE: 'platform',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-216',
      PARSED_COST_CENTER: 'CC-216',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'prod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'US1 canonical record persistence',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705800',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 305,
          body: 'approved',
          created_at: '2026-05-28T10:20:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705800',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  const registryPath = path.join(registryDirectory, 'canonical-corp.json');
  const registryRecord = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  assert.equal(registryRecord.tenantId, 'canonical-corp');
  assert.equal(registryRecord.tenantName, 'Canonical Corp');
  assert.equal(registryRecord.tenantType, 'platform');
  assert.equal(registryRecord.topology.organization.orgName, 'im-sandbox-himanshu');
  assert.equal(registryRecord.topology.teams.tenantRootTeam, 'canonical-corp-root');
  assert.equal(Array.isArray(registryRecord.topology.repositories.owned), true);
  assert.equal(Array.isArray(registryRecord.topology.runnerTopology.runnerGroups), true);
  assert.equal(registryRecord.externalMappings.environment, 'prod');
  assert.equal(registryRecord.metadata.primaryContact, 'owner@example.com');
});

test('runApprovedExecution for create-tenant-model applies normalized tenant terminal status label', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-label-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 1500,
    teams: [],
    memberships: [],
  };

  const appliedLabels = [];

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '211',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Northwind',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Northwind tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705799',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 321,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705799',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      addIssueLabels: async ({ labels }) => {
        appliedLabels.push(...labels);
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.ok(appliedLabels.includes('issueops:create-tenant:executed'));
});

test('runApprovedExecution for create-tenant-model rerun stays idempotent for converged tenant state', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-rerun-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 2000,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '208',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Contoso',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Contoso tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705714',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 302,
          body: 'approved',
          created_at: '2026-05-28T10:05:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705714',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  const registryPath = path.join(registryDirectory, 'contoso.json');
  const registryAfterFirstRun = fs.readFileSync(registryPath, 'utf8');

  const rerun = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705715',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(rerun.request.request_status, 'executed');
  assert.equal(rerun.reconciliation.teams_to_create.length, 0);
  assert.equal(rerun.reconciliation.teams_already_present.length, 4);
  assert.equal(rerun.reconciliation.child_links_to_apply.length, 0);
  assert.equal(rerun.reconciliation.child_links_already_present.length, 3);
  assert.equal(rerun.reconciliation.requester_bootstrap_action, 'noop');
  assert.equal(rerun.reconciliation.registry_persistence_result.status, 'unchanged');
  assert.equal(rerun.reconciliation.registry_commit_result.status, 'noop');
  assert.equal(rerun.execution.mutation_count, 0);
  assert.equal(rerun.execution.noop_count, 15);
  assert.equal(rerun.execution.failure_count, 0);
  assert.equal(rerun.execution.rollback_status, 'not_needed');
  assert.equal(state.teams.length, 4);
  assert.equal(state.teams.filter((team) => team.slug === 'contoso-cicd-admin').length, 1);
  assert.equal(state.memberships.length, 4);
  assert.equal(fs.readFileSync(registryPath, 'utf8'), registryAfterFirstRun);
  assert.match(rerun.execution.summary, /Request is already satisfied\./i);
  assert.match(rerun.execution.summary, /Additional approval comments do not trigger a new tenant bootstrap mutation run\./i);
  assert.match(rerun.execution.summary, /Processed 0 tenant_bootstrap\(ies\), 15 no-op tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model assigns tenant admin as maintainer on every tenant team', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-promote-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 3000,
    teams: [
      { id: 3000, name: 'litware-root', slug: 'litware-root', parent: null },
      {
        id: 3001,
        name: 'litware-admin',
        slug: 'litware-admin',
        parent: { id: 3000, slug: 'litware-root' },
      },
      {
        id: 3002,
        name: 'litware-repo-admin',
        slug: 'litware-repo-admin',
        parent: { id: 3000, slug: 'litware-root' },
      },
      {
        id: 3003,
        name: 'litware-cicd-admin',
        slug: 'litware-cicd-admin',
        parent: { id: 3000, slug: 'litware-root' },
      },
    ],
    memberships: [
      { teamSlug: 'litware-root', username: 'himanshu-im', role: 'member' },
    ],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '209',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Litware',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Litware tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705716',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => state.teams,
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 303,
          body: 'approved',
          created_at: '2026-05-28T10:10:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705716',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.reconciliation.teams_to_create.length, 0);
  assert.equal(result.reconciliation.teams_already_present.length, 4);
  assert.equal(result.reconciliation.child_links_already_present.length, 3);
  assert.equal(result.reconciliation.requester_bootstrap_action, 'ensure_maintainer');
  assert.equal(result.execution.mutation_count, 4);
  assert.equal(result.execution.noop_count, 11);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(state.memberships.length, 4);
  assert.equal(state.memberships.every((membership) => membership.role === 'maintainer'), true);
  assert.match(result.execution.summary, /Processed 4 tenant_bootstrap\(ies\), 11 no-op tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model normalizes requester maintainership when policy is downgrade_to_member', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-requester-normalize-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 3100,
    teams: [
      { id: 3100, name: 'litware-root', slug: 'litware-root', parent: null },
      {
        id: 3101,
        name: 'litware-admin',
        slug: 'litware-admin',
        parent: { id: 3100, slug: 'litware-root' },
      },
      {
        id: 3102,
        name: 'litware-repo-admin',
        slug: 'litware-repo-admin',
        parent: { id: 3100, slug: 'litware-root' },
      },
      {
        id: 3103,
        name: 'litware-cicd-admin',
        slug: 'litware-cicd-admin',
        parent: { id: 3100, slug: 'litware-root' },
      },
    ],
    memberships: [
      { teamSlug: 'litware-root', username: 'himanshu-im', role: 'maintainer' },
      { teamSlug: 'litware-admin', username: 'himanshu-im', role: 'maintainer' },
      { teamSlug: 'litware-repo-admin', username: 'himanshu-im', role: 'maintainer' },
      { teamSlug: 'litware-cicd-admin', username: 'himanshu-im', role: 'maintainer' },
    ],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '219',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Litware',
      PARSED_TENANT_TYPE: 'application',
      PARSED_TENANT_ADMIN_LOGIN: 'erich-infomagnus',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Litware tenant with explicit admin',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705720',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => state.teams,
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 304,
          body: 'approved',
          created_at: '2026-05-28T10:15:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705720',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
      TENANT_BOOTSTRAP_REQUESTER_POLICY: 'member',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  const registryPath = path.join(registryDirectory, 'litware.json');
  const registryRecord = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const tenantAdminMemberships = state.memberships.filter((entry) => entry.username === 'erich-infomagnus');
  const requesterMemberships = state.memberships.filter((entry) => entry.username === 'himanshu-im');

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.reconciliation.tenant_admin_intended_login, 'erich-infomagnus');
  assert.equal(result.reconciliation.requester_maintainer_normalization_policy, 'downgrade_to_member');
  assert.equal(registryRecord.bootstrap_tenant_admin_login, 'erich-infomagnus');
  assert.equal(tenantAdminMemberships.length, 4);
  assert.equal(tenantAdminMemberships.every((membership) => membership.role === 'maintainer'), true);
  assert.equal(requesterMemberships.length, 4);
  assert.equal(requesterMemberships.every((membership) => membership.role === 'member'), true);
  assert.match(result.execution.summary, /Intended tenant admin: erich-infomagnus\./i);
  assert.match(result.execution.summary, /Final maintainer list action taken:/i);
});

test('runApprovedExecution for create-tenant-model reports partial execution when durable registry persistence fails', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-registry-failure-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const missingRegistryDirectory = path.join(workspace, 'missing-tenant-registry');

  const state = {
    nextTeamId: 4000,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '210',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Northwind',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Northwind tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705717',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 304,
          body: 'approved',
          created_at: '2026-05-28T10:15:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705717',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: missingRegistryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(result.reconciliation.registry_persistence_result.status, 'blocked_missing_directory');
  assert.equal(result.execution.mutation_count, 11);
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.equal(fs.existsSync(missingRegistryDirectory), false);
  assert.equal(fs.existsSync(result.reconciliation.registry_persistence_result.fallback_artifact_path), true);
  assert.match(result.execution.summary, /completed with partial failure/i);
  assert.match(result.execution.summary, /registry_directory_missing/i);
});

test('runRequestValidation for create-tenant-model blocks re-parenting an existing repo-admin team', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-reparent-blocked-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '211',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Adventure Works',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Adventure Works tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705718',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [
        { id: 5000, name: 'adventure-works-root', slug: 'adventure-works-root', parent: null },
        { id: 5003, name: 'adventure-works-admin', slug: 'adventure-works-admin', parent: { id: 5000, slug: 'adventure-works-root' } },
        { id: 5004, name: 'adventure-works-cicd-admin', slug: 'adventure-works-cicd-admin', parent: { id: 5000, slug: 'adventure-works-root' } },
        { id: 5001, name: 'Shared Parent', slug: 'shared-parent', parent: null },
        {
          id: 5002,
          name: 'adventure-works-repo-admin',
          slug: 'adventure-works-repo-admin',
          parent: { id: 5001, slug: 'shared-parent' },
        },
      ],
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.requested_teams.every((team) => team.validation_status === 'existing'), true);
  assert.equal(result.validation.requested_child_links.length, 3);
  const blockedLink = result.validation.requested_child_links.find((entry) => entry.child_team_slug === 'adventure-works-repo-admin');
  assert.equal(Boolean(blockedLink), true);
  assert.equal(blockedLink.validation_status, 'reparent_blocked');
  assert.equal(blockedLink.desired_action, 'reject');
  assert.equal(blockedLink.current_parent_slug, 'shared-parent');
  assert.match(result.validation.errors.join('\n'), /re-parenting is blocked/i);
});

// T052: Cross-story regression — dry-run approved request produces zero mutations and no registry write
test('runApprovedExecution for create-tenant-model dry-run produces zero mutations and no registry write', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-dryrun-exec-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = { nextTeamId: 6000, teams: [], memberships: [] };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '212',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'DryRunCorp',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Dry run only',
      PARSED_DRY_RUN: 'true',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705720',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 500,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705720',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  // Cross-story assertion: dry-run must produce zero mutations end-to-end
  assert.equal(result.request.dry_run, true);
  assert.equal(result.execution.mutation_count, 0);
  assert.equal(result.execution.failure_count, 0);
  // No teams created in org
  assert.equal(state.teams.length, 0);
  assert.equal(state.memberships.length, 0);
  // No registry file written
  const registryPath = path.join(registryDirectory, 'dryruncorp.json');
  assert.equal(fs.existsSync(registryPath), false);
});

// T052: Cross-story regression — unauthorized approval never unlocks execution
test('runApprovedExecution for create-tenant-model is never reached when approval is denied', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-unauth-exec-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = { nextTeamId: 7000, teams: [], memberships: [] };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '213',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'UnauthorizedCorp',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Test unauthorized approval',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705721',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  // Approval attempt from a non-designated user (not himanshu-im)
  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 501,
          body: 'approved',
          created_at: '2026-05-28T12:10:00Z',
          user: { login: 'random-org-member' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  // Execution is called only when approval-status == 'approved' in the workflow.
  // Here we verify the artifact reflects denied state and execution returns early.
  const executionResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705721',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  // Cross-story assertion: denied approval blocks all mutation
  assert.equal(approvalResult.approval.approval_status, 'denied');
  // Execution returns early without mutating anything
  assert.equal(state.teams.length, 0);
  assert.equal(state.memberships.length, 0);
  const registryPath = path.join(registryDirectory, 'unauthorizedcorp.json');
  assert.equal(fs.existsSync(registryPath), false);
  // Request status must not be 'executed'
  assert.notEqual(executionResult.request.request_status, 'executed');
});

test('runApprovedExecution for create-tenant-model fails closed when tenant-boundary guardrail is violated', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-policy-blocked-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = { nextTeamId: 7100, teams: [], memberships: [] };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '217',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'PolicyBlockedCorp',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-217',
      PARSED_COST_CENTER: 'CC-217',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_JUSTIFICATION: 'US2 policy guard fail-closed',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705810',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 601,
          body: 'approved',
          created_at: '2026-05-28T12:15:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  artifact.request.topology.accessModel.enforcement = 'org-wide';
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705810',
      GITHUB_RUN_ATTEMPT: '2',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.execution.failure_count, 1);
  assert.match(result.execution.summary, /tenant-boundary pre-mutation guardrail failed/i);
  assert.equal(state.teams.length, 0);
  assert.equal(state.memberships.length, 0);
});

test('runApprovedExecution for create-tenant-model migrates legacy registry record to canonical shape and reruns idempotently', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-legacy-migration-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const legacyRecordPath = path.resolve(__dirname, '../fixtures/create-tenant-model/legacy-tenant-record.json');
  const legacyRecord = JSON.parse(fs.readFileSync(legacyRecordPath, 'utf8'));
  fs.writeFileSync(path.join(registryDirectory, 'legacy-corp.json'), `${JSON.stringify(legacyRecord, null, 2)}\n`, 'utf8');

  const state = {
    nextTeamId: 7400,
    teams: [
      { id: 7400, name: 'legacy-corp-root', slug: 'legacy-corp-root', parent: null },
      { id: 7402, name: 'legacy-corp-admin', slug: 'legacy-corp-admin', parent: { id: 7400, slug: 'legacy-corp-root' } },
      {
        id: 7401,
        name: 'legacy-corp-repo-admin',
        slug: 'legacy-corp-repo-admin',
        parent: { id: 7400, slug: 'legacy-corp-root' },
      },
    ],
    memberships: [
      { teamSlug: 'legacy-corp-root', username: 'legacy-requester', role: 'maintainer' },
    ],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '219',
      REQUESTER_LOGIN: 'legacy-requester',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Legacy Corp',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-219',
      PARSED_COST_CENTER: 'CC-219',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'legacy-approver',
      PARSED_JUSTIFICATION: 'US3 legacy migration',
      PARSED_DRY_RUN: 'false',
      PARSED_LEGACY_TENANT_RECORD_JSON: JSON.stringify(legacyRecord),
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705820',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
      listOrgTeams: async () => state.teams,
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 701,
          body: 'approved',
          created_at: '2026-05-28T12:20:00Z',
          user: { login: 'legacy-approver' },
        },
      ],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });

  const firstRun = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705820',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  const migratedRecordPath = path.join(registryDirectory, 'legacy-corp.json');
  const migratedRecord = JSON.parse(fs.readFileSync(migratedRecordPath, 'utf8'));
  assert.equal(firstRun.request.compatibility.mode, 'legacy_projection');
  assert.equal(firstRun.reconciliation.compatibility_mode, 'legacy_projection');
  assert.equal(migratedRecord.tenantId, 'legacy-corp');
  assert.equal(migratedRecord.lifecycleStatus, 'active');

  const secondRun = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705821',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => buildExecutionApi(state),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(secondRun.request.request_status, 'executed');
  assert.equal(secondRun.reconciliation.registry_persistence_result.status, 'unchanged');
  assert.equal(secondRun.execution.mutation_count, 0);
  assert.equal(secondRun.execution.noop_count >= 3, true);
  assert.equal(state.teams.length, 4);
  assert.equal(state.memberships.length, 4);
});

test('runApprovedExecution for create-tenant-model applies CICD capability via primary path when available', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-cicd-primary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 8100,
    teams: [],
    memberships: [],
  };

  const rolesState = {
    nextRoleId: 1,
    roles: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '224',
      REQUESTER_LOGIN: 'capability-requester',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Capability Primary',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-224',
      PARSED_COST_CENTER: 'CC-224',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'capability-approver',
      PARSED_JUSTIFICATION: 'US2 primary capability path',
      PARSED_DRY_RUN: 'false',
      PARSED_CICD_PRIMARY_PATH_AVAILABLE: 'true',
      PARSED_CICD_PRIMARY_POLICY_APPROVED: 'true',
      PARSED_CICD_FALLBACK_PATH_AVAILABLE: 'true',
      PARSED_CICD_FALLBACK_POLICY_APPROVED: 'true',
      PARSED_CICD_TENANT_SCOPE_RESOLVABLE: 'true',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705824',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 901,
          body: 'approved',
          created_at: '2026-05-28T13:20:00Z',
          user: { login: 'capability-approver' },
        },
      ],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705824',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => rolesState.roles,
      createOrganizationRole: async ({ name }) => {
        const role = { id: rolesState.nextRoleId++, name };
        rolesState.roles.push(role);
        return role;
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.execution.cicd_capability_selected_path, 'primary');
  assert.equal(result.execution.cicd_capability_status, 'applied');
  assert.equal(result.reconciliation.cicd_capability_action, 'apply_primary');
  assert.equal(result.reconciliation.organization_roles_to_create.length, 4);
  assert.equal(result.reconciliation.organization_roles_skipped.length, 0);
});

test('runApprovedExecution for create-tenant-model reports unavailable CICD capability and fails closed', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-cicd-unavailable-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 8200,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '225',
      REQUESTER_LOGIN: 'capability-requester',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Capability Unavailable',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-225',
      PARSED_COST_CENTER: 'CC-225',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'capability-approver',
      PARSED_JUSTIFICATION: 'US2 unavailable capability path',
      PARSED_DRY_RUN: 'false',
      PARSED_CICD_PRIMARY_PATH_AVAILABLE: 'false',
      PARSED_CICD_PRIMARY_POLICY_APPROVED: 'false',
      PARSED_CICD_FALLBACK_PATH_AVAILABLE: 'false',
      PARSED_CICD_FALLBACK_POLICY_APPROVED: 'false',
      PARSED_CICD_TENANT_SCOPE_RESOLVABLE: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705825',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 902,
          body: 'approved',
          created_at: '2026-05-28T13:30:00Z',
          user: { login: 'capability-approver' },
        },
      ],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705825',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => {
        throw new Error('should not be called for unavailable capability');
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.execution.cicd_capability_selected_path, 'none');
  assert.equal(result.execution.cicd_capability_status, 'unavailable');
  assert.equal(result.reconciliation.cicd_capability_action, 'unavailable');
  assert.equal(result.reconciliation.organization_roles_to_create.length, 0);
  assert.equal(result.reconciliation.organization_roles_skipped.length, 4);
  assert.equal(result.reconciliation.organization_roles_skipped.every((entry) => String(entry.skip_reason || '').includes('cicd_capability_unavailable')), true);
});

// Phase 5 (US3) Integration Tests

test('T031: runApprovedExecution preserves dry-run semantics without CICD capability mutations', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-us3-dry-run-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 9100,
    teams: [],
    memberships: [],
  };

  const executionCalls = {
    listOrganizationRolesCalls: 0,
    createOrganizationRoleCalls: 0,
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '226',
      REQUESTER_LOGIN: 'dry-run-requester',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Dry Run CICD',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-226',
      PARSED_COST_CENTER: 'CC-226',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'dry-run-approver',
      PARSED_JUSTIFICATION: 'US3 dry-run CICD test',
      PARSED_DRY_RUN: 'true',
      PARSED_CICD_PRIMARY_PATH_AVAILABLE: 'true',
      PARSED_CICD_PRIMARY_POLICY_APPROVED: 'true',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705826',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 903,
          body: 'approved',
          created_at: '2026-05-28T14:00:00Z',
          user: { login: 'dry-run-approver' },
        },
      ],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705826',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => {
        executionCalls.listOrganizationRolesCalls++;
        return [];
      },
      createOrganizationRole: async () => {
        executionCalls.createOrganizationRoleCalls++;
        throw new Error('should not create roles in dry-run mode');
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.equal(result.request.dry_run, true);
  assert.equal(result.execution.mutation_count, 0);
  assert.equal(executionCalls.listOrganizationRolesCalls, 0);
  assert.equal(executionCalls.createOrganizationRoleCalls, 0);
  assert.match(result.execution.summary, /no mutations in dry-run mode|dry-run only/i);
});

test('T031: runApprovedExecution for create-tenant-model skips CICD capability on generic API failures gracefully', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-us3-partial-failure-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 9200,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '227',
      REQUESTER_LOGIN: 'partial-failure-requester',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Partial Failure CICD',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-227',
      PARSED_COST_CENTER: 'CC-227',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'partial-failure-approver',
      PARSED_JUSTIFICATION: 'US3 partial failure CICD test',
      PARSED_DRY_RUN: 'false',
      PARSED_CICD_PRIMARY_PATH_AVAILABLE: 'true',
      PARSED_CICD_PRIMARY_POLICY_APPROVED: 'true',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705827',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 904,
          body: 'approved',
          created_at: '2026-05-28T14:30:00Z',
          user: { login: 'partial-failure-approver' },
        },
      ],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: 'admin',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705827',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      listOrganizationRoles: async () => {
        const error = new Error('API rate limit exceeded');
        error.status = 429;
        throw error;
      },
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  // Should continue with team creation even if CICD capability unavailable
  assert.equal(result.execution.mutation_count, 11);
  assert.equal(result.execution.noop_count, 4);
  assert.equal(result.execution.cicd_capability_status, 'unavailable');
});

test('runApprovedExecution for create-tenant-model links child teams and assigns maintainers when the refreshed listing includes new teams', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-nesting-happy-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });
  const state = {
    nextTeamId: 7000,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '227',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Northwind',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_TENANT_ADMIN_LOGIN: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Northwind tenant with nesting',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705899',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 331,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705899',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      addIssueLabels: async () => {},
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  for (const childSlug of ['northwind-admin', 'northwind-repo-admin', 'northwind-cicd-admin']) {
    const childTeam = state.teams.find((team) => team.slug === childSlug);
    assert.ok(childTeam, `expected child team ${childSlug} to exist`);
    assert.equal(childTeam.parent && childTeam.parent.slug, 'northwind-root');
  }

  const linkedRows = (result.execution.created_teams || []).filter((row) => row.result === 'linked');
  assert.equal(linkedRows.length, 3);

  for (const teamSlug of ['northwind-root', 'northwind-admin', 'northwind-repo-admin', 'northwind-cicd-admin']) {
    assert.ok(
      state.memberships.some((membership) =>
        membership.teamSlug === teamSlug &&
        membership.username === 'himanshu-im' &&
        membership.role === 'maintainer'
      ),
      `expected himanshu-im to be maintainer on ${teamSlug}`
    );
  }

  assert.ok(!String(result.execution.summary || '').includes('not recorded'));
});

test('runApprovedExecution for create-tenant-model links child teams when the refreshed listing lags behind teams created in this run', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-nesting-gap-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });
  const state = {
    nextTeamId: 7100,
    teams: [],
    memberships: [],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '228',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Northwind',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'himanshu-im',
      PARSED_TENANT_ADMIN_LOGIN: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Northwind tenant despite listing lag',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705900',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 332,
          body: 'approved',
          created_at: '2026-05-28T12:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26559705900',
      GITHUB_RUN_ATTEMPT: '1',
      TENANT_REGISTRY_DIR: registryDirectory,
      TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
      TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
    },
    createApi: () => ({
      ...buildExecutionApi(state),
      // Simulates the org-team listing lagging behind teams created in this run (issue #54).
      listOrgTeams: async () => [],
      addIssueLabels: async () => {},
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  for (const childSlug of ['northwind-admin', 'northwind-repo-admin', 'northwind-cicd-admin']) {
    const childTeam = state.teams.find((team) => team.slug === childSlug);
    assert.ok(childTeam, `expected child team ${childSlug} to exist`);
    assert.equal(childTeam.parent && childTeam.parent.slug, 'northwind-root');
  }

  const linkedRows = (result.execution.created_teams || []).filter((row) => row.result === 'linked');
  assert.equal(linkedRows.length, 3);

  for (const teamSlug of ['northwind-root', 'northwind-admin', 'northwind-repo-admin', 'northwind-cicd-admin']) {
    assert.ok(
      state.memberships.some((membership) =>
        membership.teamSlug === teamSlug &&
        membership.username === 'himanshu-im' &&
        membership.role === 'maintainer'
      ),
      `expected himanshu-im to be maintainer on ${teamSlug}`
    );
  }

  assert.ok(!String(result.execution.summary || '').includes('not recorded'));
});

async function buildApprovedTenantCreationArtifact(workspacePrefix) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), workspacePrefix));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '901',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Northwind',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_TENANT_ADMIN_LOGIN: 'himanshu-im',
      PARSED_JUSTIFICATION: 'Bootstrap Northwind tenant',
      PARSED_DRY_RUN: 'false',
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '26559705899',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'repo-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  return { artifactPath, registryDirectory };
}

function buildGuardExecutionEnv(artifactPath, registryDirectory) {
  return {
    AUDIT_ARTIFACT_PATH: artifactPath,
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_RUN_ID: '26559705899',
    GITHUB_RUN_ATTEMPT: '1',
    TENANT_REGISTRY_DIR: registryDirectory,
    TENANT_REGISTRY_PERSISTENCE_MODE: 'repo',
    TENANT_REGISTRY_REQUIRE_DIRECTORY: 'true',
  };
}

test('runApprovedExecution dispatches tenant creation through the self-serve policy with a PAT-backed token', async () => {
  const state = { nextTeamId: 8100, teams: [], memberships: [] };
  const { artifactPath, registryDirectory } = await buildApprovedTenantCreationArtifact('create-tenant-model-guard-allow-');

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(persisted.approval.approver_role, 'tenant_self_serve');

  const result = await runApprovedExecution({
    env: buildGuardExecutionEnv(artifactPath, registryDirectory),
    createApi: () => ({
      ...buildExecutionApi(state),
      addIssueLabels: async () => {},
    }),
    tokenInfo: PAT_TOKEN_INFO,
    setProcessExitCode: false,
  });

  assert.doesNotMatch(String(result.execution.summary || ''), /mutation blocked/i);
  assert.equal(result.execution.mutation_count > 0, true);
});

test('runApprovedExecution blocks tenant creation when the token cannot mutate the organization', async () => {
  const state = { nextTeamId: 8200, teams: [], memberships: [] };
  const { artifactPath, registryDirectory } = await buildApprovedTenantCreationArtifact('create-tenant-model-guard-block-');

  const result = await runApprovedExecution({
    env: buildGuardExecutionEnv(artifactPath, registryDirectory),
    createApi: () => ({
      ...buildExecutionApi(state),
      addIssueLabels: async () => {},
    }),
    tokenInfo: { ...PAT_TOKEN_INFO, supports_org_mutation: false },
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.execution.mutation_count, 0);
  assert.match(
    String(result.execution.summary || ''),
    /Tenant self-serve mutation blocked because the workflow token is not PAT-backed for organization mutation/
  );
});
