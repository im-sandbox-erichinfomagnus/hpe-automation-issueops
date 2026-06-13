'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
    setProcessExitCode: false,
  });

  const registryPath = path.join(registryDirectory, 'fabrikam.json');
  const registryRecord = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const repoAdminTeam = state.teams.find((team) => team.slug === 'fabrikam_repoadmins');

  assert.equal(result.request.request_id, 'im-sandbox-himanshu/issueops-speckit#207/26559705713.1');
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.assignment.assignment_status, 'assigned');
  assert.equal(result.assignment.assigned_login, 'aeruvakalpanaa');
  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.validation.is_valid, true);
  assert.equal(result.reconciliation.teams_to_create.length, 2);
  assert.equal(result.reconciliation.teams_already_present.length, 0);
  assert.equal(result.reconciliation.child_links_to_apply.length, 0);
  assert.equal(result.reconciliation.requester_bootstrap_action, 'ensure_maintainer');
  assert.equal(result.reconciliation.registry_persistence_action, 'write');
  assert.equal(result.reconciliation.registry_persistence_result.status, 'created');
  assert.equal(result.execution.mutation_count, 4);
  assert.equal(result.execution.noop_count, 0);
  assert.equal(result.execution.pending_count, 0);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.rollback_status, 'not_needed');
  assert.equal(fs.existsSync(registryPath), true);
  assert.equal(state.teams.length, 2);
  assert.equal(state.memberships.length, 1);
  assert.equal(state.memberships[0].teamSlug, 'fabrikam_tenant');
  assert.equal(state.memberships[0].username, 'himanshu-im');
  assert.equal(state.memberships[0].role, 'maintainer');
  assert.equal(repoAdminTeam.parent.slug, 'fabrikam_tenant');
  assert.equal(registryRecord.tenant_key, 'fabrikam');
  assert.equal(registryRecord.tenant_team_slug, 'fabrikam_tenant');
  assert.equal(registryRecord.repo_admin_team_slug, 'fabrikam_repoadmins');
  assert.equal(registryRecord.requester_login, 'himanshu-im');
  assert.equal(registryRecord.approver_login, 'himanshu-im');
  assert.match(result.execution.summary, /Approved tenant bootstrap execution completed\./i);
  assert.match(result.execution.summary, /Processed 4 tenant_bootstrap\(ies\)/i);
  assert.match(result.execution.summary, /authenticated creator a team maintainer/i);
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
    setProcessExitCode: false,
  });

  assert.equal(rerun.request.request_status, 'executed');
  assert.equal(rerun.reconciliation.teams_to_create.length, 0);
  assert.equal(rerun.reconciliation.teams_already_present.length, 2);
  assert.equal(rerun.reconciliation.child_links_to_apply.length, 0);
  assert.equal(rerun.reconciliation.child_links_already_present.length, 1);
  assert.equal(rerun.reconciliation.requester_bootstrap_action, 'noop');
  assert.equal(rerun.reconciliation.registry_persistence_result.status, 'unchanged');
  assert.equal(rerun.reconciliation.registry_commit_result.status, 'noop');
  assert.equal(rerun.execution.mutation_count, 0);
  assert.equal(rerun.execution.noop_count, 4);
  assert.equal(rerun.execution.failure_count, 0);
  assert.equal(rerun.execution.rollback_status, 'not_needed');
  assert.equal(state.teams.length, 2);
  assert.equal(state.memberships.length, 1);
  assert.equal(fs.readFileSync(registryPath, 'utf8'), registryAfterFirstRun);
  assert.match(rerun.execution.summary, /Request is already satisfied\./i);
  assert.match(rerun.execution.summary, /Additional approval comments do not trigger a new tenant bootstrap mutation run\./i);
  assert.match(rerun.execution.summary, /Processed 0 tenant_bootstrap\(ies\), 4 no-op tenant_bootstrap\(ies\)/i);
});

test('runApprovedExecution for create-tenant-model promotes requester from member to maintainer', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-promote-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDirectory = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDirectory, { recursive: true });

  const state = {
    nextTeamId: 3000,
    teams: [
      { id: 3000, name: 'Litware_Tenant', slug: 'litware_tenant', parent: null },
      {
        id: 3001,
        name: 'Litware_RepoAdmins',
        slug: 'litware_repoadmins',
        parent: { id: 3000, slug: 'litware_tenant' },
      },
    ],
    memberships: [
      { teamSlug: 'litware_tenant', username: 'himanshu-im', role: 'member' },
    ],
  };

  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '209',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_ORGANIZATION: 'im-sandbox-himanshu',
      PARSED_TENANT_NAME: 'Litware',
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.reconciliation.teams_to_create.length, 0);
  assert.equal(result.reconciliation.teams_already_present.length, 2);
  assert.equal(result.reconciliation.child_links_already_present.length, 1);
  assert.equal(result.reconciliation.requester_bootstrap_action, 'ensure_maintainer');
  assert.equal(result.execution.mutation_count, 1);
  assert.equal(result.execution.noop_count, 3);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(state.memberships.length, 1);
  assert.equal(state.memberships[0].role, 'maintainer');
  assert.match(result.execution.summary, /Processed 1 tenant_bootstrap\(ies\), 3 no-op tenant_bootstrap\(ies\)/i);
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(result.reconciliation.registry_persistence_result.status, 'blocked_missing_directory');
  assert.equal(result.execution.mutation_count, 4);
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
        { id: 5000, name: 'Adventure_Works_Tenant', slug: 'adventure_works_tenant', parent: null },
        { id: 5001, name: 'Shared Parent', slug: 'shared-parent', parent: null },
        {
          id: 5002,
          name: 'Adventure_Works_RepoAdmins',
          slug: 'adventure_works_repoadmins',
          parent: { id: 5001, slug: 'shared-parent' },
        },
      ],
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.requested_teams.every((team) => team.validation_status === 'existing'), true);
  assert.equal(result.validation.requested_child_links.length, 1);
  assert.equal(result.validation.requested_child_links[0].validation_status, 'reparent_blocked');
  assert.equal(result.validation.requested_child_links[0].desired_action, 'reject');
  assert.equal(result.validation.requested_child_links[0].current_parent_slug, 'shared-parent');
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
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
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_hierarchy_mutation: true,
    },
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
