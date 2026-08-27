'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateTenantRepoRequest } = require('../../src/workflow-support/validate-tenant-repo-request');
const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');

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

function buildCanonicalRegistryRecord(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    tenantName: 'Tenant A',
    tenantType: 'application',
    topology: {
      organization: {
        orgName: 'octo-org',
      },
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
      repositories: {
        owned: [],
      },
    },
    externalMappings: {},
    metadata: {},
    ...overrides,
  };
}

function writeRegistryRecord(registryDir, filename, record) {
  fs.writeFileSync(path.join(registryDir, filename), JSON.stringify(record, null, 2), 'utf8');
}

function buildTenantRepoApiOptions({ registryDir, teams, memberships, repositoryState, extraOptions = {} }) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => teams,
    getMembershipForUser: async ({ teamSlug }) => {
      if (typeof memberships === 'function') {
        return memberships({ teamSlug });
      }

      return memberships[teamSlug] || { state: 'active', membership: { role: 'member' } };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async () => repositoryState || ({ exists: false, repository: null }),
    ...extraOptions,
  };
}

function buildParsedRequest(overrides = {}) {
  return {
    organization: 'octo-org',
    tenant_name: 'Tenant A',
    repository_name: 'acme-platform-service',
    repository_visibility: 'private',
    primary_contact: 'octocat',
    designated_approver: 'org-owner-user',
    dry_run: 'true',
    justification: 'Test request',
    ...overrides,
  };
}

function buildIssue(number) {
  return {
    number,
    user: {
      login: 'tenant-admin-user',
    },
  };
}

test('create-tenant-repos contract scaffold references expected lifecycle states', () => {
  const contractPath = path.join(
    __dirname,
    '..',
    '..',
    'specs',
    '019-create-tenant-repos',
    'contracts',
    'create-tenant-repos-workflow.yaml'
  );
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /awaiting_approval/i);
  assert.match(contract, /approved/i);
  assert.match(contract, /no_op/i);
  assert.match(contract, /partial_failure/i);
});

test('tenant repo validation resolves canonical tenant context from registry and live state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(1),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.canonical_tenant_context.tenant_resolution_status, 'resolved');
  assert.match(result.canonical_tenant_context.context_marker, /^tenant-repo-context:/);
});

test('tenant repo validation authorizes a plain repo-admin member who is not the tenant admin', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-repoadmin-only-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(20),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    // Not a maintainer of the tenant top team, only an active repo-admin member.
    memberships: {
      'tenanta-tenant': { state: 'absent', membership: null },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'resolved');
  assert.equal(result.requester_authorization.authorized, true);
  assert.equal(result.requester_authorization.is_repo_admin_team_member, true);
  assert.equal(result.requester_authorization.is_tenant_top_team_maintainer, false);
});

test('tenant repo validation blocks when requester has no authorized tenant match', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-no-match-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(2),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: () => ({ state: 'absent', membership: null }),
  }));

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'no_match');
  assert.match(result.errors.join('\n'), /No authorized tenant context was found for tenant name/i);
});

test('tenant repo validation blocks ambiguous tenant matches', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-ambiguous-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());
  writeRegistryRecord(registryDir, 'tenant-b.json', buildLegacyRegistryRecord({
    tenant_key: 'tenant-b',
    tenant_team_name: 'TenantB_Tenant',
    tenant_team_slug: 'tenantb-tenant',
    repo_admin_team_name: 'TenantB_RepoAdmin',
    repo_admin_team_slug: 'tenantb-repoadmin',
  }));

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(3),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
      { slug: 'tenantb-tenant', parent: null },
      { slug: 'tenantb-repoadmin', parent: { slug: 'tenantb-tenant' } },
    ],
    memberships: ({ teamSlug }) => teamSlug.endsWith('-tenant')
      ? ({ state: 'active', membership: { role: 'maintainer' } })
      : ({ state: 'active', membership: { role: 'member' } }),
  }));

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'ambiguous');
  assert.match(result.errors.join('\n'), /ambiguous/i);
});

