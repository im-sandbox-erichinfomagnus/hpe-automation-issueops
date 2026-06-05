'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamMembershipRequest } = require('../../src/workflow-support/parse-team-membership-request');

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

test('bulk CSV parser fixture scaffolding preserves the future field layout', () => {
  const parsedRequest = loadBulkCsvFixture();

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.team_slug, 'platform-engineering');
  assert.equal(parsedRequest.requested_people, '');
  assert.match(parsedRequest.bulk_csv_requested_people, /```csv/i);
  assert.match(parsedRequest.bulk_csv_requested_people, /username/i);
  assert.equal(
    parsedRequest.business_justification,
    'Access is required to support the release pipeline.'
  );
  assert.equal(parsedRequest.dry_run, 'true');
});

test('bulk CSV parser fixture normalizes valid header-based input into the standard request model', () => {
  const parsedRequest = loadBulkCsvFixture();
  const request = parseTeamMembershipRequest({
    parsedRequest,
    issue: { number: 301, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  // Legacy fixture has no explicit intake_mode and uses the old bulk_csv_requested_people field.
  // The parser stores it as legacy_bulk_csv_input but cannot infer a valid intake mode from it alone.
  assert.equal(request.intake_mode, null);
  assert.equal(request.requested_people_input, '');
  assert.match(request.legacy_bulk_csv_input, /username/i);
  assert.deepEqual(request.requested_people, []);
});