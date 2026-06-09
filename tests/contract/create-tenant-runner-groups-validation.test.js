'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  deriveRunnerGroupName,
  normalizeRunnerGroupVisibility,
  parseRunnerGroupRequest,
} = require('../../src/workflow-support/parse-runner-group-request');
const { validateRunnerGroupRequest } = require('../../src/workflow-support/validate-runner-group-request');

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
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-group-registry-'));
  const record = canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' });
  fs.writeFileSync(path.join(registryDir, 'contosouk.json'), JSON.stringify(record, null, 2), 'utf8');
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_group_name: 'Builders',
      runner_group_visibility: 'selected',
      allows_public_repositories: 'false',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Tenant runner isolation.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 350,
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
    listRunnerGroups: async () => ([
      { id: 1, name: 'Default', default: true, visibility: 'all' },
    ]),
    ...overrides,
  };
}

test('runner group parser derives the tenant-prefixed group name', () => {
  const request = parseRunnerGroupRequest(buildRequestInput());
  assert.equal(request.runner_group_name_derived, 'ContosoUK_Builders');
  assert.equal(request.runner_group_name_derivation.derivation_status, 'valid');
  assert.equal(request.runner_group_visibility, 'selected');
  assert.equal(request.allows_public_repositories, false);
});

test('runner group name derivation keeps pre-prefixed names and rejects oversized derivations', () => {
  const prefixed = deriveRunnerGroupName('ContosoUK', 'ContosoUK_Builders');
  assert.equal(prefixed.derived_name, 'ContosoUK_Builders');

  const oversized = deriveRunnerGroupName('ContosoUK', 'g'.repeat(100));
  assert.equal(oversized.derivation_status, 'invalid');
});

test('visibility defaults to selected when not provided', () => {
  assert.deepEqual(normalizeRunnerGroupVisibility(''), { visibility: 'selected', source: 'default' });
  assert.deepEqual(normalizeRunnerGroupVisibility('[all]'), { visibility: 'all', source: 'user_selected' });
});

test('runner group fixture and issue form scaffolds are present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-runner-groups-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');
  assert.match(fixture, /Runner group name/i);
  assert.match(fixture, /Runner group visibility/i);

  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-tenant-runner-groups.yml');
  const form = fs.readFileSync(formPath, 'utf8');
  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+runner_group_name/i);
  assert.match(form, /id:\s+runner_group_visibility/i);
  assert.match(form, /id:\s+allows_public_repositories/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);
});

test('valid CI/CD-admin runner group request becomes approval-ready', async () => {
  const registryDir = buildRegistry();
  const result = await validateRunnerGroupRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.runner_group_exists, false);
  assert.equal(result.request.runner_group_name_derived, 'ContosoUK_Builders');
  assert.match(result.request.context_marker, /^tenant-runner-context:/);
});

test('existing same-name runner group marks the request for no-op convergence', async () => {
  const registryDir = buildRegistry();
  const result = await validateRunnerGroupRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listRunnerGroups: async () => ([
        { id: 1, name: 'Default', default: true, visibility: 'all' },
        { id: 9, name: 'ContosoUK_Builders', default: false, visibility: 'selected' },
      ]),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.runner_group_exists, true);
  assert.equal(result.existing_runner_group_id, 9);
});

test('requester outside the CI/CD admin team cannot request runner groups', async () => {
  const registryDir = buildRegistry();
  const result = await validateRunnerGroupRequest(
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

test('invalid visibility values are rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateRunnerGroupRequest(
    buildRequestInput({ parsedRequest: { runner_group_visibility: 'everyone' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /visibility 'everyone' is invalid/i.test(error)),
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
    '023-create-tenant-runner-groups',
    'contracts',
    'create-tenant-runner-groups-workflow.yaml'
  );
  const contract = fs.readFileSync(contractPath, 'utf8');

  assert.match(contract, /validate-runner-group-request\.js/);
  assert.match(contract, /github-runner-api\.js/);
  assert.match(contract, /resolve-tenant-cicd-context-from-registry\.js/);
  assert.match(contract, /runner-group-policy/);
  assert.match(contract, /tenant topology admin team/);
});

test('cross-tenant runner group creation via prefix collision is rejected', async () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-group-xtenant-'));
  for (const record of [
    canonicalTopologyRecord({ tenantId: 'contoso', tenantName: 'Contoso', organization: 'octo-org' }),
    canonicalTopologyRecord({ tenantId: 'contoso-uk', tenantName: 'Contoso UK', organization: 'octo-org' }),
  ]) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  const result = await validateRunnerGroupRequest(
    buildRequestInput({
      parsedRequest: {
        tenant_name: 'Contoso',
        runner_group_name: 'Contoso_UK_Builders',
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
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /falls within the naming namespace of tenant 'Contoso UK'/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});
