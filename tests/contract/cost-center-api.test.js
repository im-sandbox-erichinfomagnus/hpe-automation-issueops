'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGitHubCostCenterApi,
  mapCostCenter,
} = require('../../src/workflow-support/github-cost-center-api');

function createFakeFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];

  async function fetchImpl(url, options = {}) {
    const config = queue.length > 1 ? queue.shift() : queue[0];
    calls.push({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : undefined,
    });

    const ok = config.ok !== undefined ? config.ok : true;
    const status = config.status !== undefined ? config.status : 200;

    return {
      ok,
      status,
      headers: config.headers || {},
      async text() {
        if (typeof config.text === 'string') {
          return config.text;
        }
        if (config.json === undefined) {
          return '';
        }
        return JSON.stringify(config.json);
      },
    };
  }

  return { fetchImpl, calls };
}

test('createCostCenter posts the cost center name and returns the mapped record', async () => {
  const { fetchImpl, calls } = createFakeFetch({
    ok: true,
    status: 201,
    json: { id: 'cc-1', name: 'Engineering', state: 'active' },
  });
  const api = createGitHubCostCenterApi({ token: 'test-token', fetchImpl });

  const result = await api.createCostCenter({ enterprise: 'acme', name: 'Engineering' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(
    calls[0].url,
    'https://api.github.com/enterprises/acme/settings/billing/cost-centers'
  );
  assert.deepEqual(calls[0].body, { name: 'Engineering' });
  assert.equal(result.id, 'cc-1');
  assert.equal(result.name, 'Engineering');
});

test('addResource posts only the non-empty resource arrays', async () => {
  const { fetchImpl, calls } = createFakeFetch({ ok: true, status: 200, json: { message: 'ok' } });
  const api = createGitHubCostCenterApi({ token: 'test-token', fetchImpl });

  const result = await api.addResource({
    enterprise: 'acme',
    costCenterId: 'abc123',
    users: ['octocat'],
  });

  assert.equal(calls[0].method, 'POST');
  assert.equal(
    calls[0].url,
    'https://api.github.com/enterprises/acme/settings/billing/cost-centers/abc123/resource'
  );
  assert.deepEqual(calls[0].body, { users: ['octocat'] });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'organizations'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].body, 'repositories'), false);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});

test('removeResource sends DELETE to the resource path with a body', async () => {
  const { fetchImpl, calls } = createFakeFetch({ ok: true, status: 200, json: { message: 'ok' } });
  const api = createGitHubCostCenterApi({ token: 'test-token', fetchImpl });

  const result = await api.removeResource({
    enterprise: 'acme',
    costCenterId: 'abc123',
    users: ['octocat'],
  });

  assert.equal(calls[0].method, 'DELETE');
  assert.equal(
    calls[0].url,
    'https://api.github.com/enterprises/acme/settings/billing/cost-centers/abc123/resource'
  );
  assert.deepEqual(calls[0].body, { users: ['octocat'] });
  assert.equal(result.ok, true);
});

test('getCostCenter reports a missing cost center on a 404 response', async () => {
  const { fetchImpl } = createFakeFetch({ ok: false, status: 404, json: { message: 'Not Found' } });
  const api = createGitHubCostCenterApi({ token: 'test-token', fetchImpl });

  const result = await api.getCostCenter({ enterprise: 'acme', costCenterId: 'missing' });

  assert.deepEqual(result, { exists: false, costCenter: null });
});

test('requests carry the workflow authorization and api version headers', async () => {
  const { fetchImpl, calls } = createFakeFetch({ ok: true, status: 200, json: { costCenters: [] } });
  const api = createGitHubCostCenterApi({ token: 'test-token', fetchImpl });

  await api.listCostCenters({ enterprise: 'acme' });

  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('listCostCenters normalizes an object payload that wraps the cost centers array', async () => {
  const { fetchImpl, calls } = createFakeFetch({
    ok: true,
    status: 200,
    json: {
      costCenters: [
        { id: 'cc-1', name: 'Engineering', state: 'active' },
        { id: 'cc-2', name: 'Design', state: 'archived' },
      ],
    },
  });
  const api = createGitHubCostCenterApi({ token: 'test-token', fetchImpl });

  const result = await api.listCostCenters({ enterprise: 'acme', state: 'active' });

  assert.equal(
    calls[0].url,
    'https://api.github.com/enterprises/acme/settings/billing/cost-centers?state=active'
  );
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], mapCostCenter({ id: 'cc-1', name: 'Engineering', state: 'active' }));
});
