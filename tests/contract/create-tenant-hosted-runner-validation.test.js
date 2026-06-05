'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateHostedRunnerRequest } = require('../../src/workflow-support/validate-hosted-runner-request');

function buildRegistry(records = null) {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-runner-registry-'));
  const recordList = records || [
    {
      tenant_key: 'contosouk',
      tenant_display_name: 'ContosoUK',
      organization: 'octo-org',
      tenant_team_name: 'ContosoUK_Tenant',
      tenant_team_slug: 'contosouk_tenant',
      repo_admin_team_name: 'ContosoUK_RepoAdmins',
      repo_admin_team_slug: 'contosouk_repoadmins',
    },
  ];
  for (const record of recordList) {
    fs.writeFileSync(
      path.join(registryDir, `${record.tenant_key}.json`),
      JSON.stringify(record, null, 2),
      'utf8'
    );
  }
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu-build',
      runner_image_id: 'ubuntu-24.04',
      runner_image_source: 'github',
      runner_size: '4-core',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'CI capacity for the tenant.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 320,
      user: { login: overrides.requesterLogin || 'tenant-cicd-admin' },
    },
  };
}

function buildOptions(registryDir, overrides = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'contosouk_tenant', parent: null },
      { slug: 'contosouk_repoadmins', parent: { slug: 'contosouk_tenant' } },
      { slug: 'contosouk_cicdadmins', parent: null },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk_cicdadmins' && username === 'tenant-cicd-admin') {
        return { state: 'active', membership: { role: 'member' } };
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
    listHostedRunners: async () => ([]),
    listRunnerGroups: async () => ([
      { id: 1, name: 'Default', default: true, visibility: 'all' },
      { id: 7, name: 'ContosoUK_Builders', default: false, visibility: 'selected' },
    ]),
    ...overrides,
  };
}

test('valid CI/CD-admin request becomes approval-ready with default runner group resolution', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.canonical_tenant_context.cicd_admin_team_slug, 'contosouk_cicdadmins');
  assert.equal(result.canonical_tenant_context.requester_cicd_membership_state, 'active_member');
  assert.equal(result.runner_group_resolution.resolution_mode, 'organization_default');
  assert.equal(result.runner_group_resolution.resolved_group_id, 1);
  assert.equal(result.request.runner_name_derived, 'ContosoUK_ubuntu-build');
  assert.match(result.request.context_marker, /^tenant-runner-context:/);
});

