'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('create-tenant-runner-groups workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-tenant-runner-groups.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+create-tenant-runner-groups/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_RUNNER_GROUP_NAME/);
  assert.match(workflow, /PARSED_RUNNER_GROUP_VISIBILITY/);
  assert.match(workflow, /PARSED_ALLOWS_PUBLIC_REPOSITORIES/);
  assert.doesNotMatch(workflow, /PARSED_RUNNER_NAME:/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
});

function buildRunnerRegistry(workspace) {
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify({
      tenant_key: 'contosouk',
      tenant_display_name: 'ContosoUK',
      organization: 'octo-org',
      tenant_team_name: 'ContosoUK_Tenant',
      tenant_team_slug: 'contosouk_tenant',
      repo_admin_team_name: 'ContosoUK_RepoAdmins',
      repo_admin_team_slug: 'contosouk_repoadmins',
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildValidationEnv(artifactPath, registryDir, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '355',
    REQUESTER_LOGIN: 'tenant-cicd-admin',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_RUNNER_GROUP_NAME: 'Builders',
    PARSED_RUNNER_GROUP_VISIBILITY: 'selected',
    PARSED_ALLOWS_PUBLIC_REPOSITORIES: 'false',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Tenant runner isolation.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26650000001',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildTeamApi(options = {}) {
  const cicdMembershipState = options.cicdMembershipState || 'active';
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
      { slug: 'contosouk_tenant', parent: null },
      { slug: 'contosouk_repoadmins', parent: { slug: 'contosouk_tenant' } },
      { slug: 'contosouk_cicdadmins', parent: null },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk_cicdadmins' && username === 'tenant-cicd-admin') {
        return cicdMembershipState === 'active'
          ? { state: 'active', membership: { role: 'member' } }
          : { state: cicdMembershipState, membership: null };
      }
      return { state: 'absent', membership: null };
    },
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    addIssueLabels: async () => ([]),
    listIssueComments: async () => [],
  };
}

function buildRunnerApi(options = {}) {
  return {
    listHostedRunners: async () => [],
    listRunnerGroups: async () => options.runnerGroups ?? [
      { id: 1, name: 'Default', default: true, visibility: 'all' },
    ],
    createRunnerGroup: options.createRunnerGroup || (async () => {
      throw new Error('createRunnerGroup mock not configured');
    }),
    createHostedRunner: async () => {
      throw new Error('createHostedRunner should not run for runner-group requests');
    },
    deleteHostedRunner: async () => {
      throw new Error('deleteHostedRunner should not run for runner-group requests');
    },
  };
}

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, runnerApi }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    runnerApi,
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
          id: 2301,
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

test('US1 validation records the runner-group operation and derived name', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-group-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    runnerApi: buildRunnerApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'runner_group_creation');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.runner_group_name_derived, 'ContosoUK_Builders');
  assert.equal(artifact.reconciliation.creation_action, 'create_runner_group');
});

test('US3 happy path creates the runner group with requested visibility', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-group-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  const createCalls = [];

  const runnerApi = buildRunnerApi({
    createRunnerGroup: async ({ organization, name, visibility, allowsPublicRepositories }) => {
      createCalls.push(`${organization}/${name}:${visibility}:${allowsPublicRepositories}`);
      return { id: 77, name, visibility, default: false };
    },
  });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, runnerApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26650000002',
      GITHUB_RUN_ATTEMPT: '2',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_org_mutation: true,
    },
    createApi: () => buildTeamApi(),
    teamApi: buildTeamApi(),
    runnerApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.runner_group_creation_result, 'created');
  assert.equal(result.execution.created_runner_group_id, 77);
  assert.equal(result.execution.failure_count, 0);
  assert.deepEqual(createCalls, ['octo-org/ContosoUK_Builders:selected:false']);
});

test('US3 existing runner group converges as no-op', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-group-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let createAttempted = false;

  const runnerApi = buildRunnerApi({
    runnerGroups: [
      { id: 1, name: 'Default', default: true, visibility: 'all' },
      { id: 9, name: 'ContosoUK_Builders', default: false, visibility: 'selected' },
    ],
    createRunnerGroup: async () => {
      createAttempted = true;
      throw new Error('create should not run for existing runner group noop path');
    },
  });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, runnerApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26650000003',
      GITHUB_RUN_ATTEMPT: '3',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_org_mutation: true,
    },
    createApi: () => buildTeamApi(),
    teamApi: buildTeamApi(),
    runnerApi,
    setProcessExitCode: false,
  });

  assert.equal(createAttempted, false);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.runner_group_creation_result, 'noop');
  assert.equal(result.execution.mutation_count, 0);
});

test('US3 blocks runner-group creation when the requester loses CI/CD admin membership', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-group-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let createAttempted = false;

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi({
      createRunnerGroup: async () => ({ id: 78, name: 'ContosoUK_Builders' }),
    }),
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26650000004',
      GITHUB_RUN_ATTEMPT: '4',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_org_mutation: true,
    },
    createApi: () => buildTeamApi({ cicdMembershipState: 'absent' }),
    teamApi: buildTeamApi({ cicdMembershipState: 'absent' }),
    runnerApi: buildRunnerApi({
      createRunnerGroup: async () => {
        createAttempted = true;
        throw new Error('create should not run on boundary mismatch');
      },
    }),
    setProcessExitCode: false,
  });

  assert.equal(createAttempted, false);
  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
});
