'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseParsedRequestJson,
  readParsedRequestFromEnv,
  runRequestValidation,
} = require('../../src/scripts/run-request-validation');

test('readParsedRequestFromEnv prefers the parser JSON payload for multi-user requests', () => {
  const parsedRequest = readParsedRequestFromEnv({
    PARSED_REQUEST_JSON: JSON.stringify({
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: ['existing-user', 'new-user'],
      business_justification: 'Need access',
      dry_run: false,
    }),
    PARSED_REQUESTED_PEOPLE: 'existing-user',
  });

  assert.deepEqual(parsedRequest.requested_people, ['existing-user', 'new-user']);
  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.team_slug, 'platform-engineering');
});

test('parseParsedRequestJson returns null for invalid parser JSON values', () => {
  assert.equal(parseParsedRequestJson('{not valid json'), null);
});

test('readParsedRequestFromEnv falls back to hierarchy-specific env fields when parser JSON is absent', () => {
  const parsedRequest = readParsedRequestFromEnv({
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_PARENT_TEAM: 'Platform Engineering',
    PARSED_DESIGNATED_APPROVER: 'octocat',
    PARSED_REQUESTED_CHILD_TEAMS: 'Application Platform\nRelease Engineering',
    PARSED_BUSINESS_JUSTIFICATION: 'Need hierarchy changes',
    PARSED_DRY_RUN: 'false',
  });

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.parent_team, 'Platform Engineering');
  assert.equal(parsedRequest.designated_approver, 'octocat');
  assert.equal(parsedRequest.requested_child_teams, 'Application Platform\nRelease Engineering');
  assert.equal(parsedRequest.dry_run, 'false');
});

test('runRequestValidation records hierarchy audit metadata and missing-token failures when no workflow token is available', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-missing-token-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '611',
      REQUESTER_LOGIN: 'requester',
      PARSED_PARENT_TEAM: 'Platform Engineering',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_DESIGNATED_APPROVER: 'octocat',
      PARSED_REQUESTED_CHILD_TEAMS: 'Application Platform',
      PARSED_BUSINESS_JUSTIFICATION: 'Need hierarchy updates',
      PARSED_DRY_RUN: 'true',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /workflow token secret is missing/i);
  assert.equal(persisted.metadata.operation, 'team_hierarchy');
  assert.equal(persisted.request.parent_team_slug, 'platform-engineering');
  assert.equal(persisted.execution.failure_count, 0);
  assert.match(persisted.execution.summary, /No child-team mutation was attempted/i);
});