test('requester who is not an active CI/CD admin member is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput({ requesterLogin: 'random-user' }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'validation_failed');
  assert.equal(
    result.errors.some((error) => /not an active member of the tenant CI\/CD admin team/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('missing derived CI/CD admin team fails closed with remediation guidance', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listTeams: async () => ([
        { slug: 'contosouk_tenant', parent: null },
        { slug: 'contosouk_repoadmins', parent: { slug: 'contosouk_tenant' } },
      ]),
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /ContosoUK_CICDAdmins.*does not exist/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('pending CI/CD admin membership is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getMembershipForUser: async () => ({ state: 'pending', membership: { role: 'member' } }),
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /not an active member/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('explicit tenant runner group resolves to its id', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput({ parsedRequest: { runner_group_name: 'ContosoUK_Builders' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.runner_group_resolution.resolution_mode, 'explicit_tenant_group');
  assert.equal(result.runner_group_resolution.resolved_group_id, 7);
});

test('runner group without the tenant prefix is rejected as pattern mismatch', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput({ parsedRequest: { runner_group_name: 'OtherTenant_Builders' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.runner_group_resolution.resolution_status, 'pattern_mismatch');
  assert.equal(
    result.errors.some((error) => /does not carry the tenant naming prefix/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('nonexistent explicit runner group is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput({ parsedRequest: { runner_group_name: 'ContosoUK_Missing' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.runner_group_resolution.resolution_status, 'not_found');
});

test('existing runner with the derived name marks the request for no-op convergence', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listHostedRunners: async () => ([
        { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready' },
      ]),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.runner_exists, true);
  assert.equal(result.existing_runner_id, 55);
  assert.equal(
    result.warnings.some((warning) => /already exists/i.test(warning)),
    true
  );
});

test('non-owner designated approver is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput({ parsedRequest: { designated_approver: 'regular-member' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /active target organization owner/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('invalid image source and missing size are rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerRequest(
    buildRequestInput({ parsedRequest: { runner_image_source: 'dockerhub', runner_size: '' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /image source/i.test(error)),
    true
  );
  assert.equal(
    result.errors.some((error) => /machine size is required/i.test(error)),
    true
  );
});

test('ambiguous tenant name across multiple authorized contexts is rejected', async () => {
  const registryDir = buildRegistry([
    {
      tenant_key: 'contosouk',
      tenant_display_name: 'ContosoUK',
      organization: 'octo-org',
      tenant_team_name: 'ContosoUK_Tenant',
      tenant_team_slug: 'contosouk_tenant',
      repo_admin_team_name: 'ContosoUK_RepoAdmins',
      repo_admin_team_slug: 'contosouk_repoadmins',
    },
    {
      tenant_key: 'contosouk-2',
      tenant_display_name: 'ContosoUK',
      organization: 'octo-org',
      tenant_team_name: 'ContosoUK_Tenant',
      tenant_team_slug: 'contosouk_tenant',
      repo_admin_team_name: 'ContosoUK_RepoAdmins',
      repo_admin_team_slug: 'contosouk_repoadmins',
    },
  ]);
  const result = await validateHostedRunnerRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'ambiguous');
});

test('contract yaml references the expected lifecycle states and modules', () => {
  const contractPath = path.join(
    __dirname,
    '..',
    '..',
    'specs',
    '021-create-tenant-hosted-runner',
    'contracts',
    'create-tenant-hosted-runner-workflow.yaml'
  );
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /awaiting_approval/);
  assert.match(contract, /partially_executed/);
  assert.match(contract, /validate-hosted-runner-request\.js/);
  assert.match(contract, /github-runner-api\.js/);
  assert.match(contract, /resolve-tenant-cicd-context-from-registry\.js/);
  assert.match(contract, /hosted-runner-policy/);
  assert.match(contract, /TenantName_CICDAdmins/);
});

test('cross-tenant namespace escape via prefix collision is rejected for runners', async () => {
  const registryDir = buildRegistry([
    {
      tenant_key: 'contoso',
      tenant_display_name: 'Contoso',
      organization: 'octo-org',
      tenant_team_name: 'Contoso_Tenant',
      tenant_team_slug: 'contoso_tenant',
      repo_admin_team_name: 'Contoso_RepoAdmins',
      repo_admin_team_slug: 'contoso_repoadmins',
    },
    {
      tenant_key: 'contoso-uk',
      tenant_display_name: 'Contoso UK',
      organization: 'octo-org',
      tenant_team_name: 'Contoso_UK_Tenant',
      tenant_team_slug: 'contoso_uk_tenant',
      repo_admin_team_name: 'Contoso_UK_RepoAdmins',
      repo_admin_team_slug: 'contoso_uk_repoadmins',
    },
  ]);

  const result = await validateHostedRunnerRequest(
    buildRequestInput({
      parsedRequest: {
        tenant_name: 'Contoso',
        runner_name: 'Contoso_UK_ci-runner',
      },
    }),
    buildOptions(registryDir, {
      listTeams: async () => ([
        { slug: 'contoso_tenant', parent: null },
        { slug: 'contoso_repoadmins', parent: { slug: 'contoso_tenant' } },
        { slug: 'contoso_cicdadmins', parent: null },
        { slug: 'contoso_uk_tenant', parent: null },
        { slug: 'contoso_uk_cicdadmins', parent: null },
      ]),
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contoso_cicdadmins' && username === 'tenant-cicd-admin') {
          return { state: 'active', membership: { role: 'member' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /falls within the naming namespace of tenant 'Contoso UK'/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('cross-tenant runner group targeting via prefix collision is rejected', async () => {
  const registryDir = buildRegistry([
    {
      tenant_key: 'contoso',
      tenant_display_name: 'Contoso',
      organization: 'octo-org',
      tenant_team_name: 'Contoso_Tenant',
      tenant_team_slug: 'contoso_tenant',
      repo_admin_team_name: 'Contoso_RepoAdmins',
      repo_admin_team_slug: 'contoso_repoadmins',
    },
    {
      tenant_key: 'contoso-uk',
      tenant_display_name: 'Contoso UK',
      organization: 'octo-org',
      tenant_team_name: 'Contoso_UK_Tenant',
      tenant_team_slug: 'contoso_uk_tenant',
      repo_admin_team_name: 'Contoso_UK_RepoAdmins',
      repo_admin_team_slug: 'contoso_uk_repoadmins',
    },
  ]);

  const result = await validateHostedRunnerRequest(
    buildRequestInput({
      parsedRequest: {
        tenant_name: 'Contoso',
        runner_name: 'build',
        runner_group_name: 'Contoso_UK_Builders',
      },
    }),
    buildOptions(registryDir, {
      listTeams: async () => ([
        { slug: 'contoso_tenant', parent: null },
        { slug: 'contoso_repoadmins', parent: { slug: 'contoso_tenant' } },
        { slug: 'contoso_cicdadmins', parent: null },
      ]),
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contoso_cicdadmins' && username === 'tenant-cicd-admin') {
          return { state: 'active', membership: { role: 'member' } };
        }
        return { state: 'absent', membership: null };
      },
      listRunnerGroups: async () => ([
        { id: 1, name: 'Default', default: true, visibility: 'all' },
        { id: 8, name: 'Contoso_UK_Builders', default: false, visibility: 'selected' },
      ]),
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /falls within the naming namespace of tenant 'Contoso UK'/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});
