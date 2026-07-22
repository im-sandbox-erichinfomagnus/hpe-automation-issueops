'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('move workflow includes validation, approval, execution, and issue comment steps', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'move-tenant-hosted-runner.yml'),
    'utf8'
  );

  assert.match(workflow, /name:\s+move-tenant-hosted-runner/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /PARSED_HOSTED_RUNNER_ID/);
  assert.match(workflow, /PARSED_TARGET_RUNNER_GROUP_NAME/);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /github\.rest\.issues\.createComment/i);
});

function buildRunnerRegistry(workspace) {
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
        runnerTopology: { runnerGroups: [] },
      },
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
    PARSED_RUNNER_NAME: 'ubuntu-build',
    PARSED_HOSTED_RUNNER_ID: '',
    PARSED_TARGET_RUNNER_GROUP_NAME: 'ContosoUK_Builders',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Move the runner into the tenant group.',
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
      { slug: 'contosouk-root', parent: null },
      { slug: 'contosouk-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk-admin' && username === 'tenant-cicd-admin') {
        return cicdMembershipState === 'active'
          ? { state: 'active', membership: { role: 'member' } }
          : { state: cicdMembershipState, membership: null };
      }
      return { state: 'absent', membership: null };
    },
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    addIssueLabels: async () => [],
    listIssueComments: async () => [],
  };
}

function buildRunnerApi(options = {}) {
  return {
    listHostedRunners: async () => options.existingRunners ?? [
      { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready', runner_group_id: 1 },
    ],
    listRunnerGroups: async () => options.runnerGroups ?? [
      { id: 1, name: 'Default', default: true },
      { id: 7, name: 'ContosoUK_Builders', default: false },
    ],
    updateHostedRunner: options.updateHostedRunner || (async () => {
      throw new Error('updateHostedRunner mock not configured');
    }),
    createHostedRunner: async () => {
      throw new Error('createHostedRunner should not run for move requests');
    },
    deleteHostedRunner: async () => {
      throw new Error('deleteHostedRunner should not run for move requests');
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
          created_at: '2026-06-12T11:00:00Z',
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

test('validation records the move operation and planned target group', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-move-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    runnerApi: buildRunnerApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'hosted_runner_move');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.validation.existing_runner_id, 55);
  assert.equal(artifact.validation.current_runner_group_id, 1);
  assert.equal(artifact.validation.target_runner_group_resolution.resolved_group_id, 7);
  assert.equal(artifact.reconciliation.move_action, 'move_hosted_runner');
});

test('approved execution moves the hosted runner to the resolved group', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-move-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  const updateCalls = [];
  const runnerApi = buildRunnerApi({
    updateHostedRunner: async (input) => {
      updateCalls.push(input);
      return {
        id: input.hostedRunnerId,
        name: 'ContosoUK_ubuntu-build',
        runner_group_id: input.runnerGroupId,
        status: 'Ready',
      };
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
  assert.equal(result.execution.runner_move_result, 'moved');
  assert.equal(result.execution.mutation_count, 1);
  assert.deepEqual(updateCalls, [{
    organization: 'octo-org',
    hostedRunnerId: 55,
    runnerGroupId: 7,
  }]);
});

test('runner already in the target group converges as no-op', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-move-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let updateAttempted = false;
  const runnerApi = buildRunnerApi({
    existingRunners: [
      { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready', runner_group_id: 7 },
    ],
    updateHostedRunner: async () => {
      updateAttempted = true;
      throw new Error('update should not run when the runner is already in the target group');
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

  assert.equal(updateAttempted, false);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.runner_move_result, 'noop');
  assert.equal(result.execution.mutation_count, 0);
});

test('execution blocks the move when tenant authorization changes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-move-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let updateAttempted = false;
  const initialRunnerApi = buildRunnerApi({
    updateHostedRunner: async () => ({ id: 55, runner_group_id: 7 }),
  });

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: initialRunnerApi,
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
      updateHostedRunner: async () => {
        updateAttempted = true;
        throw new Error('update should not run on boundary mismatch');
      },
    }),
    setProcessExitCode: false,
  });

  assert.equal(updateAttempted, false);
  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
  assert.equal(result.execution.runner_move_result, 'failed');
});
