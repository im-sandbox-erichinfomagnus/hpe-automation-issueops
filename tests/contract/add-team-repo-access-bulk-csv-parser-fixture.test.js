'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamRepoAccessRequest } = require('../../src/workflow-support/parse-team-repo-access-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'target team') {
      fields.target_team = value;
    } else if (heading === 'designated repository-access approver') {
      fields.designated_approver = value;
    } else if (heading === 'bulk csv requested repositories') {
      fields.bulk_csv_requested_repositories = value;
    } else if (heading === 'requested permission level') {
      fields.permission_level = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBulkCsvFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-bulk-csv-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

function loadIssueTemplate() {
  const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'add-team-repo-access.yml');
  return fs.readFileSync(templatePath, 'utf8');
}

test('loads the add-team-repo-access bulk CSV fixture scaffold', () => {
  const fixture = loadBulkCsvFixture();

  assert.equal(fixture.organization, 'octo-org');
  assert.equal(fixture.target_team, 'Platform Engineering');
  assert.equal(fixture.designated_approver, 'octocat');
  assert.equal(fixture.permission_level, 'write');
  assert.equal(fixture.dry_run, 'true');
  assert.match(fixture.bulk_csv_requested_repositories, /```csv[\s\S]*repository/i);
});

test('bulk CSV fixture keeps organization, team, approver, and permission request-scoped', () => {
  const fixture = loadBulkCsvFixture();

  assert.match(fixture.bulk_csv_requested_repositories, /^```csv[\s\S]*^repository$/m);
  assert.doesNotMatch(fixture.bulk_csv_requested_repositories, /organization|target_team|permission|approver/i);
});

test('issue form preserves manual+csv_attachment intake fields while bulk CSV textarea remains retired', () => {
  const template = loadIssueTemplate();

  assert.match(template, /id:\s+requested_repositories/);
  assert.match(template, /id:\s+intake_mode/);
  assert.match(template, /-\s+csv_attachment/i);
  assert.doesNotMatch(template, /id:\s+bulk_csv_requested_repositories/);
  assert.match(template, /requested_repositories[\s\S]*required:\s+false/i);
});

test('parses a valid add-team-repo-access bulk CSV fixture into a normalized request', () => {
  const parsedRequest = loadBulkCsvFixture();
  const request = parseTeamRepoAccessRequest({
    parsedRequest,
    issue: { number: 901, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.team_slug, 'platform-engineering');
  assert.equal(request.designated_approver_login, 'octocat');
  assert.equal(request.intake_mode, 'bulk_csv');
  assert.equal(request.requested_repositories_input, '');
  assert.match(request.bulk_csv_input, /repository/);
  assert.equal(request.requested_permission_label, 'write');
  assert.deepEqual(
    request.requested_repository_grants.map((grant) => ({
      repository_full_name: grant.repository_full_name,
      source_row_number: grant.source_row_number,
    })),
    [
      { repository_full_name: 'octo-org/service-catalog', source_row_number: 1 },
      { repository_full_name: 'octo-org/developer-portal', source_row_number: 2 },
    ]
  );
  assert.equal(request.bulk_csv_submission.schema_status, 'valid');
  assert.equal(request.bulk_csv_submission.valid_row_count, 2);
  assert.equal(request.bulk_csv_submission.duplicate_row_count, 0);
  assert.equal(request.bulk_csv_submission.invalid_row_count, 0);
  assert.deepEqual(
    request.csv_row_findings.map((finding) => finding.validation_status),
    ['valid', 'valid']
  );
});

test('parses quoted CSV repository values into the same normalized grants', () => {
  const request = parseTeamRepoAccessRequest({
    parsedRequest: {
      organization: 'octo-org',
      target_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_repositories: '',
      bulk_csv_requested_repositories: '```csv\nrepository\n"service-catalog"\n"developer-portal"\n```',
      permission_level: 'write',
      business_justification: 'Need repository access',
      dry_run: 'true',
    },
    issue: { number: 902, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.intake_mode, 'bulk_csv');
  assert.deepEqual(
    request.requested_repository_grants.map((grant) => grant.repository_full_name),
    ['octo-org/service-catalog', 'octo-org/developer-portal']
  );
});
