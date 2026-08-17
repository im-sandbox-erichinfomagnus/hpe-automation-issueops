'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runCostCenterValidation } = require('../../src/scripts/run-manage-cost-centers-validation');
const { runCostCenterApproval } = require('../../src/scripts/run-manage-cost-centers-approval');
const { runCostCenterExecution } = require('../../src/scripts/run-manage-cost-centers-execution');
const { assertCostCenterMutationAllowed } = require('../../src/actions/manage-cost-centers-policy');

test('manage-cost-centers workflow wires validation, approval, and execution scripts', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'manage-cost-centers.yml'),
    'utf8'
  );
  assert.match(workflow, /name:\s+manage-cost-centers/);
  assert.match(workflow, /issue-ops\/parser@v5/);
  assert.match(workflow, /run-manage-cost-centers-validation\.js/);
  assert.match(workflow, /run-manage-cost-centers-approval\.js/);
  assert.match(workflow, /run-manage-cost-centers-execution\.js/);
  assert.match(workflow, /PARSED_COST_CENTERS/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/);
  assert.match(workflow, /AUDIT_ARTIFACT_PATH:\s+artifacts\/manage-cost-centers-validation-/);
  assert.match(workflow, /name:\s+Post audit summary comment/);
  assert.match(workflow, /github\.rest\.issues\.createComment/);
  assert.match(workflow, /steps\.request_scope\.outputs\.matches-request\s*==\s*'true'/);
});

function buildState() {
  return [
    { id: 'cc-ai', name: 'AI Model Routing', state: 'active', resources: [] },
    { id: 'cc-old', name: 'Retired Sandbox', state: 'active', resources: [] },
    { id: 'cc-busy', name: 'Busy Center', state: 'active', resources: [{ type: 'Organization', name: 'octo' }] },
  ];
}

function costCenterApi(state) {
  return {
    listCostCenters: async () => state.map((c) => ({ ...c, resources: c.resources || [] })),
    getCostCenter: async ({ costCenterId }) => {
      const cc = state.find((c) => String(c.id) === String(costCenterId));
      return cc ? { exists: true, cost_center: { ...cc, resources: cc.resources || [] } } : { exists: false, cost_center: null };
    },
    createCostCenter: async ({ name }) => { const cc = { id: `new-${name}`, name, state: 'active', resources: [] }; state.push(cc); return cc; },
    renameCostCenter: async ({ costCenterId, name }) => { const cc = state.find((c) => String(c.id) === String(costCenterId)); cc.name = name; return cc; },
    deleteCostCenter: async ({ costCenterId }) => {
      const i = state.findIndex((c) => String(c.id) === String(costCenterId));
      if (i < 0) { return { deleted: false, not_found: true }; }
      state.splice(i, 1);
      return { deleted: true, not_found: false };
    },
  };
}

function approvalApi(login = 'billing-manager') {
  return {
    listIssueComments: async () => ([{ id: 1, body: 'approved', created_at: '2026-06-11T10:00:00Z', user: { login } }]),
    addIssueLabels: async () => ([]),
  };
}

function baseEnv(artifactPath, csv, overrides = {}) {
  return {
    AUDIT_ARTIFACT_PATH: artifactPath,
    ISSUE_NUMBER: '42',
    REQUESTER_LOGIN: 'requester',
    PARSED_ENTERPRISE: 'octo-enterprise',
    PARSED_DESIGNATED_APPROVER: 'billing-manager',
    PARSED_COST_CENTERS: csv,
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'cleanup',
    ISSUEOPS_GITHUB_TOKEN: 'pat',
    GITHUB_TOKEN: 'pat',
    ...overrides,
  };
}

const HAPPY_CSV = [
  'cost_center,action,new_name,cost_center_id,force',
  'Platform Engineering,create,,,',
  'AI Model Routing,rename,AI Platform Routing,,',
  'Retired Sandbox,delete,,,false',
  'Busy Center,delete,,,false',
  'Ghost Center,delete,,,',
].join('\n');

