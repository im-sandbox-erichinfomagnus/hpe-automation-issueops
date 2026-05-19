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

function loadBaseFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-members-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  return parseFixtureMarkdown(markdown);
}

test('parses a valid submission fixture into a normalized request', () => {
  const parsedRequest = loadBaseFixture();
  const request = parseTeamMembershipRequest({
    parsedRequest,
    issue: { number: 101, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.team_slug, 'platform-engineering');
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.requested_people_input, parsedRequest.requested_people);
  assert.equal(request.bulk_csv_input, '');
  assert.deepEqual(request.requested_people, ['octocat', 'hubot']);
  assert.deepEqual(request.csv_row_findings, []);
  assert.equal(
    request.csv_row_numbering_convention,
    '1-based data-row numbers that exclude the header row'
  );
  assert.equal(request.dry_run, true);
  assert.equal(request.business_justification, 'Access is required to support the release pipeline.');
});

test('tracks duplicate usernames from a fixture-derived submission', () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_people = `${parsedRequest.requested_people}\noctocat`;

  const request = parseTeamMembershipRequest({
    parsedRequest,
    issue: { number: 102, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.deepEqual(request.requested_people, ['octocat', 'hubot']);
  assert.deepEqual(request.duplicate_people, ['octocat']);
});

test('normalizes usernames from a code-fenced textarea payload', () => {
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: '```text\noctocat\nhubot\n```',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 104, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.deepEqual(request.requested_people, ['octocat', 'hubot']);
  assert.deepEqual(request.invalid_people, []);
});

test('tracks invalid usernames without dropping the valid subset', () => {
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: 'octocat\nnot a login\n@hubot',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 105, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.deepEqual(request.requested_people, ['octocat', 'hubot']);
  assert.deepEqual(request.invalid_people, ['not a login']);
});

test('manual requests remain valid when the CSV field is omitted entirely', () => {
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: 'octocat\nhubot',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 106, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.requested_people_input, 'octocat\nhubot');
  assert.equal(request.bulk_csv_input, '');
  assert.equal(request.bulk_csv_submission.schema_status, 'not_provided');
  assert.deepEqual(request.requested_people, ['octocat', 'hubot']);
});

test('rejects an empty requested-people fixture submission', async () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_people = '';

  const validation = await validateTeamMembershipRequest({
    parsedRequest,
    issue: { number: 103, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request.intake_mode, null);
  assert.deepEqual(validation.request.csv_row_findings, []);
  assert.match(validation.errors.join('\n'), /At least one valid requested person is required/);
});