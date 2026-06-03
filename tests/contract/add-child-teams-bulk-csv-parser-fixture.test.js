'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamHierarchyRequest } = require('../../src/workflow-support/parse-team-hierarchy-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'parent team') {
      fields.parent_team = value;
    } else if (heading === 'designated hierarchy approver') {
      fields.designated_approver = value;
    } else if (heading === 'bulk csv requested child teams') {
      fields.bulk_csv_requested_child_teams = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBulkCsvFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-child-teams-bulk-csv-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

test('loads the add-child-teams bulk CSV fixture scaffold', () => {
  const fixture = loadBulkCsvFixture();

  assert.equal(fixture.organization, 'octo-org');
  assert.equal(fixture.parent_team, 'Platform Engineering');
  assert.equal(fixture.designated_approver, 'octocat');
  assert.match(fixture.bulk_csv_requested_child_teams, /child_team/);
  assert.equal(fixture.dry_run, 'true');
});

test('issue form exposes exactly-one-mode add-child-teams intake fields', () => {
  const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'add-child-teams.yml');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /id:\s+requested_child_teams/);
  assert.match(template, /id:\s+intake_mode/);
  assert.match(template, /csv_attachment/);
  assert.match(template, /requested_child_teams[\s\S]*required:\s+false/i);
  assert.match(template, /intake_mode[\s\S]*required:\s+true/i);
});

test('parses a valid add-child-teams bulk CSV fixture into a normalized request', () => {
  const parsedRequest = loadBulkCsvFixture();
  const request = parseTeamHierarchyRequest({
    parsedRequest,
    issue: { number: 801, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.parent_team_slug, 'platform-engineering');
  assert.equal(request.designated_approver_login, 'octocat');
  assert.equal(request.intake_mode, 'bulk_csv');
  assert.equal(request.requested_child_teams_input, '');
  assert.match(request.bulk_csv_input, /child_team/);
  assert.deepEqual(
    request.requested_child_links.map((childLink) => ({
      requested_name: childLink.requested_name,
      child_team_slug: childLink.child_team_slug,
      source_row_number: childLink.source_row_number,
    })),
    [
      {
        requested_name: 'Application Platform',
        child_team_slug: 'application-platform',
        source_row_number: 1,
      },
      {
        requested_name: 'Release Engineering',
        child_team_slug: 'release-engineering',
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

test('normalizes code-fenced and quoted child-team rows from the bulk CSV fixture pattern', () => {
  const request = parseTeamHierarchyRequest({
    parsedRequest: {
      organization: 'octo-org',
      parent_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_child_teams: '',
      bulk_csv_requested_child_teams: '```csv\nchild_team\n"Application Platform"\n"Release Engineering"\n```',
      business_justification: 'Need hierarchy updates',
      dry_run: 'true',
    },
    issue: { number: 802, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.intake_mode, 'bulk_csv');
  assert.deepEqual(
    request.requested_child_links.map((childLink) => ({
      requested_name: childLink.requested_name,
      child_team_slug: childLink.child_team_slug,
      source_row_number: childLink.source_row_number,
    })),
    [
      {
        requested_name: 'Application Platform',
        child_team_slug: 'application-platform',
        source_row_number: 1,
      },
      {
        requested_name: 'Release Engineering',
        child_team_slug: 'release-engineering',
        source_row_number: 2,
      },
    ]
  );
});