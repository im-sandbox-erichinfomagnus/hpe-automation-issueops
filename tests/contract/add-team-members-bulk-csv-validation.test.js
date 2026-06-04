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
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        intake_mode: 'manual',
        requested_people: 'octocat\nhubot',
        business_justification: 'Access is required to support the release pipeline.',
        dry_run: 'true',
      },
      issue: { number: 302, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.intake_mode, 'manual');
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.deepEqual(
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
});

test('bulk CSV validation rejects the legacy bulk CSV textarea intake', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        requested_people: '',
        bulk_csv_requested_people: '```csv\nusername\noctocat\n```',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 303, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /bulk CSV textarea intake is no longer supported/i);
});

test('bulk CSV validation warns on duplicate rows but keeps the request approval-ready', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        intake_mode: 'manual',
        requested_people: 'octocat\n@OCTOCAT\nhubot',
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
  assert.match(validation.warnings.join('\n'), /Duplicate usernames were deduplicated: octocat/i);
});

test('bulk CSV validation ignores fully blank rows while keeping valid rows approval-ready', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        intake_mode: 'manual',
        requested_people: 'octocat\n\n hubot ',
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
});

test('bulk CSV validation rejects manual intake with no people provided', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        intake_mode: 'manual',
        requested_people: '',
        business_justification: 'Need support access',
        dry_run: 'true',
      },
      issue: { number: 306, user: { login: 'requester' } },
      repository: 'octo-org/issueops-speckit',
    },
    createValidationDependencies()
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /At least one valid requested person is required/i);
});

test('bulk CSV validation rejects requests that populate both manual and CSV intake modes', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        intake_mode: 'manual',
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
  assert.match(validation.errors.join('\n'), /bulk CSV textarea intake is no longer supported/i);
});

test('bulk CSV validation accepts quoted usernames and normalizes them consistently', async () => {
  const validation = await validateTeamMembershipRequest(
    {
      parsedRequest: {
        organization: 'octo-org',
        team_slug: 'platform-engineering',
        intake_mode: 'manual',
        requested_people: '@OctoCat\nhubot',
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
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
});