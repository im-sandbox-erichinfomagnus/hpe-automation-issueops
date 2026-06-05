'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseHostedRunnerDeletionRequest } = require('../../src/workflow-support/parse-hosted-runner-deletion-request');
const { validateHostedRunnerDeletionRequest } = require('../../src/workflow-support/validate-hosted-runner-deletion-request');

function buildRegistry() {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-deletion-registry-'));
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify({
      tenant_key: 'contosouk',
      tenant_display_name: 'ContosoUK',
      organization: 'octo-org',
      tenant_team_name: 'ContosoUK_Tenant',
      tenant_team_slug: 'contosouk_tenant',
      repo_admin_team_name: 'ContosoUK_RepoAdmins',
      repo_admin_team_slug: 'contosouk_repoadmins',
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu-build',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Decommissioning tenant CI capacity.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 340,
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
    listHostedRunners: async () => ([
      { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready' },
    ]),
    ...overrides,
  };
}

test('deletion parser accepts full tenant-prefixed names and base names equivalently', () => {
  const fromBase = parseHostedRunnerDeletionRequest(buildRequestInput());
  assert.equal(fromBase.runner_name_derived, 'ContosoUK_ubuntu-build');
  assert.equal(fromBase.runner_deletion_scope, 'organization');

  const fromFull = parseHostedRunnerDeletionRequest(
    buildRequestInput({ parsedRequest: { runner_name: 'ContosoUK_ubuntu-build' } })
  );
  assert.equal(fromFull.runner_name_derived, 'ContosoUK_ubuntu-build');
});

test('deletion fixture and issue form scaffolds are present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'delete-tenant-hosted-runner-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Runner name/i);

  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'delete-tenant-hosted-runner.yml');
  const form = fs.readFileSync(formPath, 'utf8');
  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+runner_name/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);
});

test('valid CI/CD-admin deletion request resolves the existing runner id', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerDeletionRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.runner_exists, true);
  assert.equal(result.existing_runner_id, 55);
  assert.equal(result.existing_runner_status, 'Ready');
  assert.match(result.request.context_marker, /^tenant-runner-context:/);
});

test('missing runner stays valid and is marked for no-op convergence', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerDeletionRequest(
    buildRequestInput(),
    buildOptions(registryDir, { listHostedRunners: async () => [] })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.runner_exists, false);
  assert.equal(
    result.warnings.some((warning) => /no-op/i.test(warning)),
    true
  );
});

test('requester outside the CI/CD admin team cannot request deletion', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerDeletionRequest(
    buildRequestInput({ requesterLogin: 'random-user' }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /not an active member of the tenant CI\/CD admin team/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('missing derived CI/CD admin team fails closed for deletion requests', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerDeletionRequest(
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

test('contract yaml references the expected modules', () => {
  const contractPath = path.join(
    __dirname,
    '..',
    '..',
    'specs',
    '022-delete-tenant-hosted-runner',
    'contracts',
    'delete-tenant-hosted-runner-workflow.yaml'
  );
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /validate-hosted-runner-deletion-request\.js/);
  assert.match(contract, /github-runner-api\.js/);
  assert.match(contract, /resolve-tenant-cicd-context-from-registry\.js/);
  assert.match(contract, /TenantName_CICDAdmins/);
});

test('cross-tenant deletion via prefix collision is rejected', async () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-deletion-xtenant-'));
  for (const record of [
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
  ]) {
    fs.writeFileSync(path.join(registryDir, `${record.tenant_key}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  const result = await validateHostedRunnerDeletionRequest(
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
      ]),
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contoso_cicdadmins' && username === 'tenant-cicd-admin') {
          return { state: 'active', membership: { role: 'member' } };
        }
        return { state: 'absent', membership: null };
      },
      listHostedRunners: async () => ([
        { id: 99, name: 'Contoso_UK_ci-runner', status: 'Ready' },
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
