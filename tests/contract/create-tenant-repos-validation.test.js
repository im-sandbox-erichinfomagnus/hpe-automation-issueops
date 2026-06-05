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

