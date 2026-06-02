'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateTeamRepoAccessRequest } = require('../../src/workflow-support/validate-team-repo-access-request');

function readContract() {
  const contractPath = path.join(
    __dirname,
    '..',
    '..',
    'specs',
    '009-add-team-repo-access-bulk-csv-mode',
    'contracts',
    'add-team-repo-access-bulk-csv-workflow.yaml'
  );
  return fs.readFileSync(contractPath, 'utf8');
}

function readQuickstart() {
  const quickstartPath = path.join(
    __dirname,
    '..',
    '..',
    'specs',
    '009-add-team-repo-access-bulk-csv-mode',
    'quickstart.md'
  );
  return fs.readFileSync(quickstartPath, 'utf8');
}

test('contract and quickstart align on exactly-one-intake-mode and required repository header', () => {
  const contract = readContract();
  const quickstart = readQuickstart();

  assert.match(contract, /Exactly one intake source must be populated/i);
  assert.match(contract, /required column `repository`/i);
  assert.match(quickstart, /Exactly one intake field must be populated/i);
  assert.match(quickstart, /containing the `repository` header/i);
});

test('contract preserves request-scoped permission and approver semantics outside CSV rows', () => {
  const contract = readContract();

  assert.match(contract, /single repository-access approver who must approve the full request batch/i);
  assert.match(contract, /Built-in repository permission level to grant for the full request batch/i);
  assert.match(contract, /Must not include row-level organization, team, permission, approver/i);
  assert.match(contract, /Duplicate or conflicting CSV repository rows are rejected/i);
});

function createValidationDependencies(overrides = {}) {
  return {
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async () => ({
      exists: true,
      team: { id: 1, name: 'Platform Engineering', slug: 'platform-engineering' },
    }),
    getOrganizationMembership: async () => ({
      exists: true,
      membership: { role: 'admin', state: 'active' },
    }),
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        id: `${owner}/${repo}`,
        name: repo,
        full_name: `${owner}/${repo}`,
        owner,
        archived: false,
        private: true,
      },
    }),
    getTeamRepositoryPermission: async () => ({
      exists: false,
      current_permission_api_value: 'none',
    }),
    ...overrides,
  };
}

test('bulk CSV validation accepts a valid header-based submission', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\ndeveloper-portal\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 903, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.intake_mode, 'bulk_csv');
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.deepEqual(
    validation.requested_repository_grants.map((grant) => grant.repository_full_name),
    ['octo-org/service-catalog', 'octo-org/developer-portal']
  );
});

test('bulk CSV validation rejects submissions that omit the required repository header', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nname\nservice-catalog\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 904, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /required `repository` header/i);
});

test('bulk CSV validation rejects malformed rows with inconsistent column counts', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog,developer-portal\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 905, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /does not match the header column count/i);
});

test('bulk CSV validation rejects duplicate rows', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\nservice-catalog\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 906, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /duplicates repository service-catalog/i);
});

test('bulk CSV validation rejects conflicting normalized repository identifiers', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\nocto-org/service-catalog\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 907, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /conflicts with another row after repository normalization/i);
  assert.match(validation.errors.join('\n'), /Conflicting normalized repository identifiers/i);
});

test('bulk CSV validation ignores blank rows while keeping valid rows approval-ready', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\n\n developer-portal \n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 908, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.bulk_csv_submission.valid_row_count, 2);
  assert.equal(validation.request.bulk_csv_submission.invalid_row_count, 0);
  assert.deepEqual(
    validation.request.csv_row_findings.map((finding) => finding.validation_status),
    ['valid', 'blank', 'valid']
  );
});

test('bulk CSV validation rejects unsupported columns', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository,permission\nservice-catalog,write\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 909, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /unsupported columns: permission/i);
});

test('bulk CSV validation accepts quoted repository values and supported built-in permission roles', async () => {
  for (const permissionLevel of ['read', 'triage', 'write', 'maintain', 'admin']) {
    const validation = await validateTeamRepoAccessRequest({
      parsedRequest: {
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        bulk_csv_requested_repositories: '```csv\nrepository\n"service-catalog"\n```',
        permission_level: permissionLevel,
        business_justification: 'Need repository access',
        dry_run: 'true',
      },
      issue: { number: 910, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    }, createValidationDependencies());

    assert.equal(validation.is_valid, true, `${permissionLevel} should be accepted`);
    assert.equal(validation.request.requested_permission_label, permissionLevel);
  }
});

test('bulk CSV validation rejects archived repositories before approval readiness', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\narchived-portal\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 9101, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        id: `${owner}/${repo}`,
        name: repo,
        full_name: `${owner}/${repo}`,
        owner,
        archived: true,
        private: true,
      },
    }),
  }));

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /archived repositories are blocked/i);
});

test('bulk CSV validation rejects unsupported custom roles', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\n```',
      permission_level: 'custom-role',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 911, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /supported built-in repository role is required/i);
});

test('bulk CSV validation rejects requests that populate both manual and CSV intake modes', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: 'service-catalog',
      bulk_csv_requested_repositories: '```csv\nrepository\ndeveloper-portal\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 912, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Exactly one intake source must be populated/i);
});

test('bulk CSV validation rejects requests that populate neither intake mode', async () => {
  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 913, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Exactly one intake source must be populated/i);
  assert.match(validation.errors.join('\n'), /At least one valid requested repository is required/i);
});
