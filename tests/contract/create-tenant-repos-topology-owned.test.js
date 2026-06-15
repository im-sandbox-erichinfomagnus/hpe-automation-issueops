'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { reconcileTenantRepoCreation } = require('../../src/workflow-support/reconcile-tenant-repo-creation');
const { persistOwnedRepositoryEntry } = require('../../src/workflow-support/reconcile-tenant-repo-creation');
const { validateTenantRepoRequest } = require('../../src/workflow-support/validate-tenant-repo-request');

test('US4 owned entry candidate includes required fields and deterministic defaults', () => {
  const reconciliation = reconcileTenantRepoCreation({
    request: {
      organization: 'octo-org',
      repository_name_input: 'Acme Platform Service',
      repository_name_normalized: 'acme-platform-service',
      repository_visibility: 'internal',
      dry_run: true,
    },
    canonical_tenant_context: {
      topology_mode: 'canonical',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      repo_admin_team_slug: 'tenanta-repoadmin',
      owned_repositories: [],
      owned_repositories_status: 'array',
    },
    organization_visible: true,
    repository_state: { exists: false, repository: null },
    current_repo_admin_permission: 'none',
    boundary_revalidation_status: 'matched',
    dry_run: true,
  });

  assert.equal(reconciliation.owned_topology_action, 'append_owned_entry');
  assert.deepEqual(reconciliation.owned_entry_candidate, {
    repoName: 'acme-platform-service',
    tenantId: 'tenant-a',
    visibility: 'internal',
    repoType: 'service',
    lifecycle: 'active',
    migrationWave: 'wave-1',
    source: 'ghec',
    adminTeam: 'tenanta-repoadmin',
  });
  assert.deepEqual(reconciliation.defaults_applied, {
    repoType: true,
    lifecycle: true,
    migrationWave: true,
    source: true,
  });
});

test('US4 visibility remains required and is never defaulted', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-visibility-required-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
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
        accessModel: {
          enforcement: 'tenant-boundary',
          roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
        },
        repositories: { owned: [] },
      },
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 401,
      user: { login: 'tenant-admin-user' },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'tenanta-tenant') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'active', membership: { role: 'member' } };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async () => ({ exists: false, repository: null }),
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.validation_findings.visibility_validation_status, 'missing_visibility');
  assert.match(result.errors.join('\n'), /must be provided/i);
});

test('US4 persistence initializes owned array when absent and appends entry', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-owned-init-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  const registryPath = path.join(registryDir, 'tenant-a.json');
  fs.writeFileSync(
    registryPath,
    JSON.stringify({
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
      },
    }, null, 2),
    'utf8'
  );

  const persistence = persistOwnedRepositoryEntry({
    request: {
      tenant_key: 'tenant-a',
      repository_name_input: 'Acme Platform Service',
      repository_name_normalized: 'acme-platform-service',
      repository_visibility: 'private',
    },
    tenantContext: {
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      repo_admin_team_slug: 'tenanta-repoadmin',
      source_file: 'tenant-a.json',
    },
    ownedEntry: {
      repoName: 'acme-platform-service',
      tenantId: 'tenant-a',
      visibility: 'private',
      repoType: 'service',
      lifecycle: 'active',
      migrationWave: 'wave-1',
      source: 'ghec',
      adminTeam: 'tenanta-repoadmin',
    },
    registryDirectory: registryDir,
  });

  assert.equal(persistence.status, 'appended');
  const persistedRecord = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(Array.isArray(persistedRecord.topology.repositories.owned), true);
  assert.equal(persistedRecord.topology.repositories.owned.length, 1);
});
