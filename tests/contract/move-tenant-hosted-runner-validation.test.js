'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createGitHubRunnerApi } = require('../../src/workflow-support/github-runner-api');
const { parseHostedRunnerMoveRequest } = require('../../src/workflow-support/parse-hosted-runner-move-request');
const { validateHostedRunnerMoveRequest } = require('../../src/workflow-support/validate-hosted-runner-move-request');

function canonicalTopologyRecord({ tenantId, tenantName, organization }) {
  return {
    tenantId,
    tenantName,
    tenantType: 'application',
    organization,
    topology: {
      organization: { orgName: organization },
      teams: {
        tenantRootTeam: `${tenantId}-root`,
        structure: [
          { team: `${tenantId}-root`, parent: null, type: 'root' },
          { team: `${tenantId}-admin`, parent: `${tenantId}-root`, type: 'admin' },
          { team: `${tenantId}-repo-admin`, parent: `${tenantId}-root`, type: 'repo-admin' },
        ],
      },
      runnerTopology: { runnerGroups: [] },
    },
  };
}

function buildRegistry(records = [
  canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' }),
]) {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-move-registry-'));
  for (const record of records) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
  }
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu-build',
      hosted_runner_id: '',
      target_runner_group_name: 'ContosoUK_Builders',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Move the runner into the tenant group.',
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
    listHostedRunners: async () => ([
      { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready', runner_group_id: 1 },
    ]),
    listRunnerGroups: async () => ([
      { id: 1, name: 'Default', default: true },
      { id: 7, name: 'ContosoUK_Builders', default: false },
    ]),
    ...overrides,
  };
}

test('move parser derives the runner name and accepts an optional runner id', () => {
  const request = parseHostedRunnerMoveRequest(buildRequestInput({
    parsedRequest: { hosted_runner_id: '55' },
  }));

  assert.equal(request.runner_name_derived, 'ContosoUK_ubuntu-build');
  assert.equal(request.hosted_runner_id_input, 55);
  assert.equal(request.hosted_runner_id_valid, true);
  assert.equal(request.target_runner_group_name_input, 'ContosoUK_Builders');
  assert.equal(request.runner_move_scope, 'organization');
});

test('move parser rejects an invalid optional runner id', () => {
  const request = parseHostedRunnerMoveRequest(buildRequestInput({
    parsedRequest: { hosted_runner_id: 'abc' },
  }));

  assert.equal(request.hosted_runner_id_input, null);
  assert.equal(request.hosted_runner_id_valid, false);
});

test('move fixture and issue form include required intake fields', () => {
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'move-tenant-hosted-runner-issue.md'), 'utf8');
  assert.match(fixture, /Target runner group name/i);

  const form = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'move-tenant-hosted-runner.yml'),
    'utf8'
  );
  for (const id of [
    'organization',
    'tenant_name',
    'runner_name',
    'hosted_runner_id',
    'target_runner_group_name',
    'designated_approver',
    'dry_run',
    'justification',
  ]) {
    assert.match(form, new RegExp(`id:\\s+${id}`, 'i'));
  }
});

test('valid move request resolves the runner and target group', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerMoveRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.runner_resolution_status, 'resolved');
  assert.equal(result.existing_runner_id, 55);
  assert.equal(result.current_runner_group_id, 1);
  assert.equal(result.target_runner_group_resolution.resolved_group_id, 7);
  assert.equal(result.runner_already_in_target_group, false);
  assert.match(result.request.context_marker, /^tenant-runner-context:/);
});

test('runner already in the target group stays valid for no-op convergence', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerMoveRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listHostedRunners: async () => ([
        { id: 55, name: 'ContosoUK_ubuntu-build', status: 'Ready', runner_group_id: 7 },
      ]),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.runner_already_in_target_group, true);
  assert.equal(result.warnings.some((warning) => /no-op/i.test(warning)), true);
});

test('missing runner is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerMoveRequest(
    buildRequestInput(),
    buildOptions(registryDir, { listHostedRunners: async () => [] })
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.errors.some((error) => /was not found/i.test(error)), true);
});

test('ambiguous runner name requires the optional id', async () => {
  const registryDir = buildRegistry();
  const duplicateRunners = [
    { id: 55, name: 'ContosoUK_ubuntu-build', runner_group_id: 1 },
    { id: 56, name: 'ContosoUK_ubuntu-build', runner_group_id: 1 },
  ];
  const ambiguous = await validateHostedRunnerMoveRequest(
    buildRequestInput(),
    buildOptions(registryDir, { listHostedRunners: async () => duplicateRunners })
  );
  assert.equal(ambiguous.is_valid, false);
  assert.equal(ambiguous.runner_resolution_status, 'ambiguous');

  const resolved = await validateHostedRunnerMoveRequest(
    buildRequestInput({ parsedRequest: { hosted_runner_id: '56' } }),
    buildOptions(registryDir, { listHostedRunners: async () => duplicateRunners })
  );
  assert.equal(resolved.is_valid, true, JSON.stringify(resolved.errors));
  assert.equal(resolved.existing_runner_id, 56);
});

test('missing target runner group is rejected instead of created', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerMoveRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      listRunnerGroups: async () => [{ id: 1, name: 'Default', default: true }],
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.errors.some((error) => /runner group.*was not found/i.test(error)), true);
});

test('cross-tenant target runner group is rejected', async () => {
  const records = [
    canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' }),
    canonicalTopologyRecord({ tenantId: 'fabrikam', tenantName: 'Fabrikam', organization: 'octo-org' }),
  ];
  const registryDir = buildRegistry(records);
  const result = await validateHostedRunnerMoveRequest(
    buildRequestInput({ parsedRequest: { target_runner_group_name: 'Fabrikam_Builders' } }),
    buildOptions(registryDir, {
      listRunnerGroups: async () => [{ id: 8, name: 'Fabrikam_Builders' }],
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.errors.some((error) => /naming namespace of tenant 'Fabrikam'/i.test(error)), true);
});

test('requester outside the tenant admin team cannot request a move', async () => {
  const registryDir = buildRegistry();
  const result = await validateHostedRunnerMoveRequest(
    buildRequestInput({ requesterLogin: 'random-user' }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.errors.some((error) => /not an active member/i.test(error)), true);
});

test('updateHostedRunner sends only the target runner group id', async () => {
  const calls = [];
  const api = createGitHubRunnerApi({
    token: 'pat-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          id: 55,
          name: 'ContosoUK_ubuntu-build',
          runner_group_id: 7,
          status: 'Ready',
        }),
      };
    },
  });

  const runner = await api.updateHostedRunner({
    organization: 'octo-org',
    hostedRunnerId: 55,
    runnerGroupId: 7,
  });

  assert.equal(runner.runner_group_id, 7);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/orgs\/octo-org\/actions\/hosted-runners\/55$/);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { runner_group_id: 7 });
});
