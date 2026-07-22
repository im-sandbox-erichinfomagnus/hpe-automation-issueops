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
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-ruleset-registry-'));
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

function createRow(repository, rulesetName, extra = '') {
  return `${repository},${rulesetName},branch,~DEFAULT_BRANCH,active,true,true,false,true${extra}`;
}

function buildRequestInput(csvRows, overrides = {}) {
  return {
    rulesetOperation: 'create',
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      target: 'branch',
      enforcement: 'active',
      rulesets_csv: [
        'repository,ruleset_name,target,ref_name_pattern,enforcement,require_pull_request,block_force_pushes,require_linear_history,restrict_deletions',
        ...csvRows,
      ].join('\n'),
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Batch protection.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 520,
      user: { login: overrides.requesterLogin || 'repo-admin-user' },
    },
  };
}

// adminRepos: set of repos where the requester is admin. teamMemberships: map teamSlug -> {state, role}
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

test('a batch of create rows across repos all become approval-ready for a repo admin', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-service-api', 'acme-main-protection'), createRow('acme-web', 'acme-web-protection')]),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.plan.entries.length, 2);
  assert.equal(result.plan.valid_entry_count, 2);
  for (const entry of result.plan.entries) {
    assert.equal(entry.row_status, 'valid');
    assert.equal(entry.action, 'create');
    assert.equal(entry.authorization_path, 'repository_admin');
    assert.equal(entry.ruleset_payload.name, entry.ruleset_name);
  }
  assert.match(result.request.context_marker, /^repository-ruleset-context:/);
});

test('a row for a repo the requester does not admin fails while the other rows pass', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-service-api', 'acme-main-protection'), createRow('acme-web', 'acme-web-protection')]),
    // requester admins only acme-service-api; acme-web is not tenant-owned so no team path
    buildOptions(registryDir, { adminRepos: ['acme-service-api'] })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  const byRepo = Object.fromEntries(result.plan.entries.map((entry) => [entry.repository, entry]));
  assert.equal(byRepo['acme-service-api'].row_status, 'valid');
  assert.equal(byRepo['acme-service-api'].authorized, true);
  assert.equal(byRepo['acme-web'].row_status, 'rejected');
  assert.equal(byRepo['acme-web'].authorized, false);
  assert.equal(byRepo['acme-web'].failure_reason, 'unauthorized');
  assert.equal(result.plan.valid_entry_count, 1);
  assert.equal(result.plan.rejected_entry_count, 1);
});

test('a tenant repo-admin team member is authorized for a tenant-owned repo without direct repo admin', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-service-api', 'acme-main-protection')], { requesterLogin: 'tenant-repo-admin-member' }),
    buildOptions(registryDir, {
      adminRepos: [], // not a direct repo admin anywhere
      teamMemberships: {
        'acme-repo-admin': { state: 'active', membership: { role: 'member' } },
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  const entry = result.plan.entries[0];
  assert.equal(entry.authorized, true);
  assert.equal(entry.authorization_path, 'tenant_repo_admin_team');
  assert.equal(entry.tenant_key, 'acme');
});

test('a tenant top-team maintainer is authorized for a tenant-owned repo', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-service-api', 'acme-main-protection')], { requesterLogin: 'tenant-owner' }),
    buildOptions(registryDir, {
      adminRepos: [],
      teamMemberships: {
        'acme-root': { state: 'active', membership: { role: 'maintainer' } },
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.plan.entries[0].authorization_path, 'tenant_top_team_maintainer');
});

test('per-row idempotent convergence: an existing ruleset name is a no-op', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-service-api', 'acme-main-protection'), createRow('acme-web', 'acme-web-protection')]),
    buildOptions(registryDir, {
      existingRulesets: {
        'acme-service-api': [{ id: 42, name: 'acme-main-protection', target: 'branch', enforcement: 'active' }],
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  const byRepo = Object.fromEntries(result.plan.entries.map((entry) => [entry.repository, entry]));
  assert.equal(byRepo['acme-service-api'].action, 'noop');
  assert.equal(byRepo['acme-service-api'].ruleset_exists, true);
  assert.equal(byRepo['acme-service-api'].existing_ruleset_id, 42);
  assert.equal(byRepo['acme-web'].action, 'create');
});

test('a batch where every row is unauthorized fails the whole request', async () => {
  const registryDir = buildRegistry();
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-web', 'acme-web-protection')]),
    buildOptions(registryDir, { adminRepos: [] })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /nothing to execute/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('an invalid enforcement in one row rejects only that row', async () => {
  const registryDir = buildRegistry();
  const badRow = 'acme-web,acme-web-protection,branch,~DEFAULT_BRANCH,paranoid,true,true,false,true';
  const result = await validateRepositoryRulesetRequest(
    buildRequestInput([createRow('acme-service-api', 'acme-main-protection'), badRow]),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  const byRepo = Object.fromEntries(result.plan.entries.map((entry) => [entry.repository, entry]));
  assert.equal(byRepo['acme-service-api'].row_status, 'valid');
  assert.equal(byRepo['acme-web'].row_status, 'rejected');
  assert.equal(byRepo['acme-web'].failure_reason, 'invalid_enforcement');
});
