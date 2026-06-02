'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateTeamHierarchyRequest } = require('../../src/workflow-support/validate-team-hierarchy-request');

function loadBulkCsvFixtureMarkdown() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-child-teams-bulk-csv-issue.md');
  return fs.readFileSync(fixturePath, 'utf8');
}

test('stores the add-child-teams bulk CSV fixture scaffold with the required child_team header', () => {
  const fixtureMarkdown = loadBulkCsvFixtureMarkdown();

  assert.match(fixtureMarkdown, /^### Bulk CSV requested child teams$/m);
  assert.match(fixtureMarkdown, /```csv[\s\S]*child_team/);
});

function createValidationDependencies() {
  return {
    getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
    listTeams: async () => ([
      { id: 1, name: 'Platform Engineering', slug: 'platform-engineering', parent: null },
      { id: 2, name: 'Application Platform', slug: 'application-platform', parent: null },
      { id: 3, name: 'Release Engineering', slug: 'release-engineering', parent: null },
      { id: 4, name: 'Release-Engineering', slug: 'release-engineering-2', parent: null },
    ]),
    resolveTeamMembership: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
  };
}

test('bulk CSV validation accepts a valid header-based submission', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 803, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.intake_mode, 'bulk_csv');
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.deepEqual(
    validation.requested_child_links.map((childLink) => childLink.child_team_slug),
    ['application-platform', 'release-engineering']
  );
});

test('bulk CSV validation rejects submissions that omit the required child_team header', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nname\nApplication Platform\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 804, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /required `child_team` header/i);
});

test('bulk CSV validation rejects duplicate rows', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\napplication platform\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 805, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request.bulk_csv_submission.schema_status, 'invalid');
  assert.equal(validation.request.bulk_csv_submission.duplicate_row_count, 1);
  assert.match(validation.errors.join('\n'), /duplicates child team application platform/i);
});

test('bulk CSV validation ignores fully blank rows while keeping valid rows approval-ready', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\n\n Release Engineering \n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 806, user: { login: 'requester' } },
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
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform,Release Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 807, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /does not match the header column count/i);
});

test('bulk CSV validation rejects conflicting normalized child-team slugs across rows', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nRelease Engineering\nRelease-Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 808, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /conflicts with another row after slug normalization/i);
  assert.match(validation.errors.join('\n'), /Conflicting normalized child-team slugs/i);
});

test('bulk CSV validation rejects unsupported columns', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team,parent_team\nApplication Platform,platform\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 809, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /unsupported columns: parent_team/i);
});

test('bulk CSV validation rejects requests that populate both manual and CSV intake modes', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: 'Application Platform',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 810, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Exactly one intake source must be populated/i);
});

test('bulk CSV validation accepts quoted child-team names and normalizes them consistently', async () => {
  const validation = await validateTeamHierarchyRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\n"Application Platform"\n"Release Engineering"\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: 'true',
      },
      issue: { number: 811, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.deepEqual(
    validation.requested_child_links.map((entry) => ({
      requested_name: entry.requested_name,
      child_team_slug: entry.child_team_slug,
      source_row_number: entry.source_row_number,
    })),
    [
      { requested_name: 'Application Platform', child_team_slug: 'application-platform', source_row_number: 1 },
      { requested_name: 'Release Engineering', child_team_slug: 'release-engineering', source_row_number: 2 },
    ]
  );
});