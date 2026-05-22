'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadIssueFixture() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'add-team-members-csv-attachment-issue.md'),
    'utf8'
  );
}

function loadCommentsFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'add-team-members-csv-attachment-comments.json'),
      'utf8'
    )
  );
}

test('workflow applicability keeps empty-manual-input attachment requests in scope for validation', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-team-members.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

  assert.ok(requestScopeBlock);
  assert.match(requestScopeBlock[0], /PARSED_TEAM_SLUG/);
  assert.match(requestScopeBlock[0], /PARSED_INTAKE_MODE/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_REQUESTED_PEOPLE/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_PEOPLE/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$\{PARSED_TEAM_SLUG:-\}" \] && \[ -n "\$\{PARSED_INTAKE_MODE:-\}" \]; then/);
});

test('attachment integration scaffold stays aligned to the single-team dry-run waiting scenario', () => {
  const markdown = loadIssueFixture();

  assert.match(markdown, /### Team slug\s+platform-engineering/i);
  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Dry-run mode\s+true/i);
});

test('attachment integration scaffold preserves comment ordering for requester upload, correction, and approval', () => {
  const comments = loadCommentsFixture();

  assert.deepEqual(
    comments.map((comment) => comment.id),
    [5101, 5102, 5103, 5104]
  );
  assert.match(comments[0].body, /team-members\.csv/i);
  assert.match(comments[2].body, /team-members-corrected\.csv/i);
  assert.equal(comments[3].body, 'approved');
});

test('invalid attachment content can be corrected by a later requester attachment comment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-attachment-corrected-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const firstRun = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '711',
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
          id: 5101,
          created_at: '2026-05-21T10:05:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/1001/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('email\nrequester@example.com\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(firstRun.validation.request_status, 'validation_failed');
  assert.equal(firstRun.validation.attachment_validation_attempt.attempt_status, 'csv_invalid');

  const secondRun = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '711',
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
          id: 5101,
          created_at: '2026-05-21T10:05:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/1001/team-members.csv)',
          user: { login: 'requester' },
        },
        {
          id: 5103,
          created_at: '2026-05-21T10:09:00Z',
          body: '[team-members-corrected.csv](https://github.com/user-attachments/files/1003/team-members-corrected.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async (url) => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(
        url.includes('1003')
          ? 'username\noctocat\nhubot\n'
          : 'email\nrequester@example.com\n'
      ).buffer,
    }),
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(secondRun.validation.is_valid, true);
  assert.equal(secondRun.validation.request_status, 'awaiting_approval');
  assert.equal(secondRun.validation.request.accepted_attachment_submission.comment_id, 5103);
  assert.equal(secondRun.validation.attachment_validation_attempt.supersedes_attempt_id, `${secondRun.validation.request.request_id}:5101`);
  assert.match(summary, /Attachment comment ID: 5103/i);
  assert.match(summary, /CSV valid rows: 2/i);
});

test('approved attachment-driven requests execute with mixed add and no-op outcomes while preserving attachment provenance', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-attachment-approved-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const labels = [];

  const validationResult = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '712',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'false',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getTeamBySlug: async () => ({ exists: true, team_sync_blocked: false }),
      getOrganizationMembership: async () => ({ exists: true }),
      listIssueComments: async () => [
        {
          id: 5201,
          created_at: '2026-05-21T10:05:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/2001/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('username\noctocat\nhubot\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(validationResult.validation.request_status, 'awaiting_approval');

  const approvalResult = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => [
        {
          id: 5201,
          created_at: '2026-05-21T10:05:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/2001/team-members.csv)',
          user: { login: 'requester' },
        },
        {
          id: 5202,
          created_at: '2026-05-21T10:10:00Z',
          body: 'approved',
          user: { login: 'org-owner-user' },
        },
      ],
      addIssueAssignees: async () => ({ status: 'assigned', assignees: ['central-owner'] }),
      getAssignableOwners: async () => ['central-owner'],
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    },
  });

  assert.equal(approvalResult.approval.approval_status, 'approved');

  const executionResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '1001',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [{ login: 'octocat', state: 'active' }],
      addOrUpdateTeamMembership: async ({ username }) => ({ username, state: 'active', role: 'member' }),
      addIssueLabels: async ({ labels: requestedLabels }) => {
        labels.push(...requestedLabels);
        return requestedLabels;
      },
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(executionResult.request.request_status, 'executed');
  assert.equal(persisted.execution.mutation_count, 1);
  assert.equal(persisted.execution.noop_count, 1);
  assert.deepEqual(persisted.reconciliation.people_already_present.map((entry) => entry.source_row_number), [1]);
  assert.deepEqual(persisted.reconciliation.people_to_add.map((entry) => entry.source_row_number), [2]);
  assert.equal(persisted.request.accepted_attachment_submission.comment_id, 5201);
  assert.match(summary, /Attachment comment ID: 5201/i);
  assert.match(summary, /Added: 1/i);
  assert.match(summary, /No-op: 1/i);
  assert.deepEqual(labels, ['issueops:add-team-members:executed']);
});

test('terminal issue labels keep later attachment comments from reopening a completed request without a local artifact', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-terminal-label-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '713',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM_SLUG: 'platform-engineering',
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_BUSINESS_JUSTIFICATION: 'Need support access',
      PARSED_DRY_RUN: 'false',
      ISSUE_LABELS_JSON: JSON.stringify([{ name: 'issueops:add-team-members:executed' }]),
      COMMENT_ID: '5301',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: '[team-members.csv](https://github.com/user-attachments/files/3001/team-members.csv)',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.request_status, 'executed');
  assert.equal(result.validation.attachment_validation_attempt.attempt_status, 'ignored_terminal_state');

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(persisted.approval.approval_status, 'not_requested');
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Approval: not_requested \(other\)/i);
  assert.match(summary, /Later attachment comments are ignored after the request reaches a terminal execution state\./i);
});