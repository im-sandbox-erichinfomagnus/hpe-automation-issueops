'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateCostCenterRequest } = require('../../src/workflow-support/validate-cost-center-request');
const { parseCostCenterRequest } = require('../../src/workflow-support/parse-cost-center-request');

function buildRequest(csv, overrides = {}) {
  return parseCostCenterRequest({
    parsedRequest: {
      enterprise: 'octo-enterprise',
      designated_approver: 'billing-manager',
      dry_run: 'false',
      justification: 'cleanup',
      cost_centers: csv,
      ...overrides,
    },
    issue: { number: 42, user: { login: 'requester' } },
  });
}

function liveOptions(state) {
  return {
    listCostCenters: async () => state.map((c) => ({ ...c, resources: c.resources || [] })),
    getCostCenter: async ({ costCenterId }) => {
      const cc = state.find((c) => String(c.id) === String(costCenterId));
      return cc ? { exists: true, cost_center: { ...cc, resources: cc.resources || [] } } : { exists: false, cost_center: null };
    },
  };
}

const baseState = [
  { id: 'cc-ai', name: 'AI Model Routing', resources: [] },
  { id: 'cc-old', name: 'Retired Sandbox', resources: [] },
  { id: 'cc-busy', name: 'Busy Center', resources: [{ type: 'Organization', name: 'octo' }] },
];

test('create/rename/delete classify correctly against live state', async () => {
  const result = await validateCostCenterRequest(
    buildRequest([
      'cost_center,action,new_name,cost_center_id,force',
      'Platform Engineering,create,,,',
      'AI Model Routing,rename,AI Platform Routing,,',
      'Retired Sandbox,delete,,,false',
    ].join('\n')),
    liveOptions(baseState)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.live_access, true);
  const rows = Object.fromEntries(result.requested_changes.map((r) => [r.source_row_number, r]));
  assert.equal(rows[1].desired_action, 'create_cost_center');
  assert.equal(rows[2].desired_action, 'rename_cost_center');
  assert.equal(rows[2].resolved_cost_center_id, 'cc-ai');
  assert.equal(rows[3].desired_action, 'delete_cost_center');
  assert.deepEqual(result.counts, { create: 1, rename: 1, delete: 1, noop: 0, rejected: 0 });
});

test('create of an existing cost center is a no-op', async () => {
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action\nAI Model Routing,create'),
    liveOptions(baseState)
  );
  assert.equal(result.requested_changes[0].validation_status, 'noop');
});

test('delete of a non-empty cost center is blocked without force, allowed with force', async () => {
  const blocked = await validateCostCenterRequest(
    buildRequest('cost_center,action,new_name,cost_center_id,force\nBusy Center,delete,,,false'),
    liveOptions(baseState)
  );
  assert.equal(blocked.requested_changes[0].validation_status, 'rejected');
  assert.equal(blocked.requested_changes[0].failure_reason, 'delete_blocked');
  assert.match(blocked.requested_changes[0].detail, /octo/);

  const forced = await validateCostCenterRequest(
    buildRequest('cost_center,action,new_name,cost_center_id,force\nBusy Center,delete,,,true'),
    liveOptions(baseState)
  );
  assert.equal(forced.requested_changes[0].desired_action, 'delete_cost_center');
});

test('delete of a missing cost center converges as no-op', async () => {
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action\nGhost Center,delete'),
    liveOptions(baseState)
  );
  assert.equal(result.requested_changes[0].validation_status, 'noop');
});

test('ambiguous name without id is rejected and lists candidate ids', async () => {
  const state = [
    { id: 'cc-1', name: 'Shared', resources: [] },
    { id: 'cc-2', name: 'Shared', resources: [] },
  ];
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action\nShared,delete'),
    liveOptions(state)
  );
  assert.equal(result.requested_changes[0].failure_reason, 'ambiguous_cost_center');
  assert.match(result.requested_changes[0].detail, /cc-1/);
  assert.match(result.requested_changes[0].detail, /cc-2/);
});

test('id disambiguates a same-named cost center', async () => {
  const state = [
    { id: 'cc-1', name: 'Shared', resources: [] },
    { id: 'cc-2', name: 'Shared', resources: [] },
  ];
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action,new_name,cost_center_id,force\nShared,rename,Shared Renamed,cc-2,'),
    liveOptions(state)
  );
  assert.equal(result.requested_changes[0].desired_action, 'rename_cost_center');
  assert.equal(result.requested_changes[0].resolved_cost_center_id, 'cc-2');
});

test('rename to an existing name is rejected as name_taken', async () => {
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action,new_name\nRetired Sandbox,rename,AI Model Routing'),
    liveOptions(baseState)
  );
  assert.equal(result.requested_changes[0].failure_reason, 'name_taken');
});

test('rename to the current name is a no-op', async () => {
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action,new_name\nAI Model Routing,rename,AI Model Routing'),
    liveOptions(baseState)
  );
  assert.equal(result.requested_changes[0].validation_status, 'noop');
});

test('conflicting rows targeting the same cost center are both rejected', async () => {
  const result = await validateCostCenterRequest(
    buildRequest([
      'cost_center,action,new_name',
      'AI Model Routing,rename,AI Platform Routing',
      'AI Model Routing,delete,',
    ].join('\n')),
    liveOptions(baseState)
  );
  const rows = result.requested_changes;
  assert.equal(rows.every((r) => r.failure_reason === 'conflicting_rows'), true, JSON.stringify(rows));
});

test('invalid action and missing fields are rejected', async () => {
  const result = await validateCostCenterRequest(
    buildRequest([
      'cost_center,action,new_name',
      'X,archive,',
      'Y,rename,',
    ].join('\n')),
    liveOptions(baseState)
  );
  assert.equal(result.requested_changes[0].failure_reason, 'invalid_action');
  assert.equal(result.requested_changes[1].failure_reason, 'missing_new_name');
});

test('missing enterprise or approver fails validation structurally', async () => {
  const result = await validateCostCenterRequest(
    buildRequest('cost_center,action\nX,create', { enterprise: '', designated_approver: '' }),
    liveOptions(baseState)
  );
  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'validation_failed');
  assert.equal(result.errors.some((e) => /Enterprise slug is required/.test(e)), true);
  assert.equal(result.errors.some((e) => /designated approver is required/.test(e)), true);
});

test('without live access the plan is unverified and approval-ready (fail-soft)', async () => {
  const result = await validateCostCenterRequest(
    buildRequest([
      'cost_center,action,new_name,cost_center_id,force',
      'Platform Engineering,create,,,',
      'AI Model Routing,rename,AI Platform Routing,cc-ai,',
    ].join('\n')),
    {}
  );
  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.live_access, false);
  assert.equal(result.requested_changes[0].validation_status, 'unverified');
  assert.equal(result.warnings.some((w) => /Could not list live cost centers/i.test(w)), true);
});
