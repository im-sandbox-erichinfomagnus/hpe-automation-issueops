'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamMembershipRequest } = require('../../src/workflow-support/parse-team-membership-request');
const { validateTeamMembershipRequest } = require('../../src/workflow-support/validate-team-membership-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'team slug') {
      fields.team_slug = value;
    } else if (heading === 'requested people') {
      fields.requested_people = value;
    } else if (heading === 'bulk csv requested people') {
      fields.bulk_csv_requested_people = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBulkCsvFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-members-bulk-csv-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  return parseFixtureMarkdown(markdown);
}

test('bulk CSV validation scaffold uses only the CSV intake path', () => {
  const parsedRequest = loadBulkCsvFixture();
  const csvLines = parsedRequest.bulk_csv_requested_people
    .replace(/^```csv\s*/i, '')
    .replace(/```$/, '')
    .trim()
    .split(/\r?\n/);

  assert.equal(parsedRequest.requested_people, '');
  assert.deepEqual(csvLines, ['username', 'octocat', 'hubot']);
  assert.equal(csvLines[0], 'username');
});

function createValidationDependencies() {
  return {
    getTeam: async () => ({ exists: true, team_sync_blocked: false }),
    resolveUser: async () => ({ exists: true }),
  };
}

test('bulk CSV requests become approval-ready for a valid header-based submission', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: loadBulkCsvFixture(),
      issue: { number: 302, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.intake_mode, 'bulk_csv');
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.deepEqual(
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
});

test('bulk CSV validation rejects submissions that omit the username header', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: '',
        bulk_csv_requested_people: '```csv\nlogin\noctocat\n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 303, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /required `username` header/i);
});

test('bulk CSV validation warns on duplicate rows but keeps the request approval-ready', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: '',
        bulk_csv_requested_people: '```csv\nusername\noctocat\n@OCTOCAT\nhubot\n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 304, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.deepEqual(
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
  assert.match(validation.warnings.join('\n'), /duplicates username octocat/i);
});

test('bulk CSV validation ignores fully blank rows while keeping valid rows approval-ready', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: '',
        bulk_csv_requested_people: '```csv\nusername\noctocat\n\n hubot \n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 305, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.deepEqual(
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
  assert.equal(validation.request.bulk_csv_submission.invalid_row_count, 0);
  assert.equal(validation.request.bulk_csv_submission.valid_row_count, 2);
  assert.deepEqual(
    validation.request.csv_row_findings.map((finding) => finding.validation_status),
    ['valid', 'blank', 'valid']
  );
});

test('bulk CSV validation rejects malformed rows with inconsistent column counts', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: '',
        bulk_csv_requested_people: '```csv\nusername\noctocat,hubot\n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 306, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /does not match the header column count/i);
});

test('bulk CSV validation rejects requests that populate both manual and CSV intake modes', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: 'octocat',
        bulk_csv_requested_people: '```csv\nusername\nhubot\n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 307, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Exactly one intake source must be populated/i);
});

test('bulk CSV validation accepts quoted usernames and normalizes them consistently', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: '',
        bulk_csv_requested_people: '```csv\nusername\n"@OctoCat"\n"hubot"\n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 308, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.deepEqual(
    validation.requested_people.map((entry) => ({
      username: entry.username,
      source_row_number: entry.source_row_number,
    })),
    [
      { username: 'octocat', source_row_number: 1 },
      { username: 'hubot', source_row_number: 2 },
    ]
  );
});