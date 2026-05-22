'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamCreationRequest } = require('../../src/workflow-support/parse-team-creation-request');
const { validateTeamCreationRequest } = require('../../src/workflow-support/validate-team-creation-request');

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
    } else if (heading === 'intake mode') {
      fields.intake_mode = value;
    } else if (heading === 'requested team names') {
      fields.requested_team_names = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBaseFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-org-teams-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  return parseFixtureMarkdown(markdown);
}

test('parses a valid create-org-teams fixture into a normalized request', () => {
  const parsedRequest = loadBaseFixture();
  const request = parseTeamCreationRequest({
    parsedRequest,
    issue: { number: 301, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.intended_owner_login, 'octocat');
  assert.deepEqual(
    request.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'release-managers']
  );
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.requested_team_names_input, parsedRequest.requested_team_names);
  assert.equal(request.bulk_csv_input, '');
  assert.equal(request.bulk_csv_submission, null);
  assert.deepEqual(request.csv_row_findings, []);
  assert.equal(request.csv_row_numbering_convention, null);
  assert.equal(request.dry_run, true);
});

test('manual create-org-teams guidance remains visible in the issue form', () => {
  const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-org-teams.yml');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /id:\s+requested_team_names/);
  assert.match(template, /manual request path/i);
  assert.match(template, /one empty team name per line/i);
});

test('tracks duplicate team names from a fixture-derived submission', () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_team_names = `${parsedRequest.requested_team_names}\nPlatform Engineering`;

  const request = parseTeamCreationRequest({
    parsedRequest,
    issue: { number: 302, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.deepEqual(
    request.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'release-managers']
  );
  assert.deepEqual(request.duplicate_team_names, ['Platform Engineering']);
});

test('normalizes requested team names from a code-fenced textarea payload', () => {
  const request = parseTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'octocat',
      requested_team_names: '```text\nPlatform Engineering\nAI Model Routing Specialists\n```',
      business_justification: 'Need empty teams',
      dry_run: 'true',
    },
    issue: { number: 305, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.deepEqual(
    request.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'ai-model-routing-specialists']
  );
  assert.deepEqual(request.invalid_team_names, []);
});

test('rejects a fixture submission with empty requested team names', async () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_team_names = '';

  const validation = await validateTeamCreationRequest({
    parsedRequest,
    issue: { number: 303, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /At least one valid requested team name is required/);
});

test('rejects conflicting normalized team slugs', async () => {
  const request = parseTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'octocat',
      requested_team_names: 'Platform Engineering\nPlatform-Engineering',
      business_justification: 'Need empty teams',
      dry_run: 'true',
    },
    issue: { number: 304, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamCreationRequest(request);

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Conflicting normalized team slugs/i);
});

test('preserves manual-mode validation defaults while exposing empty CSV metadata', async () => {
  const parsedRequest = loadBaseFixture();

  const validation = await validateTeamCreationRequest({
    parsedRequest,
    issue: { number: 308, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(validation.request.intake_mode, 'manual');
  assert.equal(validation.request.bulk_csv_submission, null);
  assert.deepEqual(validation.request.csv_row_findings, []);
  assert.equal(validation.request.csv_row_numbering_convention, null);
  assert.equal(validation.request.requested_team_names_input, parsedRequest.requested_team_names);
});

test('manual create-org-teams fixture remains a manual-only request surface before attachment handling is added', async () => {
  const parsedRequest = loadBaseFixture();

  const validation = await validateTeamCreationRequest({
    parsedRequest,
    issue: { number: 309, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(validation.request.intake_mode, 'manual');
  assert.equal(validation.request.requested_team_names_input, parsedRequest.requested_team_names);
  assert.equal(validation.request.bulk_csv_input, '');
  assert.equal(validation.request.request_status, validation.is_valid ? 'awaiting_approval' : 'validation_failed');
});

test('rejects out-of-scope parent-team input with a clear message', async () => {
  const validation = await validateTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'octocat',
      requested_team_names: 'Platform Engineering',
      parent_team: 'platform',
      business_justification: 'Need empty teams',
      dry_run: 'true',
    },
    issue: { number: 306, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /parent-team input is out of scope/i);
});

test('rejects out-of-scope team member instructions with a clear message', async () => {
  const validation = await validateTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'octocat',
      requested_team_names: 'Platform Engineering',
      requested_people: 'octocat\nmonalisa',
      business_justification: 'Need empty teams',
      dry_run: 'true',
    },
    issue: { number: 307, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /only creates empty teams/i);
});

test('explicit intake_mode manual dropdown preserves manual request behavior identical to legacy inference', () => {
  const parsedRequest = loadBaseFixture();
  assert.equal(parsedRequest.intake_mode, 'manual');

  const request = parseTeamCreationRequest({
    parsedRequest,
    issue: { number: 310, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.intake_mode, 'manual');
  assert.deepEqual(
    request.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'release-managers']
  );
  assert.equal(request.bulk_csv_submission, null);
  assert.equal(request.csv_row_numbering_convention, null);
  assert.equal(request.accepted_attachment_submission.acceptance_status, 'waiting');
});

test('intake_mode csv_attachment with empty requested team names produces waiting-eligible parsed request', () => {
  const request = parseTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'octocat',
      intake_mode: 'csv_attachment',
      requested_team_names: '',
      business_justification: 'Need empty teams',
      dry_run: 'true',
    },
    issue: { number: 311, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.intake_mode, 'csv_attachment');
  assert.deepEqual(request.requested_teams, []);
  assert.equal(request.request_status, 'submitted');
  assert.equal(request.accepted_attachment_submission.acceptance_status, 'waiting');
  assert.equal(request.attachment_validation_attempt.attempt_status, 'waiting');
  assert.equal(request.csv_row_numbering_convention, '1-based data-row numbers that exclude the header row');
});

test('issue form provides an intake_mode dropdown with manual and csv_attachment options', () => {
  const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-org-teams.yml');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /id:\s+intake_mode/);
  assert.match(template, /- .?manual.?/i);
  assert.match(template, /- .?csv_attachment.?/i);
  assert.doesNotMatch(template, /id:\s+bulk_csv_requested_team_names/);
});

test('rejects normalized requests whose teams do not share the same intended owner', async () => {
  const validation = await validateTeamCreationRequest({
    request_id: 'octo-org/issueops-speckit#308/local.1',
    issue_number: 308,
    repository: 'octo-org/issueops-speckit',
    requester_login: 'requester',
    organization: 'octo-org',
    intended_owner_login: 'octocat',
    requested_teams: [
      {
        requested_name: 'Platform Engineering',
        normalized_slug: 'platform-engineering',
        intended_owner_login: 'octocat',
      },
      {
        requested_name: 'Release Managers',
        normalized_slug: 'release-managers',
        intended_owner_login: 'monalisa',
      },
    ],
    invalid_team_names: [],
    duplicate_team_names: [],
    conflicting_slugs: [],
    dry_run: true,
    unsupported_inputs: {
      parent_team: '',
      requested_people: '',
    },
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /single intended owner/i);
  assert.match(validation.errors.join('\n'), /split the batch/i);
});