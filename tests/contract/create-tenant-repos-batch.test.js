'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateTenantRepoRequest } = require('../../src/workflow-support/validate-tenant-repo-request');
const {
  reconcileTenantRepoCreationBatch,
} = require('../../src/workflow-support/reconcile-tenant-repo-creation');

const REPOSITORIES_CSV = [
  'repository_name,repository_visibility,primary_contact,secondary_contact',
  'acme-platform-service,private,octocat,hubot',
  'acme-web,internal,octocat,',
  'acme-docs,public,alice@example.com,',
].join('\n');

function buildLegacyRegistryRecord(overrides = {}) {
  return {
    tenant_key: 'tenant-a',
    tenant_display_name: 'Tenant A',
    organization: 'octo-org',
    tenant_team_name: 'TenantA_Tenant',
    tenant_team_slug: 'tenanta-tenant',
    repo_admin_team_name: 'TenantA_RepoAdmin',
    repo_admin_team_slug: 'tenanta-repoadmin',
    ...overrides,
  };
}

function makeRegistry(prefix) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  return registryDir;
}

function writeRegistryRecord(registryDir, filename, record) {
  fs.writeFileSync(path.join(registryDir, filename), JSON.stringify(record, null, 2), 'utf8');
}

const TEAMS = [
  { slug: 'tenanta-tenant', parent: null },
  { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
];

function buildOptions({ registryDir, memberships, existingRepos = new Set() }) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => TEAMS,
    getMembershipForUser: async ({ teamSlug }) => {
      if (typeof memberships === 'function') {
        return memberships({ teamSlug });
      }
      return memberships[teamSlug] || { state: 'absent', membership: null };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async ({ repo }) => (existingRepos.has(repo)
      ? { exists: true, repository: { full_name: `octo-org/${repo}`, visibility: 'internal' } }
      : { exists: false, repository: null }),
  };
}

const REPO_ADMIN_MEMBER = {
  'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
  'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
};

// A plain repo-admin team member who is NOT the tenant admin: absent from the
// tenant top team, active member of the repo-admin team.
const REPO_ADMIN_MEMBER_ONLY = {
  'tenanta-tenant': { state: 'absent', membership: null },
  'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
};

function buildParsedRequest(overrides = {}) {
  return {
    organization: 'octo-org',
    tenant_name: 'Tenant A',
    repositories_csv: REPOSITORIES_CSV,
    designated_approver: 'org-owner-user',
    dry_run: 'true',
    justification: 'Batch tenant repositories',
    ...overrides,
  };
}

function buildIssue(number, login = 'tenant-admin-user') {
  return { number, user: { login } };
}

test('batch: multiple repositories in one request all become approval-ready', async () => {
  const registryDir = makeRegistry('ctr-batch-happy-');
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest(
    { parsedRequest: buildParsedRequest(), issue: buildIssue(1), repository: 'owner/repo' },
    buildOptions({ registryDir, memberships: REPO_ADMIN_MEMBER })
  );

  assert.equal(result.is_valid, true);
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.entries.length, 3);
  assert.equal(result.valid_entry_count, 3);
  assert.equal(result.rejected_entry_count, 0);
  assert.deepEqual(
    result.entries.map((entry) => entry.repository_name_normalized),
    ['acme-platform-service', 'acme-web', 'acme-docs']
  );
  assert.ok(result.entries.every((entry) => entry.action === 'create'));
  assert.equal(result.request.repository_entries.length, 3);
});

test('batch: a repo-admin team member passes the create-repo gate', async () => {
  const registryDir = makeRegistry('ctr-batch-repoadmin-');
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest(
    { parsedRequest: buildParsedRequest(), issue: buildIssue(2), repository: 'owner/repo' },
    buildOptions({ registryDir, memberships: REPO_ADMIN_MEMBER })
  );

  assert.equal(result.is_valid, true);
  assert.equal(result.requester_authorization.authorized, true);
  assert.equal(result.requester_authorization.is_repo_admin_team_member, true);
  assert.ok(result.entries.every((entry) => entry.authorized === true));
});