test('tenant repo validation accepts a repo name already prefixed with the tenant name', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-prefixed-valid-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({
      tenant_name: 'Tenant A',
      repository_name: 'tenant-a_acme-platform-service',
    }),
    issue: buildIssue(4),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.request.repository_name_normalized, 'tenant-a_acme-platform-service');
  assert.equal(result.request_status, 'awaiting_approval');
});

test('tenant repo validation automatically prefixes repo names to the tenant naming pattern when missing', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-prefix-auto-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
    }),
    issue: buildIssue(4),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.request.repository_name_normalized, 'tenant-a_acme-platform-service');
  assert.equal(result.request_status, 'awaiting_approval');
});

test('tenant repo validation rejects unsafe repository-name normalization outcomes', async () => {
  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ repository_name: '!!!' }),
    issue: buildIssue(4),
    repository: 'owner/repo',
  }, {
    registryDirectory: path.join(os.tmpdir(), 'non-existent-tenant-registry-directory'),
    getOrganization: async () => ({ exists: true }),
  });

  assert.equal(result.is_valid, false);
  assert.match(result.errors.join('\n'), /repository name normalization/i);
});

test('tenant repo validation rejects invalid repository visibility with explicit findings', async () => {
  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ repository_visibility: 'secret' }),
    issue: buildIssue(5),
    repository: 'owner/repo',
  }, {
    registryDirectory: path.join(os.tmpdir(), 'non-existent-tenant-registry-directory'),
    getOrganization: async () => ({ exists: true }),
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.request.repository_visibility, 'secret');
  assert.equal(result.validation_findings.visibility_validation_status, 'invalid_visibility');
  assert.equal(result.validation_findings.requested_visibility, 'secret');
  assert.deepEqual(result.validation_findings.allowed_repository_visibilities, ['private', 'internal', 'public']);
  assert.match(result.validation_findings.visibility_validation_reason, /Allowed values are: private, internal, public/i);
  assert.match(result.errors.join('\n'), /Repository visibility 'secret' is invalid/i);
});

test('tenant repo validation reports unsupported repository visibility with explicit findings', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-unsupported-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ repository_visibility: 'public' }),
    issue: buildIssue(6),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
    extraOptions: {
      getSupportedRepositoryVisibilities: async () => ['private', 'internal'],
    },
  }));

  assert.equal(result.is_valid, false);
  assert.equal(result.validation_findings.visibility_validation_status, 'unsupported_visibility');
  assert.match(result.validation_findings.visibility_validation_reason, /not supported for organization 'octo-org'/i);
});

test('tenant repo validation fails when tenant registry directory is missing', async () => {
  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(7),
    repository: 'owner/repo',
  }, {
    registryDirectory: path.join(os.tmpdir(), 'missing-tenant-registry-directory'),
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.registry_missing_directory, true);
  assert.match(result.errors.join('\n'), /registry directory is missing/i);
});

test('tenant repo validation reports malformed tenant registry records', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-malformed-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, 'bad.json'), '{not-json', 'utf8');

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(8),
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'registry_conflict');
  assert.equal(result.tenant_resolution.registry_malformed_files.length > 0, true);
});

test('tenant repo validation detects registry-live governance conflicts', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-governance-conflict-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest(),
    issue: buildIssue(9),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'other-parent' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'no_match');
  assert.equal(result.tenant_resolution.candidates[0].governance_relation_status, 'wrong_parent');
});

