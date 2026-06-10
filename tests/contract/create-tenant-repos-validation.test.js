'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateTenantRepoRequest } = require('../../src/workflow-support/validate-tenant-repo-request');
const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');

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
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
      tenant_key: 'tenant-a',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantA_Tenant',
      tenant_team_slug: 'tenanta-tenant',
      repo_admin_team_name: 'TenantA_RepoAdmin',
      repo_admin_team_slug: 'tenanta-repoadmin',
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      repository_visibility: 'private',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 1,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
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

  assert.equal(result.is_valid, true);
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.canonical_tenant_context.tenant_resolution_status, 'resolved');
  assert.match(result.canonical_tenant_context.context_marker, /^tenant-repo-context:/);
});

test('tenant repo validation blocks when requester has no authorized tenant match', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-no-match-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
      tenant_key: 'tenant-a',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantA_Tenant',
      tenant_team_slug: 'tenanta-tenant',
      repo_admin_team_name: 'TenantA_RepoAdmin',
      repo_admin_team_slug: 'tenanta-repoadmin',
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
      number: 2,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ]),
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async () => ({ exists: false, repository: null }),
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'no_match');
  assert.match(result.errors.join('\n'), /No authorized tenant context was found for tenant name/i);
});

test('tenant repo validation blocks ambiguous tenant matches', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-ambiguous-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
      tenant_key: 'tenant-a',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantA_Tenant',
      tenant_team_slug: 'tenanta-tenant',
      repo_admin_team_name: 'TenantA_RepoAdmin',
      repo_admin_team_slug: 'tenanta-repoadmin',
    }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(registryDir, 'tenant-b.json'),
    JSON.stringify({
      tenant_key: 'tenant-b',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantB_Tenant',
      tenant_team_slug: 'tenantb-tenant',
      repo_admin_team_name: 'TenantB_RepoAdmin',
      repo_admin_team_slug: 'tenantb-repoadmin',
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
      number: 3,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
      { slug: 'tenantb-tenant', parent: null },
      { slug: 'tenantb-repoadmin', parent: { slug: 'tenantb-tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug.endsWith('-tenant')) {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'active', membership: { role: 'member' } };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async () => ({ exists: false, repository: null }),
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'ambiguous');
  assert.match(result.errors.join('\n'), /ambiguous/i);
});

test('tenant repo validation rejects unsafe repository-name normalization outcomes', async () => {
  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: '!!!',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 4,
      user: {
        login: 'tenant-admin-user',
      },
    },
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
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      repository_visibility: 'secret',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 4,
      user: {
        login: 'tenant-admin-user',
      },
    },
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
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
      tenant_key: 'tenant-a',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantA_Tenant',
      tenant_team_slug: 'tenanta-tenant',
      repo_admin_team_name: 'TenantA_RepoAdmin',
      repo_admin_team_slug: 'tenanta-repoadmin',
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      repository_visibility: 'public',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 5,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
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
    getSupportedRepositoryVisibilities: async () => ['private', 'internal'],
  });

  assert.equal(result.is_valid, false);
  assert.equal(result.validation_findings.visibility_validation_status, 'unsupported_visibility');
  assert.match(result.validation_findings.visibility_validation_reason, /not supported for organization 'octo-org'/i);
  assert.match(result.validation_findings.visibility_validation_reason, /Allowed values are: private, internal, public/i);
});