test('batch: a plain repo-admin member who is not the tenant admin resolves and is authorized', async () => {
  const registryDir = makeRegistry('ctr-batch-repoadmin-only-');
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest(
    { parsedRequest: buildParsedRequest(), issue: buildIssue(6), repository: 'owner/repo' },
    buildOptions({ registryDir, memberships: REPO_ADMIN_MEMBER_ONLY })
  );

  assert.equal(result.is_valid, true);
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'resolved');
  assert.equal(result.requester_authorization.authorized, true);
  assert.equal(result.requester_authorization.is_repo_admin_team_member, true);
  assert.equal(result.requester_authorization.is_tenant_top_team_maintainer, false);
  assert.equal(result.requester_authorization.authorization_path, 'tenant_repo_admin_team');
  assert.ok(result.entries.every((entry) => entry.authorized === true));
});

test('batch: the tenant top-team (Tenant Admin) maintainer passes the gate', async () => {
  const registryDir = makeRegistry('ctr-batch-topteam-');
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest(
    { parsedRequest: buildParsedRequest(), issue: buildIssue(3), repository: 'owner/repo' },
    buildOptions({ registryDir, memberships: REPO_ADMIN_MEMBER })
  );

  assert.equal(result.is_valid, true);
  assert.equal(result.requester_authorization.is_tenant_top_team_maintainer, true);
});

test('batch: a per-row already-existing repository is a no-op while others create', async () => {
  const registryDir = makeRegistry('ctr-batch-noop-');
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest(
    { parsedRequest: buildParsedRequest(), issue: buildIssue(4), repository: 'owner/repo' },
    buildOptions({ registryDir, memberships: REPO_ADMIN_MEMBER, existingRepos: new Set(['acme-web']) })
  );

  assert.equal(result.is_valid, true);
  const byName = Object.fromEntries(result.entries.map((entry) => [entry.repository_name_normalized, entry]));
  assert.equal(byName['acme-web'].action, 'noop');
  assert.equal(byName['acme-web'].repository_exists, true);
  assert.equal(byName['acme-platform-service'].action, 'create');
  assert.equal(byName['acme-docs'].action, 'create');
});

test('batch: a requester who fails the gate has every row rejected and the request fails', async () => {
  const registryDir = makeRegistry('ctr-batch-unauthorized-');
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest(
    { parsedRequest: buildParsedRequest(), issue: buildIssue(5), repository: 'owner/repo' },
    buildOptions({ registryDir, memberships: () => ({ state: 'absent', membership: null }) })
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'validation_failed');
  assert.equal(result.requester_authorization.authorized, false);
  assert.equal(result.valid_entry_count, 0);
  assert.ok(result.entries.every((entry) => entry.row_status === 'rejected'));
  assert.ok(result.entries.every((entry) => entry.failure_reason === 'unauthorized'));
});

