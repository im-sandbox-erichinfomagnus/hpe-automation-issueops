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
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-ruleset-registry-'));
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
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      repository: 'acme-service-api',
      ruleset_name: 'acme-default-branch-protection',
      target: 'branch',
      ref_name_pattern: '~DEFAULT_BRANCH',
      enforcement: 'active',
      require_pull_request: 'true',
      block_force_pushes: 'true',
      require_linear_history: 'false',
      restrict_deletions: 'true',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Enforce branch protection on the tenant service repository.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 520,
      user: { login: overrides.requesterLogin || 'repo-admin-user' },
    },
  };
}

function buildOptions(registryDir, overrides = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    // Requester holds admin permission on the target repository by default.
    getRepositoryCollaboratorPermission: async ({ username }) => ({
      exists: true,
      permission: username === 'repo-admin-user' ? 'admin' : 'write',
      role_name: username === 'repo-admin-user' ? 'admin' : 'write',
    }),
    // Tenant top-team maintainer path: nobody is a maintainer by default.
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    getRepository: async () => ({ exists: true, repository: {} }),
    listRepositoryRulesets: async () => ([]),
    ...overrides,
  };
}

test('valid create request by a repository admin becomes approval-ready', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.authorization_path, 'repository_admin');
  assert.equal(result.is_repository_admin, true);
  assert.equal(result.plan.ruleset_operation, 'create');
  assert.equal(result.plan.planned_action, 'create');
  assert.equal(result.plan.repository, 'acme-service-api');
  assert.equal(result.plan.ruleset_payload.name, 'acme-default-branch-protection');
  assert.equal(result.plan.ruleset_payload.target, 'branch');
  assert.equal(result.plan.ruleset_payload.enforcement, 'active');
  const ruleTypes = result.plan.ruleset_payload.rules.map((rule) => rule.type).sort();
  assert.deepEqual(ruleTypes, ['deletion', 'non_fast_forward', 'pull_request']);
  assert.deepEqual(result.plan.ruleset_payload.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.match(result.request.context_marker, /^repository-ruleset-context:/);
});

test('a requester without admin permission on the target repository is rejected', async () => {
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

test('a repository not in the registry still validates for a repository admin', async () => {
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
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'no_match');
});

test('a tenant top-team maintainer is authorized for a tenant repository without repo admin', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput({ requesterLogin: 'tenant-owner' }),
    buildOptions(registryDir, {
      getRepositoryCollaboratorPermission: async () => ({ exists: true, permission: 'write', role_name: 'write' }),
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (/-root$/.test(teamSlug) && username === 'tenant-owner') {
          return { state: 'active', membership: { role: 'maintainer' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.authorization_path, 'tenant_top_team_maintainer');
  assert.equal(result.is_repository_admin, false);
  assert.equal(result.is_tenant_top_maintainer, true);
});

test('create converges to a no-op when a ruleset of the same name already exists', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listRepositoryRulesets: async () => ([
        { id: 42, name: 'acme-default-branch-protection', target: 'branch', enforcement: 'active' },
      ]),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.ruleset_exists, true);
  assert.equal(result.existing_ruleset_id, 42);
  assert.equal(result.plan.planned_action, 'noop');
});

test('a create request with an invalid enforcement value is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput({ parsedRequest: { enforcement: 'paranoid' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /enforcement 'paranoid' is invalid/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});