test('tenant repo validation fails when tenant registry directory is missing', async () => {
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
      number: 5,
      user: {
        login: 'tenant-admin-user',
      },
    },
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
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 6,
      user: {
        login: 'tenant-admin-user',
      },
    },
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
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
      tenant_key: 'tenant-a',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantA_Tenant',
      tenant_team_slug: 'tenanta-tenant',
      repo_admin_team_name: 'TenantA_RepoAdmin',
      repo_admin_team_slug: 'tenanta-repoadmin',
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
      number: 7,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'other-parent' } },
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
  fs.writeFileSync(
    path.join(registryDir, 'tenant-canonical.json'),
    JSON.stringify({
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
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      repository_visibility: 'internal',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 8,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
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
  fs.writeFileSync(
    path.join(registryDir, 'tenant-canonical.json'),
    JSON.stringify({
      tenantId: 'tenant-a',
      tenantName: 'Tenant A',
      topology: {
        organization: {
          orgName: 'octo-org',
        },
        teams: {
          tenantRootTeam: 'tenanta-tenant',
          structure: [
            { team: 'tenanta-tenant', parent: null, type: 'root' },
            { team: 'tenanta-repoadmin', parent: 'wrong-parent', type: 'repo-admin' },
          ],
        },
        repositories: {
          owned: [],
        },
      },
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      repository_visibility: 'internal',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 9,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
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
  assert.match(result.errors.join('\n'), /topology access model|repo-admin/i);
});

test('US4 duplicate-owned topology blocks approval when requested repository is already owned', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-owned-duplicate-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-canonical.json'),
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
        repositories: {
          owned: [
            {
              repoName: 'acme-platform-service',
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
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'Acme Platform Service',
      repository_visibility: 'internal',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 10,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
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
  assert.equal(result.validation_findings.duplicate_owned_repository_status, 'duplicate_conflict');
  assert.equal(result.validation_findings.duplicate_owned_repository_conflict.normalized_name, 'acme-platform-service');
  assert.match(result.errors.join('\n'), /already present in tenant topology owned repositories/i);
});

test('US4 duplicate-owned topology allows execution revalidation no-op when repository already exists', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-owned-rerun-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-canonical.json'),
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
        repositories: {
          owned: [
            {
              repoName: 'acme-platform-service',
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
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      repository_name: 'acme-platform-service',
      repository_visibility: 'internal',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Test request',
    },
    issue: {
      number: 11,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
    allowOwnedDuplicateWhenRepositoryExists: true,
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
    getRepository: async () => ({ exists: true, repository: { full_name: 'octo-org/acme-platform-service', visibility: 'internal' } }),
  });

  assert.equal(result.is_valid, true);
  assert.equal(result.validation_findings.duplicate_owned_repository_status, 'already_owned_existing_repository');
});

test('US2 canonical projection takes precedence when canonical and legacy fields both exist', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-canonical-precedence-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-hybrid.json'),
    JSON.stringify({
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
        repositories: {
          owned: [],
        },
      },
      // conflicting legacy fields should be ignored when canonical topology is present
      tenant_key: 'legacy-tenant-key',
      tenant_display_name: 'Tenant Hybrid',
      organization: 'legacy-org',
      tenant_team_slug: 'legacy-tenant-team',
      repo_admin_team_slug: 'legacy-repo-admin',
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant Hybrid',
      repository_name: 'acme-platform-service',
      repository_visibility: 'internal',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 12,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'hybrid-tenant-root', parent: null },
      { slug: 'hybrid-repo-admin', parent: { slug: 'hybrid-tenant-root' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'hybrid-tenant-root') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'active', membership: { role: 'member' } };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async () => ({ exists: false, repository: null }),
  });

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
  fs.writeFileSync(
    path.join(registryDir, 'tenant-legacy.json'),
    JSON.stringify({
      tenant_key: 'legacy-tenant',
      tenant_display_name: 'Tenant Legacy',
      organization: 'octo-org',
      tenant_team_name: 'Legacy Tenant Team',
      tenant_team_slug: 'legacy-tenant-team',
      repo_admin_team_name: 'Legacy Repo Admin',
      repo_admin_team_slug: 'legacy-repo-admin',
    }, null, 2),
    'utf8'
  );

  const result = await validateTenantRepoRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Tenant Legacy',
      repository_name: 'legacy-service-repo',
      repository_visibility: 'private',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Test request',
    },
    issue: {
      number: 13,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
  }, {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'legacy-tenant-team', parent: null },
      { slug: 'legacy-repo-admin', parent: { slug: 'legacy-tenant-team' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'legacy-tenant-team') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'active', membership: { role: 'member' } };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async () => ({ exists: false, repository: null }),
  });

  assert.equal(result.is_valid, true);
  assert.equal(result.canonical_tenant_context.topology_mode, 'legacy_projection');
  assert.equal(result.canonical_tenant_context.tenant_key, 'legacy-tenant');
  assert.deepEqual(result.canonical_tenant_context.owned_repositories, []);
  assert.equal(result.canonical_tenant_context.owned_repositories_status, 'absent');
});