test('tenant repo approval gate accepts designated active owner and binds approval to latest context marker', async () => {
  const decision = await evaluateApprovalGate(
    {
      organization: 'octo-org',
      approvalMode: 'tenant_repo_creation',
      designatedApproverLogin: 'org-owner-user',
      latestContextMarker: 'tenant-repo-context:new',
      issueComments: [
        {
          id: 1,
          body: 'approved',
          created_at: '2026-05-29T10:00:00Z',
          user: {
            login: 'org-owner-user',
          },
        },
      ],
    },
    {
      api: {
        getOrganizationMembership: async () => ({
          exists: true,
          membership: {
            state: 'active',
            role: 'admin',
          },
        }),
      },
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_role, 'target_org_owner');
  assert.equal(decision.approved_context_marker, 'tenant-repo-context:new');
  assert.equal(decision.latest_context_marker, 'tenant-repo-context:new');
});

test('tenant repo validation resolves canonical topology context and access model fields', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-canonical-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-canonical.json', buildCanonicalRegistryRecord());

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ repository_visibility: 'internal' }),
    issue: buildIssue(10),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.canonical_tenant_context.topology_mode, 'canonical');
  assert.equal(result.canonical_tenant_context.tenant_key, 'tenant-a');
  assert.equal(result.canonical_tenant_context.tenant_team_slug, 'tenanta-tenant');
  assert.equal(result.canonical_tenant_context.repo_admin_team_slug, 'tenanta-repoadmin');
  assert.equal(result.validation_findings.topology_mode, 'canonical');
});

test('tenant repo validation fails canonical topology when access model is incomplete', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-canonical-invalid-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-canonical.json', buildCanonicalRegistryRecord({
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'tenanta-tenant',
        structure: [
          { team: 'tenanta-tenant', parent: null, type: 'root' },
          { team: 'tenanta-repoadmin', parent: 'wrong-parent', type: 'repo-admin' },
        ],
      },
      repositories: { owned: [] },
    },
  }));

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ repository_visibility: 'internal' }),
    issue: buildIssue(11),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, false);
  assert.match(result.errors.join('\n'), /topology access model|repo-admin/i);
});

test('US4 duplicate-owned topology blocks approval when requested repository is already owned', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-owned-duplicate-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-canonical.json', buildCanonicalRegistryRecord({
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
      repositories: {
        owned: [
          {
            repoName: 'tenant-a_acme-platform-service',
            tenantId: 'tenant-a',
            visibility: 'internal',
            repoType: 'service',
            lifecycle: 'active',
            migrationWave: 'wave-1',
            source: 'ghec',
            adminTeam: 'tenanta-repoadmin',
          },
        ],
      },
    },
  }));

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({
      repository_name: 'Acme Platform Service',
      repository_visibility: 'internal',
    }),
    issue: buildIssue(12),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, false);
  assert.equal(result.validation_findings.duplicate_owned_repository_status, 'duplicate_conflict');
  assert.equal(result.validation_findings.duplicate_owned_repository_conflict.normalized_name, 'tenant-a_acme-platform-service');
  assert.match(result.errors.join('\n'), /already present in tenant topology owned repositories/i);
});

test('US4 duplicate-owned topology allows execution revalidation no-op when repository already exists', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-owned-rerun-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-canonical.json', buildCanonicalRegistryRecord({
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
      repositories: {
        owned: [
          {
            repoName: 'tenant-a_acme-platform-service',
            tenantId: 'tenant-a',
            visibility: 'internal',
            repoType: 'service',
            lifecycle: 'active',
            migrationWave: 'wave-1',
            source: 'ghec',
            adminTeam: 'tenanta-repoadmin',
          },
        ],
      },
    },
  }));

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ repository_visibility: 'internal', dry_run: 'false' }),
    issue: buildIssue(13),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
    repositoryState: { exists: true, repository: { full_name: 'octo-org/tenant-a_acme-platform-service', visibility: 'internal' } },
    extraOptions: {
      allowOwnedDuplicateWhenRepositoryExists: true,
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.validation_findings.duplicate_owned_repository_status, 'already_owned_existing_repository');
});

