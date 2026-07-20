'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { normalizeBulkCsvRequestedChildTeams } = require('../../src/workflow-support/normalize-bulk-csv-requested-child-teams');
const { normalizeBulkCsvRequestedPeople } = require('../../src/workflow-support/normalize-bulk-csv-requested-people');
const { normalizeBulkCsvRequestedRepositories } = require('../../src/workflow-support/normalize-bulk-csv-requested-repositories');
const { normalizeBulkCsvRequestedTeams } = require('../../src/workflow-support/normalize-bulk-csv-requested-teams');
const { parseHostedRunnerDeletionRequest } = require('../../src/workflow-support/parse-hosted-runner-deletion-request');
const { parseHostedRunnerMoveRequest } = require('../../src/workflow-support/parse-hosted-runner-move-request');
const { parseHostedRunnerRequest } = require('../../src/workflow-support/parse-hosted-runner-request');
const { parseRepositoryRulesetRequest } = require('../../src/workflow-support/parse-repository-ruleset-request');
const { parseRunnerGroupRequest } = require('../../src/workflow-support/parse-runner-group-request');
const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');
const { parseTenantRepoRequest } = require('../../src/workflow-support/parse-tenant-repo-request');
const { parseTenantVariablesRequest } = require('../../src/workflow-support/parse-tenant-variables-request');
const { validateTenantCreationRequest } = require('../../src/workflow-support/validate-tenant-creation-request');
const { validateTenantVariablesRequest } = require('../../src/workflow-support/validate-tenant-variables-request');

const kitDirectory = path.join(__dirname, '..', '..', 'demo-recording-kit');
const csvDirectory = path.join(kitDirectory, 'csv');
const organization = 'im-sandbox-erichinfomagnus';

function readCsv(filename) {
  return fs.readFileSync(path.join(csvDirectory, filename), 'utf8');
}

function parsedRequest(csvField, filename, overrides = {}) {
  return {
    organization,
    tenant_name: 'EricDemo',
    designated_approver: 'adamg-infomagnus',
    dry_run: 'false',
    justification: 'Recording-kit contract test.',
    [csvField]: readCsv(filename),
    ...overrides,
  };
}

function canonicalTopologyRecord(tenantId, tenantName, ownedRepositories = []) {
  return {
    tenantId,
    tenantName,
    tenantType: 'platform',
    organization,
    topology: {
      organization: { orgName: organization },
      teams: {
        tenantRootTeam: `${tenantId}-root`,
        structure: [
          { team: `${tenantId}-root`, parent: null, type: 'root' },
          { team: `${tenantId}-admin`, parent: `${tenantId}-root`, type: 'admin' },
          { team: `${tenantId}-repo-admin`, parent: `${tenantId}-root`, type: 'repo-admin' },
          { team: `${tenantId}-cicd-admin`, parent: `${tenantId}-root`, type: 'cicd-admin' },
        ],
      },
      repositories: { owned: ownedRepositories },
    },
  };
}

function buildRegistry() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-recording-kit-registry-'));
  const records = [
    canonicalTopologyRecord('ericdemo', 'EricDemo', ['ericdemo-api', 'ericdemo-web', 'ericdemo-infra']),
    canonicalTopologyRecord('democorp', 'DemoCorp', ['democorp-api']),
  ];
  for (const record of records) {
    fs.writeFileSync(path.join(directory, `${record.tenantId}.json`), JSON.stringify(record), 'utf8');
  }
  return directory;
}

const issueContext = {
  repository: `${organization}/tenant-issueops-demo`,
  issue: { number: 900, user: { login: 'adamg-infomagnus' } },
};

test('every submission CSV is UTF-8 text with LF endings and at least one data row', () => {
  const filenames = fs.readdirSync(csvDirectory).filter((name) => name.endsWith('.csv')).sort();

  assert.equal(filenames.length, 21);
  for (const filename of filenames) {
    const content = readCsv(filename);
    assert.equal(content.startsWith('\uFEFF'), false, `${filename} has a BOM`);
    assert.equal(content.includes('\r'), false, `${filename} does not use LF endings`);
    assert.equal(content.trim().length > 0, true, `${filename} is empty`);
  }
});

