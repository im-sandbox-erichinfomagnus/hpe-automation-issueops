'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamCreationRequest } = require('../../src/workflow-support/parse-team-creation-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'intended owner') {
      fields.intended_owner = value;
    } else if (heading === 'bulk csv requested team names') {
      fields.bulk_csv_requested_team_names = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBulkCsvFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-org-teams-bulk-csv-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

test('loads the create-org-teams bulk CSV fixture scaffold', () => {
  const fixture = loadBulkCsvFixture();

  assert.equal(fixture.organization, 'octo-org');
  assert.equal(fixture.intended_owner, 'octocat');
  assert.match(fixture.bulk_csv_requested_team_names, /team_name/);
  assert.equal(fixture.dry_run, 'true');
});

test('issue form exposes exactly-one-mode create-org-teams intake fields', () => {
  const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-org-teams.yml');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /id:\s+requested_team_names/);
  assert.match(template, /id:\s+bulk_csv_requested_team_names/);
  assert.match(template, /validation enforces exactly one populated intake mode/i);
  assert.match(template, /requested_team_names[\s\S]*required:\s+false/i);
  assert.match(template, /bulk_csv_requested_team_names[\s\S]*required:\s+false/i);
});

test('parses a valid create-org-teams bulk CSV fixture into a normalized request', () => {
  const parsedRequest = loadBulkCsvFixture();
  const request = parseTeamCreationRequest({
    parsedRequest,
    issue: { number: 601, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.intended_owner_login, 'octocat');
  assert.equal(request.intake_mode, 'bulk_csv');
  assert.equal(request.requested_team_names_input, '');
  assert.match(request.bulk_csv_input, /team_name/);
  assert.deepEqual(
    request.requested_teams.map((team) => ({
      requested_name: team.requested_name,
      normalized_slug: team.normalized_slug,
      source_row_number: team.source_row_number,
    })),
    [
      {
        requested_name: 'Platform Engineering',
        normalized_slug: 'platform-engineering',
        source_row_number: 1,
      },
      {
        requested_name: 'Release Managers',
        normalized_slug: 'release-managers',
        source_row_number: 2,
      },
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
  assert.equal(
    request.csv_row_numbering_convention,
    '1-based data-row numbers that exclude the header row'
  );
});

test('normalizes code-fenced and quoted CSV team names from the bulk CSV fixture pattern', () => {
  const request = parseTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'octocat',
      requested_team_names: '',
      bulk_csv_requested_team_names: '```csv\nteam_name\n"Platform Engineering"\n"Release Managers"\n```',
      business_justification: 'Need empty teams',
      dry_run: 'true',
    },
    issue: { number: 602, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.intake_mode, 'bulk_csv');
  assert.deepEqual(
    request.requested_teams.map((team) => ({
      requested_name: team.requested_name,
      normalized_slug: team.normalized_slug,
      source_row_number: team.source_row_number,
    })),
    [
      {
        requested_name: 'Platform Engineering',
        normalized_slug: 'platform-engineering',
        source_row_number: 1,
      },
      {
        requested_name: 'Release Managers',
        normalized_slug: 'release-managers',
        source_row_number: 2,
      },
    ]
  );
});