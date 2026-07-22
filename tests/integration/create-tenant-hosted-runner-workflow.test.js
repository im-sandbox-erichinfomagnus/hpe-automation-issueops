'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('create-tenant-hosted-runner workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-tenant-hosted-runner.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+create-tenant-hosted-runner/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_RUNNER_NAME/);
  assert.match(workflow, /PARSED_RUNNER_IMAGE_ID/);
  assert.match(workflow, /PARSED_RUNNER_SIZE/);
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
    ISSUE_NUMBER: '330',
    REQUESTER_LOGIN: 'tenant-cicd-admin',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_RUNNER_NAME: 'ubuntu-build',
    PARSED_RUNNER_IMAGE_ID: 'ubuntu-24.04',
    PARSED_RUNNER_IMAGE_SOURCE: 'github',
    PARSED_RUNNER_SIZE: '4-core',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'CI capacity for the tenant.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26630000001',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildTeamApi(options = {}) {
  const approverRole = options.approverRole || 'admin';
  const cicdMembershipState = options.cicdMembershipState || 'active';
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? approverRole : 'member',
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
    listHostedRunners: async () => options.existingRunners || [],
    listRunnerGroups: async () => options.runnerGroups || [
      { id: 1, name: 'Default', default: true, visibility: 'all' },
    ],
    createHostedRunner: options.createHostedRunner || (async () => {
      throw new Error('createHostedRunner mock not configured');
    }),
    deleteHostedRunner: async () => {
      throw new Error('deleteHostedRunner should not run for creation requests');
    },
    createRunnerGroup: async () => {
      throw new Error('createRunnerGroup should not run for hosted-runner requests');
    },
  };
}

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, runnerApi, approvalComments, envOverrides }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, envOverrides),
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
      listIssueComments: async () => approvalComments || [
        {
          id: 2101,
          body: 'approved',
          created_at: '2026-06-05T10:00:00Z',
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

test('US1 validation marks valid CI/CD-admin requests approval-ready and records the operation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    runnerApi: buildRunnerApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'hosted_runner_creation');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.runner_name_derived, 'ContosoUK_ubuntu-build');
  assert.equal(artifact.request.cicd_admin_team_slug, 'contosouk-admin');
  assert.equal(artifact.validation.is_valid, true);
  assert.equal(artifact.reconciliation.creation_action, 'create_hosted_runner');
});

test('US1 validation rejects requesters outside the CI/CD admin team', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us1-reject-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, { REQUESTER_LOGIN: 'random-user' }),
    api: buildTeamApi(),
    runnerApi: buildRunnerApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.validation.is_valid, false);
  assert.equal(artifact.request.request_status, 'validation_failed');
  assert.equal(
    artifact.validation.errors.some((error) => /not an active member of the tenant CI\/CD admin team/i.test(error)),
    true,
    JSON.stringify(artifact.validation.errors)
  );
});

test('US2 designated active-owner approval unlocks execution; non-designated approval is denied', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us2-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi(),
  });

  let artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'approved');
  assert.equal(artifact.approval.approver_role, 'target_org_owner');
  assert.equal(artifact.request.request_status, 'approved');
  assert.equal(artifact.approval.approved_context_marker, artifact.request.context_marker);

  const deniedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us2-denied-'));
  const deniedArtifactPath = path.join(deniedWorkspace, 'audit.json');
  const deniedRegistryDir = buildRunnerRegistry(deniedWorkspace);

  await runValidatedAndApprovedFlow({
    artifactPath: deniedArtifactPath,
    registryDir: deniedRegistryDir,
    runnerApi: buildRunnerApi(),
    approvalComments: [
      {
        id: 2102,
        body: 'approved',
        created_at: '2026-06-05T10:05:00Z',
        user: { login: 'not-the-designated-approver' },
      },
    ],
  });

  artifact = JSON.parse(fs.readFileSync(deniedArtifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'denied');
  assert.match(artifact.approval.decision_note, /tenant hosted-runner creation/i);
});