test('scenario 1 attachment files pass the production bulk CSV normalizers', () => {
  const teams = normalizeBulkCsvRequestedTeams(readCsv('scenario-01a-create-teams.csv'));
  const rejectedApproval = normalizeBulkCsvRequestedTeams(readCsv('scenario-01-rejected-approval.csv'));
  const people = normalizeBulkCsvRequestedPeople(readCsv('scenario-01b-add-members.csv'));
  const children = normalizeBulkCsvRequestedChildTeams(readCsv('scenario-01c-add-child-teams.csv'));
  const repositories = normalizeBulkCsvRequestedRepositories(
    readCsv('scenario-01d-team-repo-access.csv'),
    { organization }
  );

  for (const result of [teams, rejectedApproval, people, children, repositories]) {
    assert.equal(result.schema_status, 'valid', JSON.stringify(result.schema_errors));
    assert.equal(result.invalid_row_count, 0);
    assert.equal(result.duplicate_row_count, 0);
  }
  assert.equal(teams.valid_row_count, 3);
  assert.equal(people.valid_row_count, 2);
  assert.equal(children.valid_row_count, 2);
  assert.equal(repositories.valid_row_count, 1);
});

test('scenario 2 tenant CSV parses and validates the four-team topology', async () => {
  const request = parseTenantCreationRequest({
    ...issueContext,
    parsedRequest: parsedRequest('tenant_csv', 'scenario-02-create-tenant.csv'),
  });
  const validation = await validateTenantCreationRequest(request, {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'adamg-infomagnus' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    listTeams: async () => [],
  });

  assert.equal(request.csv_row_count, 1);
  assert.deepEqual(request.csv_input_errors, []);
  assert.equal(request.tenant_key, 'ericdemo');
  assert.equal(request.tenant_admin_login, 'adamg-infomagnus');
  assert.deepEqual(
    request.topology.teams.structure.map((team) => team.team),
    ['ericdemo-root', 'ericdemo-admin', 'ericdemo-repo-admin', 'ericdemo-cicd-admin']
  );
  assert.equal(validation.is_valid, true, JSON.stringify(validation.errors));
});

test('scenario 2 rejection CSV fails when the tenant admin is not an organization member', async () => {
  const request = parseTenantCreationRequest({
    ...issueContext,
    parsedRequest: parsedRequest('tenant_csv', 'scenario-02-reject-nonmember-admin.csv'),
  });
  const validation = await validateTenantCreationRequest(request, {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: username !== 'not-an-org-member',
      membership: username === 'not-an-org-member'
        ? null
        : { role: 'admin', state: 'active' },
    }),
    listTeams: async () => [],
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /tenant admin .* must be an active member/i);
});

test('scenario 4 repository batch parses exactly three normalized repositories', () => {
  const request = parseTenantRepoRequest({
    ...issueContext,
    parsedRequest: parsedRequest('repositories_csv', 'scenario-04-create-repositories.csv', {
      intake_mode: 'bulk_csv',
    }),
  });

  assert.equal(request.intake_mode, 'bulk_csv');
  assert.deepEqual(
    request.repository_entries.map((entry) => [entry.repository_name_normalized, entry.repository_visibility]),
    [['ericdemo-api', 'private'], ['ericdemo-web', 'private'], ['ericdemo-infra', 'internal']]
  );
});

test('scenario 5 ruleset batches parse create, delete, and mixed rows independently', () => {
  const create = parseRepositoryRulesetRequest({
    ...issueContext,
    rulesetOperation: 'create',
    parsedRequest: parsedRequest('rulesets_csv', 'scenario-05-create-rulesets.csv'),
  });
  const remove = parseRepositoryRulesetRequest({
    ...issueContext,
    rulesetOperation: 'delete',
    parsedRequest: parsedRequest('rulesets_csv', 'scenario-05-delete-rulesets.csv'),
  });
  const mixed = parseRepositoryRulesetRequest({
    ...issueContext,
    rulesetOperation: 'create',
    parsedRequest: parsedRequest('rulesets_csv', 'scenario-05-mixed-result.csv'),
  });

  assert.equal(create.ruleset_entries.length, 2);
  assert.equal(create.ruleset_entries.every((entry) => entry.target === 'branch' && entry.enforcement === 'active'), true);
  assert.equal(remove.ruleset_entries.length, 2);
  assert.equal(mixed.ruleset_entries.length, 2);
  assert.deepEqual(mixed.ruleset_entries.map((entry) => entry.repository), [
    'ericdemo-api',
    'repository-that-does-not-exist',
  ]);
});

