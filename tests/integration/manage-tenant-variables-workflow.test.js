'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('manage-tenant-variables workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'manage-tenant-variables.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+manage-tenant-variables/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_VARIABLE_OPERATION/);
  assert.match(workflow, /PARSED_VARIABLES_CSV/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
});

function buildRegistry(workspace) {
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify({
      tenantId: 'contosouk',
      tenantName: 'ContosoUK',
      tenantType: 'application',
      organization: 'octo-org',
      topology: {
        organization: { orgName: 'octo-org' },
        teams: {
          tenantRootTeam: 'contosouk-root',
          structure: [
            { team: 'contosouk-root', parent: null, type: 'root' },
            { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
            { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
          ],
        },
      },
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildValidationEnv(artifactPath, registryDir, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '425',
    REQUESTER_LOGIN: 'tenant-cicd-admin',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_VARIABLE_OPERATION: 'create',
    PARSED_VARIABLE_NAME: 'API_BASE_URL',
    PARSED_VARIABLE_VALUE: 'https://api.contoso.example.com',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Shared endpoint for tenant CI.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26660000001',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildTeamApi(options = {}) {
  const rootMembershipRole = options.rootMembershipRole || 'maintainer';
  const rootMembershipState = options.rootMembershipState || 'active';
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    listOrgTeams: async () => ([
      { slug: 'contosouk-root', parent: null },
      { slug: 'contosouk-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk-root' && username === 'tenant-cicd-admin') {
        return rootMembershipState === 'active'
          ? { state: 'active', membership: { role: rootMembershipRole } }
          : { state: rootMembershipState, membership: null };
      }
      return { state: 'absent', membership: null };
    },
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    addIssueLabels: async () => ([]),
    listIssueLabels: async () => ([]),
    removeIssueLabel: async () => ({}),
    listIssueComments: async () => [],
  };
}

function buildOrgVariablesApi(options = {}) {
  const store = new Map(options.initialVariables || []);
  const calls = { create: [], update: [], delete: [] };
  return {
    calls,
    store,
    listOrganizationVariables: async () => [...store.entries()].map(([name, value]) => ({ name, value, visibility: 'all' })),
    getOrganizationVariable: async ({ name }) => (
      store.has(name)
        ? { exists: true, variable: { name, value: store.get(name), visibility: 'all' } }
        : { exists: false, variable: null }
    ),
    createOrganizationVariable: async ({ name, value }) => {
      calls.create.push(`${name}=${value}`);
      store.set(name, value);
      return { created: true, name };
    },
    updateOrganizationVariable: async ({ name, value }) => {
      calls.update.push(`${name}=${value}`);
      store.set(name, value);
      return { updated: true, name };
    },
    deleteOrganizationVariable: async ({ name }) => {
      calls.delete.push(name);
      const existed = store.delete(name);
      return { deleted: existed, not_found: !existed };
    },
  };
}

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi, orgVariablesApi }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: teamApi,
    orgVariablesApi,
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 2401,
          body: 'approved',
          created_at: '2026-06-05T12:00:00Z',
          user: { login: 'org-owner-user' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });
}

const PAT_TOKEN_INFO = {
  token: 'pat-token',
  source: 'ISSUEOPS_GITHUB_TOKEN',
  token_kind: 'pat',
  is_pat_backed: true,
  supports_org_mutation: true,
};

test('US1 validation records the tenant variable operation and prefixed name', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-variables-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    orgVariablesApi: buildOrgVariablesApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'tenant_variable_management');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.variable_operation, 'create');
  assert.equal(artifact.request.variable_entries[0].name, 'CONTOSOUK_API_BASE_URL');
});

test('US3 happy path creates the tenant-prefixed organization variable', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-variables-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const orgVariablesApi = buildOrgVariablesApi();

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi(), orgVariablesApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26660000002',
      GITHUB_RUN_ATTEMPT: '2',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi: buildTeamApi(),
    orgVariablesApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.mutation_count, 1);
  assert.deepEqual(orgVariablesApi.calls.create, ['CONTOSOUK_API_BASE_URL=https://api.contoso.example.com']);
});

test('US3 already-satisfied variable converges as a no-op', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-variables-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const orgVariablesApi = buildOrgVariablesApi({
    initialVariables: [['CONTOSOUK_API_BASE_URL', 'https://api.contoso.example.com']],
  });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi(), orgVariablesApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26660000003',
      GITHUB_RUN_ATTEMPT: '3',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi: buildTeamApi(),
    orgVariablesApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 0);
  assert.equal(result.execution.noop_count, 1);
  assert.deepEqual(orgVariablesApi.calls.create, []);
});

test('US3 fails closed when the requester loses tenant top-team maintainership', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-variables-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const orgVariablesApi = buildOrgVariablesApi();

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi(), orgVariablesApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26660000004',
      GITHUB_RUN_ATTEMPT: '4',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi: buildTeamApi({ rootMembershipRole: 'member' }),
    orgVariablesApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
  assert.deepEqual(orgVariablesApi.calls.create, []);
});
