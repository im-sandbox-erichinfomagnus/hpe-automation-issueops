'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateRepositoryRulesetRequest } = require('../../src/workflow-support/validate-repository-ruleset-request');

function canonicalTopologyRecord({ tenantId, tenantName, organization, ownedRepositories = [] }) {
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
      repositories: { owned: ownedRepositories },
    },
  };
}

function buildRegistry(records) {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-ruleset-delete-registry-'));
  const registryRecords = records || [
    canonicalTopologyRecord({
      tenantId: 'acme',
      tenantName: 'Acme Platform',
      organization: 'octo-org',
      ownedRepositories: ['acme-service-api'],
    }),
  ];
  for (const record of registryRecords) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
  }
  return registryDir;
}

function buildRequestInput(csvRows, overrides = {}) {
  return {
    rulesetOperation: 'delete',
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      rulesets_csv: ['repository,ruleset_name', ...csvRows].join('\n'),
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Retire stale rulesets.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 530,
      user: { login: overrides.requesterLogin || 'repo-admin-user' },
    },
  };
}

function buildOptions(registryDir, { adminRepos = ['acme-service-api', 'acme-web'], teamMemberships = {}, existingRulesets = {}, overrides = {} } = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getRepositoryCollaboratorPermission: async ({ repo }) => ({
      exists: true,
      permission: adminRepos.includes(repo) ? 'admin' : 'write',
      role_name: adminRepos.includes(repo) ? 'admin' : 'write',
    }),
    getMembershipForUser: async ({ teamSlug }) => teamMemberships[teamSlug] || { state: 'absent', membership: null },
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'org-owner-user' ? 'admin' : 'member', state: 'active' },
    }),
    getRepository: async () => ({ exists: true, repository: {} }),
    listRepositoryRulesets: async ({ repo }) => existingRulesets[repo] || [],
    ...overrides,
  };
}

const DEFAULT_EXISTING = {
  'acme-service-api': [{ id: 77, name: 'acme-main-protection', target: 'branch', enforcement: 'active' }],
  'acme-web': [{ id: 88, name: 'acme-web-protection', target: 'branch', enforcement: 'active' }],
};

test('a batch of delete rows across repos all become approval-ready for a repo admin', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput(['acme-service-api,acme-main-protection', 'acme-web,acme-web-protection']),
    buildOptions(registryDir, { existingRulesets: DEFAULT_EXISTING })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.plan.entries.length, 2);
  assert.equal(result.plan.valid_entry_count, 2);
  const byRepo = Object.fromEntries(result.plan.entries.map((entry) => [entry.repository, entry]));
  assert.equal(byRepo['acme-service-api'].action, 'delete');
  assert.equal(byRepo['acme-service-api'].existing_ruleset_id, 77);
  assert.equal(byRepo['acme-web'].action, 'delete');
});

test('delete per-row idempotent convergence: an absent ruleset name is a no-op', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput(['acme-service-api,acme-main-protection', 'acme-web,does-not-exist']),
    buildOptions(registryDir, { existingRulesets: DEFAULT_EXISTING })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  const byRepo = Object.fromEntries(result.plan.entries.map((entry) => [entry.repository, entry]));
  assert.equal(byRepo['acme-service-api'].action, 'delete');
  assert.equal(byRepo['acme-web'].action, 'noop');
  assert.equal(byRepo['acme-web'].ruleset_exists, false);
});

test('a delete row for a repo the requester does not admin fails while other rows pass', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput(['acme-service-api,acme-main-protection', 'acme-web,acme-web-protection']),
    buildOptions(registryDir, { adminRepos: ['acme-service-api'], existingRulesets: DEFAULT_EXISTING })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  const byRepo = Object.fromEntries(result.plan.entries.map((entry) => [entry.repository, entry]));
  assert.equal(byRepo['acme-service-api'].row_status, 'valid');
  assert.equal(byRepo['acme-web'].row_status, 'rejected');
  assert.equal(byRepo['acme-web'].failure_reason, 'unauthorized');
});

test('a tenant repo-admin team member is authorized to delete on a tenant-owned repo', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput(['acme-service-api,acme-main-protection'], { requesterLogin: 'tenant-repo-admin-member' }),
    buildOptions(registryDir, {
      adminRepos: [],
      teamMemberships: { 'acme-repo-admin': { state: 'active', membership: { role: 'maintainer' } } },
      existingRulesets: DEFAULT_EXISTING,
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.plan.entries[0].authorization_path, 'tenant_repo_admin_team');
  assert.equal(result.plan.entries[0].action, 'delete');
});