test('full flow: validate, approve, execute applies create/rename/delete and skips blocked', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-int-'));
  const artifactPath = path.join(ws, 'audit.json');
  const state = buildState();
  const env = baseEnv(artifactPath, HAPPY_CSV);

  await runCostCenterValidation({ env, costCenterApi: costCenterApi(state), setProcessExitCode: false });
  let artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'cost_center_management');
  assert.equal(artifact.validation.is_valid, true);
  assert.equal(artifact.request.request_status, 'awaiting_approval');

  await runCostCenterApproval({ env, api: approvalApi(), setProcessExitCode: false });
  artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'approved');

  const result = await runCostCenterExecution({
    env,
    costCenterApi: costCenterApi(state),
    labelsApi: approvalApi(),
    tokenInfo: { token: 'pat', is_pat_backed: true },
    setProcessExitCode: false,
  });
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.created_count, 1);
  assert.equal(result.execution.renamed_count, 1);
  assert.equal(result.execution.deleted_count, 1);
  assert.equal(result.execution.failure_count, 0);
  assert.ok(state.find((c) => c.name === 'Platform Engineering'));
  assert.ok(state.find((c) => c.name === 'AI Platform Routing'));
  assert.ok(!state.find((c) => c.name === 'Retired Sandbox'));
  assert.ok(state.find((c) => c.name === 'Busy Center'), 'blocked delete must not remove the busy center');
});

test('non-designated approver is denied', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-deny-'));
  const artifactPath = path.join(ws, 'audit.json');
  const state = buildState();
  const env = baseEnv(artifactPath, 'cost_center,action\nPlatform Engineering,create');

  await runCostCenterValidation({ env, costCenterApi: costCenterApi(state), setProcessExitCode: false });
  await runCostCenterApproval({ env, api: approvalApi('someone-else'), setProcessExitCode: false });
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'denied');
});

test('dry-run approved execution makes no mutation', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dry-'));
  const artifactPath = path.join(ws, 'audit.json');
  const state = buildState();
  const env = baseEnv(artifactPath, 'cost_center,action\nPlatform Engineering,create', { PARSED_DRY_RUN: 'true' });
  const mutating = costCenterApi(state);
  mutating.createCostCenter = async () => { throw new Error('create must not run in dry-run'); };

  await runCostCenterValidation({ env, costCenterApi: costCenterApi(state), setProcessExitCode: false });
  await runCostCenterApproval({ env, api: approvalApi(), setProcessExitCode: false });
  const result = await runCostCenterExecution({
    env, costCenterApi: mutating, labelsApi: approvalApi(),
    tokenInfo: { token: 'pat', is_pat_backed: true }, setProcessExitCode: false,
  });
  assert.equal(result.execution.executed_count, 0);
  assert.match(result.execution.summary, /dry-run/i);
  assert.equal(state.find((c) => c.name === 'Platform Engineering'), undefined);
});

test('fail-soft: no token validates with unverified plan, approval-ready', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-soft-'));
  const artifactPath = path.join(ws, 'audit.json');
  const env = baseEnv(artifactPath, 'cost_center,action\nPlatform Engineering,create', {
    ISSUEOPS_GITHUB_TOKEN: '', GITHUB_TOKEN: '',
  });

  await runCostCenterValidation({ env, setProcessExitCode: false });
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.validation.is_valid, true);
  assert.equal(artifact.validation.live_access, false);
  assert.equal(artifact.validation.requested_changes[0].validation_status, 'unverified');
});

test('policy guard blocks execution without a PAT-backed token', () => {
  assert.throws(
    () => assertCostCenterMutationAllowed({
      approval_status: 'approved', approver_role: 'designated_approver', dry_run: false,
      tokenInfo: { token: 'gh', is_pat_backed: false },
    }),
    /not a PAT/i
  );
  const dry = assertCostCenterMutationAllowed({
    approval_status: 'approved', approver_role: 'designated_approver', dry_run: true,
    tokenInfo: { token: 'pat', is_pat_backed: true },
  });
  assert.equal(dry.allowed, false);
  assert.equal(dry.reason, 'dry_run');
  const ok = assertCostCenterMutationAllowed({
    approval_status: 'approved', approver_role: 'designated_approver', dry_run: false,
    tokenInfo: { token: 'pat', is_pat_backed: true },
  });
  assert.equal(ok.allowed, true);
});