test('US3 happy path creates the hosted runner in the resolved default group', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  const createCalls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi(),
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26630000002',
      GITHUB_RUN_ATTEMPT: '2',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
      AUDIT_ARTIFACT_RETENTION_DAYS: '30',
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
    runnerApi: buildRunnerApi({
      createHostedRunner: async ({ organization, name, imageId, imageSource, size, runnerGroupId }) => {
        createCalls.push(`${organization}/${name}:${imageId}:${imageSource}:${size}:group-${runnerGroupId}`);
        return { id: 901, name, status: 'Provisioning', runner_group_id: runnerGroupId };
      },
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.runner_creation_result, 'created');
  assert.equal(result.execution.created_runner_id, 901);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.audit_persistence_result, 'persisted');
  assert.deepEqual(createCalls, ['octo-org/ContosoUK_ubuntu-build:ubuntu-24.04:github:4-core:group-1']);
});

test('US3 existing runner converges as no-op without duplicate creation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us3-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let createAttempted = false;

  const existingRunnerApi = buildRunnerApi({
    existingRunners: [{ id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready' }],
    createHostedRunner: async () => {
      createAttempted = true;
      throw new Error('create should not run for existing runner noop path');
    },
  });

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: existingRunnerApi,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26630000003',
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
    runnerApi: existingRunnerApi,
    setProcessExitCode: false,
  });

  assert.equal(createAttempted, false);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.runner_creation_result, 'noop');
  assert.equal(result.execution.noop_count >= 1, true);
  assert.equal(result.execution.mutation_count, 0);
});

test('US3 blocks approved execution when the requester loses CI/CD admin membership', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-us3-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  let mutationAttempted = false;

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi(),
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26630000004',
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
    createApi: () => buildTeamApi(),
    teamApi: buildTeamApi({ cicdMembershipState: 'absent' }),
    runnerApi: buildRunnerApi({
      createHostedRunner: async () => {
        mutationAttempted = true;
        throw new Error('create should not run on boundary mismatch');
      },
    }),
    setProcessExitCode: false,
  });

  assert.equal(mutationAttempted, false);
  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
  assert.equal(result.execution.failure_count > 0, true);
});

test('dry-run approved execution emits intent with no runner mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-dryrun-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  const mutationCalls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi(),
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  artifact.request.dry_run = true;
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26630000005',
      GITHUB_RUN_ATTEMPT: '5',
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
    runnerApi: buildRunnerApi({
      createHostedRunner: async ({ organization, name }) => {
        mutationCalls.push(`create:${organization}/${name}`);
        return { id: 902, name, status: 'Provisioning' };
      },
    }),
    setProcessExitCode: false,
  });

  assert.deepEqual(mutationCalls, [], 'expected no mutation calls for dry_run=true');
  assert.match(result.execution.summary || '', /dry.run/i);
});

test('approved execution is fail-closed when ISSUEOPS_GITHUB_TOKEN is absent', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-no-token-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRunnerRegistry(workspace);
  const mutationCalls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    runnerApi: buildRunnerApi(),
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: '',
      GITHUB_RUN_ID: '26630000006',
      GITHUB_RUN_ATTEMPT: '6',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    teamApi: buildTeamApi(),
    runnerApi: buildRunnerApi({
      createHostedRunner: async ({ organization, name }) => {
        mutationCalls.push(`create:${organization}/${name}`);
        return { id: 903, name, status: 'Provisioning' };
      },
    }),
    setProcessExitCode: false,
  });

  assert.deepEqual(mutationCalls, [], 'expected no mutation calls when token is absent');
  assert.ok(
    ['failed', 'blocked', 'validation_failed'].includes(result.request.request_status),
    `expected failed/blocked status when token absent, got: ${result.request.request_status}`
  );
});
