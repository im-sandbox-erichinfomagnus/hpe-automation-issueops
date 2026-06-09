'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('delete-tenant-hosted-runner workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'delete-tenant-hosted-runner.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+delete-tenant-hosted-runner/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_RUNNER_NAME/);
  assert.doesNotMatch(workflow, /PARSED_RUNNER_IMAGE_ID/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
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
    ISSUE_NUMBER: '345',
    REQUESTER_LOGIN: 'tenant-cicd-admin',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_RUNNER_NAME: 'ubuntu-build',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Decommissioning tenant CI capacity.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26640000001',
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
    addIssueLabels: async () => ([]),
    listIssueComments: async () => [],
  };
}

function buildRunnerApi(options = {}) {
  return {
    listHostedRunners: async () => options.existingRunners ?? [
      { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready' },
    ],
    listRunnerGroups: async () => [
      { id: 1, name: 'Default', default: true, visibility: 'all' },
    ],
    deleteHostedRunner: options.deleteHostedRunner || (async () => {
      throw new Error('deleteHostedRunner mock not configured');
    }),
    createHostedRunner: async () => {
      throw new Error('createHostedRunner should not run for deletion requests');
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
          id: 2201,
          body: 'approved',
          created_at: '2026-06-05T11:00:00Z',
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

test('US1 validation records the deletion operation and resolves the runner id', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-delete-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    runnerApi: buildRunnerApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'hosted_runner_deletion');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.runner_name_derived, 'ContosoUK_ubuntu-build');
  assert.equal(artifact.validation.existing_runner_id, 55);
  assert.equal(artifact.reconciliation.deletion_action, 'delete_hosted_runner');
});

test('US3 happy path deletes the resolved hosted runner', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-delete-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  const deleteCalls = [];

  const runnerApi = buildRunnerApi({
    deleteHostedRunner: async ({ organization, hostedRunnerId }) => {
      deleteCalls.push(`${organization}#${hostedRunnerId}`);
      return { deleted: true, not_found: false };
    },
  });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, runnerApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26640000002',
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
  assert.equal(result.execution.runner_deletion_result, 'deleted');
  assert.equal(result.execution.failure_count, 0);
  assert.deepEqual(deleteCalls, ['octo-org#55']);
});

test('US3 missing runner converges as no-op without deletion call', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-delete-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let deleteAttempted = false;

  const runnerApi = buildRunnerApi({
    existingRunners: [],
    deleteHostedRunner: async () => {
      deleteAttempted = true;
      throw new Error('delete should not run when the runner is already absent');
    },
  });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, runnerApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26640000003',
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

  assert.equal(deleteAttempted, false);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.runner_deletion_result, 'noop');
  assert.equal(result.execution.mutation_count, 0);
});

test('US3 blocks deletion when the requester loses CI/CD admin membership', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-delete-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let deleteAttempted = false;

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi({
      deleteHostedRunner: async () => ({ deleted: true, not_found: false }),
    }),
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26640000004',
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
      deleteHostedRunner: async () => {
        deleteAttempted = true;
        throw new Error('delete should not run on boundary mismatch');
      },
    }),
    setProcessExitCode: false,
  });

  assert.equal(deleteAttempted, false);
  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
});