test('US2 canonical projection takes precedence when canonical and legacy fields both exist', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-canonical-precedence-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-hybrid.json', buildCanonicalRegistryRecord({
    tenantId: 'tenant-canonical',
    tenantName: 'Tenant Hybrid',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'hybrid-tenant-root',
        structure: [
          { team: 'hybrid-tenant-root', parent: null, type: 'root' },
          { team: 'hybrid-repo-admin', parent: 'hybrid-tenant-root', type: 'repo-admin' },
        ],
      },
      accessModel: {
        enforcement: 'tenant-boundary',
        roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
      },
      repositories: { owned: [] },
    },
    tenant_key: 'legacy-tenant-key',
    tenant_display_name: 'Tenant Hybrid',
    organization: 'legacy-org',
    tenant_team_slug: 'legacy-tenant-team',
    repo_admin_team_slug: 'legacy-repo-admin',
  }));

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({ tenant_name: 'Tenant Hybrid', repository_visibility: 'internal' }),
    issue: buildIssue(14),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'hybrid-tenant-root', parent: null },
      { slug: 'hybrid-repo-admin', parent: { slug: 'hybrid-tenant-root' } },
    ],
    memberships: {
      'hybrid-tenant-root': { state: 'active', membership: { role: 'maintainer' } },
      'hybrid-repo-admin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.canonical_tenant_context.topology_mode, 'canonical');
  assert.equal(result.canonical_tenant_context.tenant_key, 'tenant-canonical');
  assert.equal(result.canonical_tenant_context.tenant_team_slug, 'hybrid-tenant-root');
  assert.equal(result.canonical_tenant_context.repo_admin_team_slug, 'hybrid-repo-admin');
});

test('US2 legacy records fallback to legacy projection with owned repositories defaulted empty', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-legacy-fallback-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-legacy.json', buildLegacyRegistryRecord({
    tenant_key: 'legacy-tenant',
    tenant_display_name: 'Tenant Legacy',
    tenant_team_name: 'Legacy Tenant Team',
    tenant_team_slug: 'legacy-tenant-team',
    repo_admin_team_name: 'Legacy Repo Admin',
    repo_admin_team_slug: 'legacy-repo-admin',
  }));

  const result = await validateTenantRepoRequest({
    parsedRequest: buildParsedRequest({
      tenant_name: 'Tenant Legacy',
      repository_name: 'legacy-service-repo',
      repository_visibility: 'private',
    }),
    issue: buildIssue(15),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'legacy-tenant-team', parent: null },
      { slug: 'legacy-repo-admin', parent: { slug: 'legacy-tenant-team' } },
    ],
    memberships: {
      'legacy-tenant-team': { state: 'active', membership: { role: 'maintainer' } },
      'legacy-repo-admin': { state: 'active', membership: { role: 'member' } },
    },
  }));

  assert.equal(result.is_valid, true);
  assert.equal(result.canonical_tenant_context.topology_mode, 'legacy_projection');
  assert.equal(result.canonical_tenant_context.tenant_key, 'legacy-tenant');
  assert.deepEqual(result.canonical_tenant_context.owned_repositories, []);
  assert.equal(result.canonical_tenant_context.owned_repositories_status, 'absent');
});

async function buildPrimaryContactValidationResult(primaryContact, secondaryContact) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-primary-contact-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  writeRegistryRecord(registryDir, 'tenant-a.json', buildLegacyRegistryRecord());

  const parsedRequest = buildParsedRequest();

  if (primaryContact !== undefined) {
    parsedRequest.primary_contact = primaryContact;
  } else {
    delete parsedRequest.primary_contact;
  }

  if (secondaryContact !== undefined) {
    parsedRequest.secondary_contact = secondaryContact;
  }

  return validateTenantRepoRequest({
    parsedRequest,
    issue: buildIssue(90),
    repository: 'owner/repo',
  }, buildTenantRepoApiOptions({
    registryDir,
    teams: [
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ],
    memberships: {
      'tenanta-tenant': { state: 'active', membership: { role: 'maintainer' } },
      'tenanta-repoadmin': { state: 'active', membership: { role: 'member' } },
    },
  }));
}

test('tenant repo validation rejects missing primary contact', async () => {
  const result = await buildPrimaryContactValidationResult(undefined);

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'validation_failed');
  assert.equal(result.primary_contact_validation.validation_status, 'missing');
  assert.equal(result.primary_contact_validation.detected_type, 'absent');
  assert.match(result.errors.join('\n'), /Primary contact is required\./i);
});

