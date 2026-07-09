'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateRepositoryRulesetRequest } = require('../../src/workflow-support/validate-repository-ruleset-request');

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
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-ruleset-delete-registry-'));
  const registryRecords = records || [
    canonicalTopologyRecord({ tenantId: 'acme', tenantName: 'Acme Platform', organization: 'octo-org' }),
  ];
  for (const record of registryRecords) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
  }
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    rulesetOperation: 'delete',
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      repository: 'acme-service-api',
      ruleset_name: 'acme-default-branch-protection',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Retire the deprecated branch protection ruleset.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 530,
      user: { login: overrides.requesterLogin || 'repo-admin-user' },
    },
  };
}

function buildOptions(registryDir, overrides = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getRepositoryCollaboratorPermission: async ({ username }) => ({
      exists: true,
      permission: username === 'repo-admin-user' ? 'admin' : 'write',
      role_name: username === 'repo-admin-user' ? 'admin' : 'write',
    }),
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    getRepository: async () => ({ exists: true, repository: {} }),
    listRepositoryRulesets: async () => ([
      { id: 77, name: 'acme-default-branch-protection', target: 'branch', enforcement: 'active' },
    ]),
    ...overrides,
  };
}

test('valid delete request by a repository admin becomes approval-ready', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.authorization_path, 'repository_admin');
  assert.equal(result.plan.ruleset_operation, 'delete');
  assert.equal(result.plan.planned_action, 'delete');
  assert.equal(result.ruleset_exists, true);
  assert.equal(result.existing_ruleset_id, 77);
  assert.equal(result.plan.ruleset_payload, null);
  assert.match(result.request.context_marker, /^repository-ruleset-context:/);
});

test('delete converges to a no-op when the named ruleset is absent', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listRepositoryRulesets: async () => ([]),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.ruleset_exists, false);
  assert.equal(result.plan.planned_action, 'noop');
});

test('a delete requester without admin permission on the target repository is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput({ requesterLogin: 'writer-user' }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.authorization_path, 'none');
  assert.equal(
    result.errors.some((error) => /does not have admin permission on repository/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a delete on a repository not in the registry still works for a repository admin', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput({
      parsedRequest: {
        tenant_name: '',
        repository: 'imported-legacy-service',
      },
    }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.authorization_path, 'repository_admin');
  assert.equal(result.canonical_tenant_context, null);
});
