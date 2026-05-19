'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildAuditArtifact } = require('../../src/workflow-support/build-audit-artifact');
const { parseTeamMembershipRequest } = require('../../src/workflow-support/parse-team-membership-request');
const { validateTeamMembershipRequest } = require('../../src/workflow-support/validate-team-membership-request');
const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadValidationFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-validation.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createValidationDependencies(scenario) {
  return {
    getTeam: async () => scenario.team,
    resolveUser: async ({ username }) => scenario.memberships[username] || { exists: false },
  };
}

test('routes a valid existing-team request to approval-ready state', async () => {
  const fixture = loadValidationFixture().existing_team;
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: 'octocat\nhubot',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 201, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamMembershipRequest(
    request,
    createValidationDependencies(fixture)
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.team_exists, true);
  assert.deepEqual(
    validation.requested_people.map((entry) => entry.username),
    ['octocat', 'hubot']
  );
});

test('manual requests retain approval-ready intake metadata in the audit summary', async () => {
  const fixture = loadValidationFixture().existing_team;
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: 'octocat\nhubot',
      bulk_csv_requested_people: '',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 210, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamMembershipRequest(
    request,
    createValidationDependencies(fixture)
  );
  const auditArtifact = buildAuditArtifact({
    request: validation.request,
    validation,
    approval: {
      approval_status: 'pending',
      approver_role: 'other',
    },
  });
  const summary = formatAuditSummary(auditArtifact);

  assert.equal(validation.request.intake_mode, 'manual');
  assert.deepEqual(validation.request.csv_row_findings, []);
  assert.match(summary, /Intake mode: manual/i);
  assert.doesNotMatch(summary, /CSV row findings:/i);
  assert.doesNotMatch(summary, /CSV valid rows:/i);
  assert.doesNotMatch(summary, /CSV duplicate rows:/i);
  assert.doesNotMatch(summary, /CSV invalid rows:/i);
  assert.doesNotMatch(summary, /CSV row numbering:/i);
});

test('fails validation when the target team does not exist', async () => {
  const fixture = loadValidationFixture().missing_team;
  const request = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'missing-team',
      requested_people: 'octocat',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 202, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamMembershipRequest(
    request,
    createValidationDependencies(fixture)
  );

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /target team does not exist/i);
});

test('manual requests remain approval-ready through runRequestValidation without CSV input', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-manual-request-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '613',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_REQUESTED_PEOPLE: 'octocat\nhubot',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'true',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getTeamBySlug: async () => ({ exists: true, team_sync_blocked: false }),
      getOrganizationMembership: async () => ({ exists: true }),
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(persisted.request.intake_mode, 'manual');
  assert.deepEqual(persisted.request.requested_people, ['octocat', 'hubot']);
  assert.match(summary, /Intake mode: manual/i);
  assert.doesNotMatch(summary, /CSV row findings:/i);
  assert.match(summary, /Request is validated and ready for approval. No membership mutation was attempted\./i);
});

test('runRequestValidation rejects ambiguous membership intake when both manual and CSV fields are populated', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-ambiguous-request-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '614',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_REQUESTED_PEOPLE: 'octocat',
      PARSED_BULK_CSV_REQUESTED_PEOPLE: '```csv\nusername\nhubot\n```',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'true',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getTeamBySlug: async () => ({ exists: true, team_sync_blocked: false }),
      getOrganizationMembership: async () => ({ exists: true }),
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.validation.is_valid, false);
  assert.equal(persisted.request.intake_mode, null);
  assert.match(result.validation.errors.join('\n'), /Exactly one intake source must be populated/i);
  assert.match(summary, /Validation: failed/i);
  assert.match(summary, /Validation errors: .*Exactly one intake source must be populated/i);
});