test('tenant repo validation accepts valid primary contact as GitHub handle or email', async () => {
  const handleResult = await buildPrimaryContactValidationResult('octocat');
  assert.equal(handleResult.is_valid, true);
  assert.equal(handleResult.primary_contact_validation.validation_status, 'valid');
  assert.equal(handleResult.primary_contact_validation.detected_type, 'handle');
  assert.equal(handleResult.primary_contact_validation.normalized_value, 'octocat');

  const emailResult = await buildPrimaryContactValidationResult('alice@example.com');
  assert.equal(emailResult.is_valid, true);
  assert.equal(emailResult.primary_contact_validation.validation_status, 'valid');
  assert.equal(emailResult.primary_contact_validation.detected_type, 'email');
  assert.equal(emailResult.primary_contact_validation.normalized_value, 'alice@example.com');
});

test('tenant repo validation normalizes @octocat and octocat to same canonical primary contact', async () => {
  const withAt = await buildPrimaryContactValidationResult('@octocat');
  const withoutAt = await buildPrimaryContactValidationResult('octocat');

  assert.equal(withAt.is_valid, true);
  assert.equal(withoutAt.is_valid, true);
  assert.equal(withAt.primary_contact_validation.normalized_value, 'octocat');
  assert.equal(withoutAt.primary_contact_validation.normalized_value, 'octocat');
  assert.equal(withAt.primary_contact_validation.normalized_value, withoutAt.primary_contact_validation.normalized_value);
});

test('tenant repo validation accepts absent secondary contact with explicit absent validation status', async () => {
  const result = await buildPrimaryContactValidationResult('octocat', undefined);

  assert.equal(result.is_valid, true);
  assert.equal(result.secondary_contact_validation.validation_status, 'absent');
  assert.equal(result.secondary_contact_validation.detected_type, 'absent');
  assert.equal(result.secondary_contact_validation.normalized_value, null);
});

test('tenant repo validation accepts valid secondary contact handle and email', async () => {
  const handleResult = await buildPrimaryContactValidationResult('octocat', 'hubot');
  assert.equal(handleResult.is_valid, true);
  assert.equal(handleResult.secondary_contact_validation.validation_status, 'valid');
  assert.equal(handleResult.secondary_contact_validation.detected_type, 'handle');
  assert.equal(handleResult.secondary_contact_validation.normalized_value, 'hubot');

  const emailResult = await buildPrimaryContactValidationResult('octocat', 'bob@example.com');
  assert.equal(emailResult.is_valid, true);
  assert.equal(emailResult.secondary_contact_validation.validation_status, 'valid');
  assert.equal(emailResult.secondary_contact_validation.detected_type, 'email');
  assert.equal(emailResult.secondary_contact_validation.normalized_value, 'bob@example.com');
});

test('tenant repo validation rejects fixture scenario with invalid primary contact format', async () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-with-contacts.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const scenario = fixture.invalid_primary_freeform;
  const result = await buildPrimaryContactValidationResult(scenario.parsedRequest.primary_contact);

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'validation_failed');
  assert.equal(result.primary_contact_validation.validation_status, 'invalid_format');
  assert.equal(result.primary_contact_validation.detected_type, 'invalid');
  assert.match(result.errors.join('\n'), /Primary contact 'Not A Handle' is not a valid GitHub handle or email address\./i);
});

test('tenant repo validation rejects fixture scenario with invalid secondary contact format', async () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-with-contacts.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const scenario = fixture.invalid_secondary_url;
  const result = await buildPrimaryContactValidationResult(
    scenario.parsedRequest.primary_contact,
    scenario.parsedRequest.secondary_contact
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'validation_failed');
  assert.equal(result.secondary_contact_validation.validation_status, 'invalid_format');
  assert.equal(result.secondary_contact_validation.detected_type, 'invalid');
  assert.match(result.errors.join('\n'), /Secondary contact 'https:\/\/example.com\/profile' is not a valid GitHub handle or email address\./i);
});