test('scenario 6 variable files omit headers and enforce the DemoCorp cross-tenant rejection', async () => {
  const registryDirectory = buildRegistry();
  const options = {
    registryDirectory,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getMembershipForUser: async ({ teamSlug }) => teamSlug === 'ericdemo-root'
      ? { state: 'active', membership: { role: 'maintainer' } }
      : { state: 'absent', membership: null },
    getOrganizationMembership: async () => ({
      exists: true,
      membership: { role: 'admin', state: 'active' },
    }),
    listOrganizationVariables: async () => [],
  };

  for (const [operation, filename] of [
    ['create', 'scenario-06-create-variables.csv'],
    ['update', 'scenario-06-update-variables.csv'],
    ['delete', 'scenario-06-delete-variables.csv'],
  ]) {
    const request = parseTenantVariablesRequest({
      ...issueContext,
      parsedRequest: parsedRequest('variables_csv', filename, { variable_operation: operation }),
    });
    const validation = await validateTenantVariablesRequest(request, options);

    assert.deepEqual(request.variable_entries.map((entry) => entry.name), ['API_BASE_URL', 'DEPLOY_ENV']);
    assert.equal(validation.is_valid, true, JSON.stringify(validation.errors));
    assert.deepEqual(validation.plan.entries.map((entry) => entry.name), [
      'ERICDEMO_API_BASE_URL',
      'ERICDEMO_DEPLOY_ENV',
    ]);
  }

  const crossTenantRequest = parseTenantVariablesRequest({
    ...issueContext,
    parsedRequest: parsedRequest('variables_csv', 'scenario-06-reject-cross-tenant.csv', {
      variable_operation: 'create',
      dry_run: 'true',
    }),
  });
  const crossTenantValidation = await validateTenantVariablesRequest(crossTenantRequest, options);

  assert.equal(crossTenantValidation.is_valid, false);
  assert.match(crossTenantValidation.errors.join('\n'), /targets the namespace of tenant 'DemoCorp'/i);
});

test('scenario 7 runner lifecycle CSVs parse to the expected tenant-scoped names', () => {
  const builders = parseRunnerGroupRequest({
    ...issueContext,
    parsedRequest: parsedRequest('runner_groups_csv', 'scenario-07a-create-builders-group.csv'),
  });
  const release = parseRunnerGroupRequest({
    ...issueContext,
    parsedRequest: parsedRequest('runner_groups_csv', 'scenario-07b-create-release-group.csv'),
  });
  const runner = parseHostedRunnerRequest({
    ...issueContext,
    parsedRequest: parsedRequest('runner_csv', 'scenario-07c-create-runner.csv'),
  });
  const move = parseHostedRunnerMoveRequest({
    ...issueContext,
    parsedRequest: parsedRequest('runner_moves_csv', 'scenario-07d-move-runner.csv'),
  });
  const rejectedMove = parseHostedRunnerMoveRequest({
    ...issueContext,
    parsedRequest: parsedRequest('runner_moves_csv', 'scenario-07-reject-cross-tenant-move.csv'),
  });
  const remove = parseHostedRunnerDeletionRequest({
    ...issueContext,
    parsedRequest: parsedRequest('runner_csv', 'scenario-07e-delete-runner.csv'),
  });

  for (const request of [builders, release, runner, move, rejectedMove, remove]) {
    assert.equal(request.intake_mode, 'csv');
    assert.deepEqual(request.csv_input_errors, []);
    assert.equal(request.csv_row_count, 1);
  }
  assert.equal(builders.runner_group_name_derived, 'EricDemo_Builders');
  assert.equal(release.runner_group_name_derived, 'EricDemo_Release');
  assert.equal(runner.runner_name_derived, 'EricDemo_linux-build');
  assert.equal(runner.runner_image_id, '2295');
  assert.equal(runner.runner_group_name_input, 'EricDemo_Builders');
  assert.equal(move.target_runner_group_name_input, 'EricDemo_Release');
  assert.equal(rejectedMove.target_runner_group_name_input, 'OtherTenant_Builders');
  assert.equal(remove.runner_name_derived, 'EricDemo_linux-build');
});

test('hosted-runner form and catalog refresh use GitHub image IDs', () => {
  const form = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-tenant-hosted-runner.yml'),
    'utf8'
  );
  const refreshScript = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'refresh-runner-form-options.js'),
    'utf8'
  );

  assert.match(form, /id:\s+runner_image_id[\s\S]*?options:[\s\S]*?- "2295"/);
  assert.match(refreshScript, /\.map\(\(image\) => String\(image\.id\)\)/);
  assert.doesNotMatch(refreshScript, /\.map\(\(i\) => i\.display_name\)/);
});

test('all recording-guide form links point to issue templates in the repository', () => {
  const guideFiles = fs.readdirSync(kitDirectory).filter((name) => /^scenario-.*\.md$/.test(name));

  assert.equal(guideFiles.length, 7);
  for (const guideFile of guideFiles) {
    const guide = fs.readFileSync(path.join(kitDirectory, guideFile), 'utf8');
    for (const match of guide.matchAll(/template=([a-z0-9-]+\.yml)/g)) {
      const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', match[1]);
      assert.equal(fs.existsSync(templatePath), true, `${guideFile} references missing ${match[1]}`);
    }
  }
});
