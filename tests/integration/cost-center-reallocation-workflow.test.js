'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runCostCenterValidation } = require('../../src/scripts/run-cost-center-validation');
const { runCostCenterApproval } = require('../../src/scripts/run-cost-center-approval');
const { runCostCenterExecution } = require('../../src/scripts/run-cost-center-execution');

const SAMPLE_CSV = [
  'cost_center,login,action',
  'Platform Engineering,octocat,add',
  'Platform Engineering,hubot,remove',
  'AI Enablement,hubot,add',
].join('\n');

function tempArtifactPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-cost-center-'));
  return path.join(dir, 'artifact.json');
}

function buildEnv(overrides = {}) {
  return {
    ISSUE_NUMBER: '10',
    REQUESTER_LOGIN: 'requester',
    GITHUB_REPOSITORY: 'im-sandbox-erichinfomagnus/cost-center-demo',
    ...overrides,
  };
}

function parsedRequest(overrides = {}) {
  return JSON.stringify({
    enterprise: 'octo-ent',
    intended_approver: 'approver1',
    assignments_csv: SAMPLE_CSV,
    business_justification: 'Reallocating Copilot seats after the Q2 reorg.',
    dry_run: 'true',
    ...overrides,
  });
}

function approvalComment(login) {
  return [{ user: { login }, body: 'approved', created_at: '2026-05-28T12:00:00Z' }];
}

function makeFakeCostCenterApi(initialCostCenters = []) {
  const state = { costCenters: initialCostCenters };
  const calls = { list: 0, create: [], add: [], remove: [] };
  return {
    calls,
    state,
    async listCostCenters() {
      calls.list += 1;
      return state.costCenters.map((costCenter) => ({
        id: costCenter.id,
        name: costCenter.name,
        state: costCenter.state || 'active',
        resources: costCenter.resources || [],
      }));
    },
    async createCostCenter({ name }) {
      calls.create.push(name);
      const created = { id: `new-${name}`, name, state: 'active', resources: [] };
      state.costCenters.push(created);
      return created;
    },
    async addResource({ costCenterId, users }) {
      calls.add.push({ costCenterId, users });
      return { ok: true, status: 200, payload: {} };
    },
    async removeResource({ costCenterId, users }) {
      calls.remove.push({ costCenterId, users });
      return { ok: true, status: 200, payload: {} };
    },
  };
}

function makeFakeTeamApi(comments) {
  return {
    async listIssueComments() {
      return comments;
    },
  };
}

test('dry-run with no enterprise token produces a plan without mutating', async () => {
  const artifactPath = tempArtifactPath();
  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ dry_run: 'true' }),
    AUDIT_ARTIFACT_PATH: artifactPath,
  });

  const throwingCostCenterApi = {
    async listCostCenters() {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    },
  };

  const validation = await runCostCenterValidation({ env, api: throwingCostCenterApi, setProcessExitCode: false });
  assert.equal(validation.validation.is_valid, true);
  assert.equal(validation.validation.live_state_verified, false);
  assert.deepEqual(validation.reconciliationPlan.cost_centers_to_create.sort(), ['AI Enablement', 'Platform Engineering']);
  assert.equal(validation.reconciliationPlan.assignments_to_add.length, 2);
  assert.equal(validation.reconciliationPlan.assignments_to_remove.length, 1);

  const approvalApi = makeFakeTeamApi(approvalComment('approver1'));
  const approved = await runCostCenterApproval({ env, api: approvalApi, setProcessExitCode: false });
  assert.equal(approved.approval.approval_status, 'approved');

  const costCenterApi = makeFakeCostCenterApi();
  const executed = await runCostCenterExecution({ env, api: costCenterApi, setProcessExitCode: false });
  assert.equal(executed.reconciliation.assignments_to_add.length, 2);
  assert.equal(executed.reconciliation.assignments_to_remove.length, 1);
  assert.equal(costCenterApi.calls.create.length, 0);
  assert.equal(costCenterApi.calls.add.length, 0);
  assert.equal(costCenterApi.calls.remove.length, 0);
});

test('approved live run creates the cost center and adds and removes users', async () => {
  const artifactPath = tempArtifactPath();
  const env = buildEnv({
    ISSUEOPS_GITHUB_TOKEN: 'pat_billing_token',
    PARSED_REQUEST_JSON: parsedRequest({ dry_run: 'false' }),
    AUDIT_ARTIFACT_PATH: artifactPath,
  });

  const costCenterApi = makeFakeCostCenterApi([
    { id: 'cc-pe', name: 'Platform Engineering', state: 'active', resources: [{ type: 'User', name: 'hubot' }] },
  ]);

  const validation = await runCostCenterValidation({ env, api: costCenterApi, setProcessExitCode: false });
  assert.equal(validation.validation.is_valid, true);
  assert.equal(validation.validation.live_state_verified, true);

  const approvalApi = makeFakeTeamApi(approvalComment('approver1'));
  const approved = await runCostCenterApproval({ env, api: approvalApi, setProcessExitCode: false });
  assert.equal(approved.approval.approval_status, 'approved');

  const executed = await runCostCenterExecution({
    env,
    api: costCenterApi,
    tokenInfo: { token: 'pat_billing_token', is_pat_backed: true },
    setProcessExitCode: false,
  });

  assert.deepEqual(costCenterApi.calls.create, ['AI Enablement']);
  assert.equal(costCenterApi.calls.add.length, 2);
  assert.equal(costCenterApi.calls.remove.length, 1);
  assert.deepEqual(costCenterApi.calls.remove[0], { costCenterId: 'cc-pe', users: ['hubot'] });
  assert.equal(executed.execution.cost_centers_created_count, 1);
  assert.equal(executed.execution.added_count, 2);
  assert.equal(executed.execution.removed_count, 1);
  assert.equal(executed.execution.failure_count, 0);
  assert.equal(executed.request.request_status, 'executed');
});

test('approval is denied when the approver is not the named intended approver', async () => {
  const artifactPath = tempArtifactPath();
  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ dry_run: 'true' }),
    AUDIT_ARTIFACT_PATH: artifactPath,
  });

  await runCostCenterValidation({ env, api: { async listCostCenters() { throw Object.assign(new Error('Not Found'), { status: 404 }); } }, setProcessExitCode: false });

  const approvalApi = makeFakeTeamApi(approvalComment('someone-else'));
  const approved = await runCostCenterApproval({ env, api: approvalApi, setProcessExitCode: false });
  assert.equal(approved.approval.approval_status, 'denied');
});

test('validation fails when the CSV is missing a required column', async () => {
  const artifactPath = tempArtifactPath();
  const badCsv = ['cost_center,action', 'Platform Engineering,add'].join('\n');
  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ assignments_csv: badCsv }),
    AUDIT_ARTIFACT_PATH: artifactPath,
  });

  const validation = await runCostCenterValidation({
    env,
    api: { async listCostCenters() { throw Object.assign(new Error('Not Found'), { status: 404 }); } },
    setProcessExitCode: false,
  });
  assert.equal(validation.validation.is_valid, false);
  assert.equal(validation.validation.request.request_status, 'validation_failed');
});
