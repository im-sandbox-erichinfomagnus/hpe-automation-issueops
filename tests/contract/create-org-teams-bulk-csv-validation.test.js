'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateTeamCreationRequest } = require('../../src/workflow-support/validate-team-creation-request');

function loadBulkCsvFixtureMarkdown() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-org-teams-bulk-csv-issue.md');
  return fs.readFileSync(fixturePath, 'utf8');
}

test('stores the bulk CSV fixture scaffold with the required team_name header', () => {
  const fixtureMarkdown = loadBulkCsvFixtureMarkdown();

  assert.match(fixtureMarkdown, /^### Bulk CSV requested team names$/m);
  assert.match(fixtureMarkdown, /```csv[\s\S]*team_name/);
});

function createValidationDependencies() {
  return {
    getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
  };
}

test('bulk CSV requests become approval-ready for a valid header-based submission', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 603, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.intake_mode, 'bulk_csv');
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.deepEqual(
    validation.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'release-managers']
  );
});

test('bulk CSV validation rejects submissions that omit the required team_name header', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nname\nPlatform Engineering\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 604, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /required `team_name` header/i);
});

test('bulk CSV validation warns on duplicate rows but keeps the request approval-ready', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nplatform engineering\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 605, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.deepEqual(
    validation.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'release-managers']
  );
  assert.match(validation.warnings.join('\n'), /duplicates team platform engineering/i);
});

test('bulk CSV validation ignores fully blank rows while keeping valid rows approval-ready', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\n\n Release Managers \n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 606, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.bulk_csv_submission.invalid_row_count, 0);
  assert.equal(validation.request.bulk_csv_submission.valid_row_count, 2);
  assert.deepEqual(
    validation.request.csv_row_findings.map((finding) => finding.validation_status),
    ['valid', 'blank', 'valid']
  );
});

test('bulk CSV validation rejects malformed rows with inconsistent column counts', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering,Release Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 607, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /does not match the header column count/i);
});

test('bulk CSV validation rejects conflicting normalized team slugs across rows', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nPlatform-Engineering\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 608, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /conflicts with another row after slug normalization/i);
  assert.match(validation.errors.join('\n'), /Conflicting normalized team slugs/i);
});

test('bulk CSV validation rejects unsupported columns', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name,parent_team\nPlatform Engineering,platform\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 609, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /unsupported columns: parent_team/i);
});

test('bulk CSV validation rejects requests that populate both manual and CSV intake modes', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: 'Platform Engineering',
        bulk_csv_requested_team_names: '```csv\nteam_name\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 610, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Exactly one intake source must be populated/i);
});

test('bulk CSV validation accepts quoted team names and normalizes them consistently', async () => {
  const validation = await validateTeamCreationRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\n"Platform Engineering"\n"Release Managers"\n```',
        business_justification: 'Need empty teams',
        dry_run: 'true',
      },
      issue: { number: 611, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.deepEqual(
    validation.requested_teams.map((entry) => ({
      requested_name: entry.requested_name,
      normalized_slug: entry.normalized_slug,
      source_row_number: entry.source_row_number,
    })),
    [
      { requested_name: 'Platform Engineering', normalized_slug: 'platform-engineering', source_row_number: 1 },
      { requested_name: 'Release Managers', normalized_slug: 'release-managers', source_row_number: 2 },
    ]
  );
});