test('batch reconcile: creates each missing repo, grants team admin, adds caller, sets props, persists registry', async () => {
  const registryDir = makeRegistry('ctr-batch-reconcile-happy-');
  writeRegistryRecord(registryDir, 'tenant-a.json', {
    tenantId: 'tenant-a',
    tenantName: 'Tenant A',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'tenanta-tenant',
        structure: [
          { team: 'tenanta-tenant', parent: null, type: 'root' },
          { team: 'tenanta-repoadmin', parent: 'tenanta-tenant', type: 'repo-admin' },
        ],
      },
      repositories: { owned: [] },
    },
  });

  const calls = [];
  const existingRepos = new Set(['acme-web']);
  const api = {
    getRepository: async ({ repo }) => (existingRepos.has(repo)
      ? { exists: true, repository: { full_name: `octo-org/${repo}` } }
      : { exists: false, repository: null }),
    createOrganizationRepository: async ({ name, visibility }) => {
      calls.push(`create:${name}:${visibility}`);
      return { exists: true, repository: { full_name: `octo-org/${name}` } };
    },
    addOrUpdateTeamRepositoryPermission: async ({ teamSlug, repo, permission }) => {
      calls.push(`grant:${teamSlug}:${repo}:${permission}`);
      return {};
    },
    addRepositoryCollaborator: async ({ username, repo, permission }) => {
      calls.push(`collab:${username}:${repo}:${permission}`);
      return {};
    },
    setRepositoryCustomProperties: async ({ repo, properties }) => {
      calls.push(`props:${repo}:${properties.map((property) => property.property_name).join('|')}`);
      return { updated_count: properties.length };
    },
  };

  const entries = [
    { repository_name_normalized: 'acme-platform-service', repository_name_input: 'acme-platform-service', repository_visibility: 'private', primary_contact: 'octocat', secondary_contact: 'hubot', row_status: 'valid', action: 'create', authorized: true, tenant_key: 'tenant-a' },
    { repository_name_normalized: 'acme-web', repository_name_input: 'acme-web', repository_visibility: 'internal', primary_contact: 'octocat', row_status: 'valid', action: 'noop', authorized: true, tenant_key: 'tenant-a' },
    { repository_name_normalized: 'acme-docs', repository_name_input: 'acme-docs', repository_visibility: 'public', primary_contact: 'alice@example.com', row_status: 'valid', action: 'create', authorized: true, tenant_key: 'tenant-a' },
  ];

  const outcome = await reconcileTenantRepoCreationBatch({
    api,
    organization: 'octo-org',
    tenantContext: { tenant_key: 'tenant-a', tenant_id: 'tenant-a', repo_admin_team_slug: 'tenanta-repoadmin', source_file: 'tenant-a.json' },
    requester_login: 'tenant-admin-user',
    entries,
    dry_run: false,
    boundary_revalidation_status: 'matched',
    registryDirectory: registryDir,
  });

  assert.equal(outcome.status, 'applied');
  assert.equal(outcome.applied.length, 2);
  assert.equal(outcome.skipped.length, 1);
  assert.equal(outcome.failed.length, 0);
  assert.deepEqual(calls, [
    'create:acme-platform-service:private',
    'grant:tenanta-repoadmin:acme-platform-service:admin',
    'collab:tenant-admin-user:acme-platform-service:admin',
    'props:acme-platform-service:primary_business_contact|secondary_business_contact',
    'create:acme-docs:public',
    'grant:tenanta-repoadmin:acme-docs:admin',
    'collab:tenant-admin-user:acme-docs:admin',
    'props:acme-docs:primary_business_contact',
  ]);

  const persisted = JSON.parse(fs.readFileSync(path.join(registryDir, 'tenant-a.json'), 'utf8'));
  assert.deepEqual(
    persisted.topology.repositories.owned.map((entry) => entry.repoName),
    ['acme-platform-service', 'acme-docs']
  );
});

test('batch reconcile: a failing row never aborts the other rows', async () => {
  const registryDir = makeRegistry('ctr-batch-reconcile-partial-');
  writeRegistryRecord(registryDir, 'tenant-a.json', {
    tenantId: 'tenant-a',
    tenantName: 'Tenant A',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'tenanta-tenant',
        structure: [
          { team: 'tenanta-tenant', parent: null, type: 'root' },
          { team: 'tenanta-repoadmin', parent: 'tenanta-tenant', type: 'repo-admin' },
        ],
      },
      repositories: { owned: [] },
    },
  });

  const api = {
    getRepository: async () => ({ exists: false, repository: null }),
    createOrganizationRepository: async ({ name, visibility }) => {
      if (name === 'acme-web') {
        const error = new Error('validation failed');
        error.status = 422;
        error.payload = { message: 'validation failed' };
        throw error;
      }
      return { exists: true, repository: { full_name: `octo-org/${name}`, visibility } };
    },
    addOrUpdateTeamRepositoryPermission: async () => ({}),
    addRepositoryCollaborator: async () => ({}),
    setRepositoryCustomProperties: async ({ properties }) => ({ updated_count: properties.length }),
  };

  const entries = [
    { repository_name_normalized: 'acme-platform-service', repository_visibility: 'private', primary_contact: 'octocat', row_status: 'valid', action: 'create', authorized: true, tenant_key: 'tenant-a' },
    { repository_name_normalized: 'acme-web', repository_visibility: 'internal', primary_contact: 'octocat', row_status: 'valid', action: 'create', authorized: true, tenant_key: 'tenant-a' },
    { repository_name_normalized: 'acme-docs', repository_visibility: 'public', primary_contact: 'octocat', row_status: 'valid', action: 'create', authorized: true, tenant_key: 'tenant-a' },
  ];

  const outcome = await reconcileTenantRepoCreationBatch({
    api,
    organization: 'octo-org',
    tenantContext: { tenant_key: 'tenant-a', tenant_id: 'tenant-a', repo_admin_team_slug: 'tenanta-repoadmin', source_file: 'tenant-a.json' },
    requester_login: 'tenant-admin-user',
    entries,
    dry_run: false,
    boundary_revalidation_status: 'matched',
    registryDirectory: registryDir,
  });

  assert.equal(outcome.status, 'partial_failure');
  assert.equal(outcome.applied.length, 2);
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].repository, 'acme-web');
  assert.equal(outcome.failed[0].failure_reason, 'http_422');
});

