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

test('runRequestValidation rejects the retired bulk CSV textarea even when manual input is also present', async () => {
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
  assert.equal(persisted.request.intake_mode, 'manual');
  assert.match(result.validation.errors.join('\n'), /bulk csv textarea intake is no longer supported/i);
  assert.match(summary, /Validation: failed/i);
  assert.match(summary, /Validation errors: .*bulk CSV textarea intake is no longer supported/i);
});

test('manual requests remain approval-ready through runRequestValidation when issue-comment context is present', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-manual-comment-context-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '615',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_REQUESTED_PEOPLE: 'octocat\nhubot',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'true',
      COMMENT_ID: '9002',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: 'requester follow-up comment without attachment',
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

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(persisted.request.intake_mode, 'manual');
  assert.deepEqual(persisted.request.requested_people, ['octocat', 'hubot']);
});

test('csv attachment requests remain blocked in waiting state before approval when no attachment comment is present', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-waiting-attachment-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '616',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'true',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getTeamBySlug: async () => ({ exists: true, team_sync_blocked: false }),
      getOrganizationMembership: async () => ({ exists: true }),
      listIssueComments: async () => [
        {
          id: 9100,
          body: 'approved',
          user: { login: 'org-owner-user' },
          created_at: '2026-05-21T10:05:00Z',
        },
      ],
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(persisted.request.intake_mode, 'csv_attachment');
  assert.equal(persisted.approval.approval_status, 'not_requested');
  assert.match(summary, /Approval: not_requested/i);
  assert.match(summary, /waiting for requester CSV attachment comment/i);
});

test('csv attachment requests ignore requester comments that do not include an attachment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-waiting-non-attachment-comment-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '618',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'true',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getTeamBySlug: async () => ({ exists: true, team_sync_blocked: false }),
      getOrganizationMembership: async () => ({ exists: true }),
      listIssueComments: async () => [
        {
          id: 9101,
          body: 'approved',
          user: { login: 'requester' },
          created_at: '2026-05-21T10:06:00Z',
        },
      ],
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(persisted.request.intake_mode, 'csv_attachment');
  assert.equal(persisted.request.accepted_attachment_submission.comment_id, null);
  assert.equal(persisted.approval.approval_status, 'not_requested');
  assert.doesNotMatch(summary, /Attachment comment ID:/i);
  assert.doesNotMatch(summary, /Attachment uploader:/i);
  assert.match(summary, /waiting for requester CSV attachment comment/i);
});

test('runRequestValidation rejects the retired bulk CSV textarea intake path', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-retired-bulk-csv-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '617',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_BULK_CSV_REQUESTED_PEOPLE: 'username\noctocat\nhubot',
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

  assert.equal(result.validation.is_valid, false);
  assert.match(result.validation.errors.join('\n'), /bulk csv textarea intake is no longer supported/i);
});