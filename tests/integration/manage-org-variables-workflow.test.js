'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('manage-org-variables workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'manage-org-variables.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+manage-org-variables/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_ORG_VARIABLE_OPERATION/);
  assert.match(workflow, /PARSED_ORG_VARIABLES_CSV/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
});

test('manage-org-variables issue form exposes the routing anchor and no approver field', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'manage-org-variables.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+org_variable_operation/);
  assert.match(form, /id:\s+org_variables_csv/);
  assert.match(form, /id:\s+dry_run/);
  assert.doesNotMatch(form, /designated_approver/);
  assert.doesNotMatch(form, /tenant_name/);
});

function buildValidationEnv(artifactPath, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '525',
    REQUESTER_LOGIN: 'org-owner-caller',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_ORG_VARIABLE_OPERATION: 'create',
    PARSED_ORG_VARIABLE_NAME: 'PLATFORM_API_BASE_URL',
    PARSED_ORG_VARIABLE_VALUE: 'https://api.platform.example.com',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Shared platform endpoint metadata.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26670000001',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildTeamApi(options = {}) {
  const requesterRole = options.requesterRole || 'admin';
  const requesterState = options.requesterState || 'active';
  const labelCalls = options.labelCalls || [];
  return {
    labelCalls,
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-caller' ? requesterRole : 'member',
        state: username === 'org-owner-caller' ? requesterState : 'active',
      },
    }),
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    addIssueLabels: async ({ labels }) => {
      labelCalls.push(...labels);
      return [];
    },
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
    createOrganizationVariable: async ({ name, value, visibility }) => {
      calls.create.push(`${name}=${value}:${visibility}`);
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

async function runValidatedAndApprovedFlow({ artifactPath, teamApi, orgVariablesApi, envOverrides }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, envOverrides),
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
      listIssueComments: async () => [],
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

test('US1 validation records the org variable operation and plan entries', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: buildValidationEnv(artifactPath),
    api: buildTeamApi(),
    orgVariablesApi: buildOrgVariablesApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'org_variable_management');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.org_variable_operation, 'create');
  assert.equal(artifact.request.org_variable_entries[0].name, 'PLATFORM_API_BASE_URL');
  assert.equal(artifact.request.org_variable_entries[0].operation, 'create');
});

test('US1 rejects a caller who is not an active org owner', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-reject-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: buildValidationEnv(artifactPath),
    api: buildTeamApi({ requesterRole: 'member' }),
    orgVariablesApi: buildOrgVariablesApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.request.request_status, 'validation_failed');
  assert.equal(artifact.validation.is_valid, false);
  assert.ok(artifact.validation.errors.some((error) => error.includes('is not an active owner of the target organization')));
  assert.equal(artifact.approval.approval_status, 'not_requested');
});

test('US2 approval gate auto-approves self-serve requests without an approver comment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-us2-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runValidatedAndApprovedFlow({
    artifactPath,
    teamApi: buildTeamApi(),
    orgVariablesApi: buildOrgVariablesApi(),
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'approved');
  assert.equal(artifact.approval.approver_role, 'tenant_self_serve');
  assert.equal(artifact.approval.decision_source, 'policy');
  assert.equal(artifact.request.request_status, 'approved');
});

test('US3 happy path applies mixed CSV operations end-to-end', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const orgVariablesApi = buildOrgVariablesApi({
    initialVariables: [
      ['DEPLOY_CHANNEL', 'canary'],
      ['RETIRED_FLAG', 'true'],
    ],
  });
  const teamApi = buildTeamApi();

  await runValidatedAndApprovedFlow({
    artifactPath,
    teamApi,
    orgVariablesApi,
    envOverrides: {
      PARSED_ORG_VARIABLE_NAME: '',
      PARSED_ORG_VARIABLE_VALUE: '',
      PARSED_ORG_VARIABLES_CSV: [
        'name,value,operation,visibility',
        'NEW_FLAG,enabled,create,private',
        'DEPLOY_CHANNEL,stable,update,',
        'RETIRED_FLAG,,delete,',
      ].join('\n'),
    },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000002',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi,
    orgVariablesApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.mutation_count, 3);
  assert.deepEqual(orgVariablesApi.calls.create, ['NEW_FLAG=enabled:private']);
  assert.deepEqual(orgVariablesApi.calls.update, ['DEPLOY_CHANNEL=stable']);
  assert.deepEqual(orgVariablesApi.calls.delete, ['RETIRED_FLAG']);
  assert.ok(teamApi.labelCalls.includes('issueops:manage-org-variables:executed'));
});

test('US3 already-satisfied variable converges as a no-op', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const orgVariablesApi = buildOrgVariablesApi({
    initialVariables: [['PLATFORM_API_BASE_URL', 'https://api.platform.example.com']],
  });

  await runValidatedAndApprovedFlow({
    artifactPath,
    teamApi: buildTeamApi(),
    orgVariablesApi,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000003',
      GITHUB_RUN_ATTEMPT: '3',
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

test('US3 fails closed when the requester loses org ownership before execution', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const orgVariablesApi = buildOrgVariablesApi();

  await runValidatedAndApprovedFlow({
    artifactPath,
    teamApi: buildTeamApi(),
    orgVariablesApi,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000004',
      GITHUB_RUN_ATTEMPT: '4',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi: buildTeamApi({ requesterRole: 'member' }),
    orgVariablesApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
  assert.deepEqual(orgVariablesApi.calls.create, []);
});

test('US3 dry-run request remains blocked without any mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'org-variables-dryrun-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const orgVariablesApi = buildOrgVariablesApi();

  await runValidatedAndApprovedFlow({
    artifactPath,
    teamApi: buildTeamApi(),
    orgVariablesApi,
    envOverrides: { PARSED_DRY_RUN: 'true' },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000005',
      GITHUB_RUN_ATTEMPT: '5',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi: buildTeamApi(),
    orgVariablesApi,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'approved');
  assert.match(result.execution.summary, /dry-run only/);
  assert.deepEqual(orgVariablesApi.calls.create, []);
  assert.deepEqual(orgVariablesApi.calls.update, []);
  assert.deepEqual(orgVariablesApi.calls.delete, []);
});