test('batch reconcile: an unauthorized row is failed without mutation', async () => {
  const calls = [];
  const api = {
    getRepository: async () => ({ exists: false, repository: null }),
    createOrganizationRepository: async ({ name }) => {
      calls.push(`create:${name}`);
      return { exists: true, repository: { full_name: `octo-org/${name}` } };
    },
    addOrUpdateTeamRepositoryPermission: async () => ({}),
    addRepositoryCollaborator: async () => ({}),
    setRepositoryCustomProperties: async () => ({ updated_count: 0 }),
  };

  const outcome = await reconcileTenantRepoCreationBatch({
    api,
    organization: 'octo-org',
    tenantContext: { tenant_key: 'tenant-a', repo_admin_team_slug: 'tenanta-repoadmin' },
    requester_login: 'tenant-admin-user',
    entries: [
      { repository_name_normalized: 'acme-blocked', row_status: 'rejected', action: 'reject', authorized: false, failure_reason: 'unauthorized' },
    ],
    dry_run: false,
    boundary_revalidation_status: 'matched',
  });

  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].failure_reason, 'unauthorized');
  assert.deepEqual(calls, []);
});

test('batch reconcile: dry-run reports intent without mutation', async () => {
  const calls = [];
  const api = {
    getRepository: async () => ({ exists: false, repository: null }),
    createOrganizationRepository: async ({ name }) => {
      calls.push(`create:${name}`);
      return { exists: true, repository: { full_name: `octo-org/${name}` } };
    },
    addOrUpdateTeamRepositoryPermission: async () => ({}),
    addRepositoryCollaborator: async () => ({}),
    setRepositoryCustomProperties: async () => ({ updated_count: 0 }),
  };

  const outcome = await reconcileTenantRepoCreationBatch({
    api,
    organization: 'octo-org',
    tenantContext: { tenant_key: 'tenant-a', repo_admin_team_slug: 'tenanta-repoadmin' },
    requester_login: 'tenant-admin-user',
    entries: [
      { repository_name_normalized: 'acme-platform-service', repository_visibility: 'private', primary_contact: 'octocat', row_status: 'valid', action: 'create', authorized: true },
    ],
    dry_run: true,
    boundary_revalidation_status: 'matched',
  });

  assert.equal(outcome.skipped.length, 1);
  assert.equal(outcome.skipped[0].reason, 'dry_run');
  assert.deepEqual(calls, []);
});

test('batch reconcile: boundary revalidation mismatch fails closed with no mutation', async () => {
  const calls = [];
  const api = {
    getRepository: async () => {
      calls.push('read');
      return { exists: false, repository: null };
    },
    createOrganizationRepository: async () => {
      calls.push('create');
      return { exists: true, repository: {} };
    },
  };

  const outcome = await reconcileTenantRepoCreationBatch({
    api,
    organization: 'octo-org',
    tenantContext: { tenant_key: 'tenant-a', repo_admin_team_slug: 'tenanta-repoadmin' },
    requester_login: 'tenant-admin-user',
    entries: [
      { repository_name_normalized: 'acme-platform-service', repository_visibility: 'private', primary_contact: 'octocat', row_status: 'valid', action: 'create', authorized: true },
    ],
    dry_run: false,
    boundary_revalidation_status: 'mismatched',
  });

  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].failure_reason, 'boundary_mismatch');
  assert.deepEqual(calls, []);
});