test('blank inline field uses a CSV attached by the issue author in a comment', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-attach-'));
  const artifactPath = path.join(ws, 'audit.json');
  const state = buildState();
  const commentsApi = {
    listIssueComments: async () => ([
      { id: 9, created_at: '2026-06-11T09:00:00Z', user: { login: 'requester' },
        body: 'sheet attached [centers.csv](https://github.com/user-attachments/files/123/centers.csv)' },
    ]),
    addIssueLabels: async () => ([]),
  };
  const downloadAttachment = async () => ({ text: 'cost_center,action\nPlatform Engineering,create\nRetired Sandbox,delete', byte_size: 60 });

  await runCostCenterValidation({
    env: baseEnv(artifactPath, '', { PARSED_DRY_RUN: 'true', GITHUB_REPOSITORY: 'o/r' }),
    costCenterApi: costCenterApi(state),
    commentsApi,
    downloadAttachment,
    setProcessExitCode: false,
  });
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.request.intake_mode, 'csv_attachment');
  assert.equal(artifact.request.attachment_provenance.filename, 'centers.csv');
  assert.equal(artifact.validation.is_valid, true, JSON.stringify(artifact.validation.errors));
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.requested_changes.length, 2);
});

test('blank inline field with no attachment waits for one', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-wait-'));
  const artifactPath = path.join(ws, 'audit.json');
  const commentsApi = { listIssueComments: async () => ([]), addIssueLabels: async () => ([]) };

  await runCostCenterValidation({
    env: baseEnv(artifactPath, '', { PARSED_DRY_RUN: 'true', GITHUB_REPOSITORY: 'o/r' }),
    costCenterApi: costCenterApi(buildState()),
    commentsApi,
    setProcessExitCode: false,
  });
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.request.request_status, 'waiting_for_attachment');
  assert.equal(artifact.validation.is_valid, false);
  assert.match(artifact.validation.warnings.join(' '), /attach a .csv file/i);
});

test('a non-requester attachment is not accepted (still waiting)', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-nonreq-'));
  const artifactPath = path.join(ws, 'audit.json');
  const commentsApi = {
    listIssueComments: async () => ([
      { id: 9, created_at: '2026-06-11T09:00:00Z', user: { login: 'someone-else' },
        body: 'sheet [centers.csv](https://github.com/user-attachments/files/123/centers.csv)' },
    ]),
    addIssueLabels: async () => ([]),
  };
  await runCostCenterValidation({
    env: baseEnv(artifactPath, '', { PARSED_DRY_RUN: 'true', GITHUB_REPOSITORY: 'o/r' }),
    costCenterApi: costCenterApi(buildState()),
    commentsApi,
    downloadAttachment: async () => { throw new Error('download must not run for a non-requester attachment'); },
    setProcessExitCode: false,
  });
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.request.request_status, 'waiting_for_attachment');
});

test('inline CSV present is used and comment attachments are ignored', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-inline-wins-'));
  const artifactPath = path.join(ws, 'audit.json');
  const commentsApi = {
    listIssueComments: async () => ([
      { id: 9, created_at: '2026-06-11T09:00:00Z', user: { login: 'requester' },
        body: '[x.csv](https://github.com/user-attachments/files/9/x.csv)' },
    ]),
    addIssueLabels: async () => ([]),
  };
  await runCostCenterValidation({
    env: baseEnv(artifactPath, 'cost_center,action\nInline Only,create', { PARSED_DRY_RUN: 'true', GITHUB_REPOSITORY: 'o/r' }),
    costCenterApi: costCenterApi(buildState()),
    commentsApi,
    downloadAttachment: async () => { throw new Error('download must not run when inline CSV is present'); },
    setProcessExitCode: false,
  });
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.request.intake_mode, 'manual');
  assert.equal(artifact.request.requested_changes.length, 1);
});
