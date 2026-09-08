'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseHostedRunnerDeletionRequest } = require('../../src/workflow-support/parse-hosted-runner-deletion-request');
const { validateHostedRunnerDeletionRequest } = require('../../src/workflow-support/validate-hosted-runner-deletion-request');

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
      runnerTopology: { runnerGroups: [] },
    },
  };
}

function buildRegistry() {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-deletion-registry-'));
  const record = canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' });
  fs.writeFileSync(path.join(registryDir, 'contosouk.json'), JSON.stringify(record, null, 2), 'utf8');
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
      { slug: 'contosouk-root', parent: null },
      { slug: 'contosouk-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk-admin' && username === 'tenant-cicd-admin') {
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
        { slug: 'contosouk-root', parent: null },
        { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
      ]),
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /contosouk-admin.*does not exist/i.test(error)),
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
  assert.match(contract, /tenant topology admin team/);
});

test('cross-tenant deletion via prefix collision is rejected', async () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-deletion-xtenant-'));
  for (const record of [
    canonicalTopologyRecord({ tenantId: 'contoso', tenantName: 'Contoso', organization: 'octo-org' }),
    canonicalTopologyRecord({ tenantId: 'contoso-uk', tenantName: 'Contoso UK', organization: 'octo-org' }),
  ]) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
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
        { slug: 'contoso-root', parent: null },
        { slug: 'contoso-admin', parent: { slug: 'contoso-root' } },
        { slug: 'contoso-repo-admin', parent: { slug: 'contoso-root' } },
        { slug: 'contoso-uk-root', parent: null },
        { slug: 'contoso-uk-admin', parent: { slug: 'contoso-uk-root' } },
      ]),
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contoso-admin' && username === 'tenant-cicd-admin') {
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

function cicdGateRegistry() {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-deletion-cicd-registry-'));
  const record = canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' });
  record.topology.teams.structure.push({ team: 'contosouk-cicd-admin', parent: 'contosouk-root', type: 'cicd-admin' });
  fs.writeFileSync(path.join(registryDir, 'contosouk.json'), JSON.stringify(record, null, 2), 'utf8');
  return registryDir;
}

function cicdGateOptions(registryDir, activeTeamSlug, activeUsername) {
  return buildOptions(registryDir, {
    listTeams: async () => ([
      { slug: 'contosouk-root', parent: null },
      { slug: 'contosouk-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-cicd-admin', parent: { slug: 'contosouk-root' } },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => (
      teamSlug === activeTeamSlug && username === activeUsername
        ? { state: 'active', membership: { role: 'member' } }
        : { state: 'absent', membership: null }
    ),
  });
}

test('runner deletion: a member of only the tenant cicd-admin team passes the CI/CD gate', async () => {
  const registryDir = cicdGateRegistry();
  const result = await validateHostedRunnerDeletionRequest(
    buildRequestInput({ requesterLogin: 'cicd-only-user' }),
    cicdGateOptions(registryDir, 'contosouk-cicd-admin', 'cicd-only-user')
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.canonical_tenant_context.cicd_admin_team_slug, 'contosouk-cicd-admin');
  assert.equal(result.canonical_tenant_context.cicd_admin_team_matched_on, 'cicd-admin');
});

test('runner deletion: a member of only the tenant admin team still passes the CI/CD gate', async () => {
  const registryDir = cicdGateRegistry();
  const result = await validateHostedRunnerDeletionRequest(
    buildRequestInput({ requesterLogin: 'admin-only-user' }),
    cicdGateOptions(registryDir, 'contosouk-admin', 'admin-only-user')
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.canonical_tenant_context.cicd_admin_team_slug, 'contosouk-admin');
  assert.equal(result.canonical_tenant_context.cicd_admin_team_matched_on, 'admin');
});

test('runner deletion: a member of neither CI/CD team is not authorized', async () => {
  const registryDir = cicdGateRegistry();
  const result = await validateHostedRunnerDeletionRequest(
    buildRequestInput({ requesterLogin: 'outsider-user' }),
    cicdGateOptions(registryDir, 'contosouk-nobody', 'nobody')
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.tenant_resolution.tenant_resolution_status, 'no_match');
});
