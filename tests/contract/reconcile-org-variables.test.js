'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { reconcileOrgVariables } = require('../../src/workflow-support/reconcile-org-variables');

function buildApi(options = {}) {
  const store = new Map(options.initialVariables || []);
  const calls = { create: [], update: [], delete: [] };
  return {
    calls,
    store,
    getOrganizationVariable: async ({ name }) => {
      if (options.readError) {
        throw options.readError;
      }
      return store.has(name)
        ? { exists: true, variable: { name, value: store.get(name), visibility: 'all' } }
        : { exists: false, variable: null };
    },
    createOrganizationVariable: async ({ name, value, visibility }) => {
      if (options.createError) {
        throw options.createError;
      }
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

test('mixed per-row operations apply create, update, delete, and noop in one run', async () => {
  const api = buildApi({
    initialVariables: [
      ['DEPLOY_CHANNEL', 'canary'],
      ['RETIRED_FLAG', 'true'],
      ['SATISFIED_FLAG', 'enabled'],
    ],
  });

  const outcome = await reconcileOrgVariables({
    api,
    organization: 'octo-org',
    entries: [
      { name: 'NEW_FLAG', value: 'enabled', operation: 'create', visibility: 'private' },
      { name: 'DEPLOY_CHANNEL', value: 'stable', operation: 'update', visibility: '' },
      { name: 'RETIRED_FLAG', value: null, operation: 'delete', visibility: '' },
      { name: 'SATISFIED_FLAG', value: 'enabled', operation: 'create', visibility: 'all' },
    ],
    dry_run: false,
    boundary_revalidation_status: 'matched',
  });

  assert.equal(outcome.status, 'applied');
  assert.deepEqual(outcome.applied, [
    { name: 'NEW_FLAG', action: 'created' },
    { name: 'DEPLOY_CHANNEL', action: 'updated' },
    { name: 'RETIRED_FLAG', action: 'deleted' },
  ]);
  assert.deepEqual(outcome.skipped, [
    { name: 'SATISFIED_FLAG', action: 'noop', reason: 'already_satisfied' },
  ]);
  assert.deepEqual(api.calls.create, ['NEW_FLAG=enabled:private']);
  assert.deepEqual(api.calls.update, ['DEPLOY_CHANNEL=stable']);
  assert.deepEqual(api.calls.delete, ['RETIRED_FLAG']);
});

test('dry-run reports intent without any mutation call', async () => {
  const api = buildApi({ initialVariables: [['RETIRED_FLAG', 'true']] });

  const outcome = await reconcileOrgVariables({
    api,
    organization: 'octo-org',
    entries: [
      { name: 'NEW_FLAG', value: 'enabled', operation: 'create', visibility: 'all' },
      { name: 'RETIRED_FLAG', value: null, operation: 'delete', visibility: '' },
    ],
    dry_run: true,
    boundary_revalidation_status: 'matched',
  });

  assert.equal(outcome.status, 'applied');
  assert.deepEqual(outcome.applied, []);
  assert.deepEqual(outcome.skipped, [
    { name: 'NEW_FLAG', action: 'create', reason: 'dry_run' },
    { name: 'RETIRED_FLAG', action: 'delete', reason: 'dry_run' },
  ]);
  assert.deepEqual(api.calls.create, []);
  assert.deepEqual(api.calls.delete, []);
});

test('boundary mismatch blocks every entry without reads or mutations', async () => {
  const api = buildApi();

  const outcome = await reconcileOrgVariables({
    api,
    organization: 'octo-org',
    entries: [{ name: 'NEW_FLAG', value: 'enabled', operation: 'create', visibility: 'all' }],
    dry_run: false,
    boundary_revalidation_status: 'mismatched',
  });

  assert.equal(outcome.status, 'blocked');
  assert.deepEqual(outcome.failed, [
    { name: 'NEW_FLAG', action: 'reject', failure_reason: 'boundary_mismatch' },
  ]);
  assert.deepEqual(api.calls.create, []);
});

test('deleting an absent variable converges as a no-op', async () => {
  const api = buildApi();

  const outcome = await reconcileOrgVariables({
    api,
    organization: 'octo-org',
    entries: [{ name: 'ABSENT_FLAG', value: null, operation: 'delete', visibility: '' }],
    dry_run: false,
    boundary_revalidation_status: 'matched',
  });

  assert.equal(outcome.status, 'applied');
  assert.deepEqual(outcome.skipped, [
    { name: 'ABSENT_FLAG', action: 'noop', reason: 'already_absent' },
  ]);
  assert.deepEqual(api.calls.delete, []);
});

test('API failures are classified and yield partial failure', async () => {
  const api = buildApi({ createError: Object.assign(new Error('boom'), { status: 500 }) });

  const outcome = await reconcileOrgVariables({
    api,
    organization: 'octo-org',
    entries: [
      { name: 'NEW_FLAG', value: 'enabled', operation: 'create', visibility: 'all' },
      { name: 'ABSENT_FLAG', value: null, operation: 'delete', visibility: '' },
    ],
    dry_run: false,
    boundary_revalidation_status: 'matched',
  });

  assert.equal(outcome.status, 'partial_failure');
  assert.deepEqual(outcome.failed, [
    { name: 'NEW_FLAG', action: 'create', failure_reason: 'http_500' },
  ]);
  assert.deepEqual(outcome.skipped, [
    { name: 'ABSENT_FLAG', action: 'noop', reason: 'already_absent' },
  ]);
});
