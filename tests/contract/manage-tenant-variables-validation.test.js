'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateTenantVariablesRequest } = require('../../src/workflow-support/validate-tenant-variables-request');

function canonicalTopologyRecord({ tenantId, tenantName, organization }) {
  const slug = tenantId;
  return {
    tenantId,
    tenantName,
    tenantType: 'application',
    organization,
    topology: {
      organization: { orgName: organization },
      teams: {
        tenantRootTeam: `${slug}-root`,
        structure: [
          { team: `${slug}-root`, parent: null, type: 'root' },
          { team: `${slug}-admin`, parent: `${slug}-root`, type: 'admin' },
          { team: `${slug}-repo-admin`, parent: `${slug}-root`, type: 'repo-admin' },
        ],
      },
    },
  };
}

function buildRegistry(records) {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-variables-registry-'));
  const registryRecords = records || [
    canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' }),
  ];
  for (const record of registryRecords) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
  }
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      variable_operation: 'create',
      variable_name: 'API_BASE_URL',
      variable_value: 'https://api.contoso.example.com',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Shared endpoint for tenant CI.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 420,
      user: { login: overrides.requesterLogin || 'tenant-cicd-admin' },
    },
  };
}

function buildOptions(registryDir, overrides = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([]),
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (/-root$/.test(teamSlug) && username === 'tenant-cicd-admin') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'absent', membership: null };
    },
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    listOrganizationVariables: async () => ([]),
    ...overrides,
  };
}

test('valid create request by a tenant top-team maintainer becomes approval-ready', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantVariablesRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.plan.entries.length, 1);
  assert.equal(result.plan.entries[0].name, 'CONTOSOUK_API_BASE_URL');
  assert.equal(result.plan.entries[0].action, 'create');
  assert.equal(result.request.variable_entries[0].name, 'CONTOSOUK_API_BASE_URL');
  assert.match(result.request.context_marker, /^tenant-variable-context:/);
});

test('re-run against an already-satisfied variable converges as a no-op plan', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantVariablesRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listOrganizationVariables: async () => ([
        { name: 'CONTOSOUK_API_BASE_URL', value: 'https://api.contoso.example.com', visibility: 'all' },
      ]),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.plan.entries[0].action, 'noop');
});

test('a requester who is only a top-team member is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantVariablesRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (/-root$/.test(teamSlug) && username === 'tenant-cicd-admin') {
          return { state: 'active', membership: { role: 'member' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /not an active maintainer of the tenant top team/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a variable name targeting a different tenant prefix is rejected', async () => {
  const registryDir = buildRegistry([
    canonicalTopologyRecord({ tenantId: 'alpha', tenantName: 'Alpha', organization: 'octo-org' }),
    canonicalTopologyRecord({ tenantId: 'beta', tenantName: 'Beta', organization: 'octo-org' }),
  ]);

  const result = await validateTenantVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        tenant_name: 'Alpha',
        variable_operation: 'create',
        variable_name: 'BETA_TOKEN',
        variable_value: 'secret',
      },
    }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /targets the namespace of tenant 'Beta'/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a delete request that carries a value is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        variable_operation: 'delete',
        variable_name: 'API_BASE_URL',
        variable_value: 'should-not-be-here',
      },
    }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /must not include a value for the delete operation/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('an invalid variable operation is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantVariablesRequest(
    buildRequestInput({ parsedRequest: { variable_operation: 'purge' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /operation 'purge' is invalid/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});
