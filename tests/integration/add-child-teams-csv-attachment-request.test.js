'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { resolveCsvAttachmentComment } = require('../../src/workflow-support/resolve-csv-attachment-comment');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadIssueFixture() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'add-child-teams-csv-attachment-issue.md'),
    'utf8'
  );
}

function loadCommentsFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'add-child-teams-csv-attachment-comments.json'),
      'utf8'
    )
  );
}

function loadJsonFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createHierarchyApi(validationFixture, issueComments) {
  return {
    getOrganization: async () => validationFixture.organization,
    listOrgTeams: async () => validationFixture.teams || [],
    getMembershipForUser: async ({ teamSlug, username }) => {
      const teamMemberships = validationFixture.memberships || {};
      return teamMemberships[teamSlug] && teamMemberships[teamSlug][username]
        ? teamMemberships[teamSlug][username]
        : { membership: null };
    },
    listIssueComments: async () => issueComments,
  };
}

test('attachment integration scaffold stays aligned to add-child-teams csv_attachment intake shape', () => {
  const markdown = loadIssueFixture();

  assert.match(markdown, /### Parent team\s+Platform Engineering/i);
  assert.match(markdown, /### Designated hierarchy approver\s+octocat/i);
  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Dry-run mode\s+true/i);
});

test('attachment integration scaffold preserves requester upload, correction, and approval ordering', () => {
  const comments = loadCommentsFixture();

  assert.match(comments.find((comment) => comment.id === 6101).body, /child-teams\.csv/i);
  assert.match(comments.find((comment) => comment.id === 6103).body, /child-teams-corrected\.csv/i);
  assert.equal(comments.at(-1).id, 6104);
  assert.equal(comments.at(-1).body, 'approved');
});

test('workflow applicability assumptions keep add-child-teams issue and issue_comment trigger wiring in place', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-child-teams.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /issues:\s*[\s\S]*- opened/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- created/);
  assert.match(workflow, /name:\s+Check request applicability/);
  assert.match(workflow, /PARSED_PARENT_TEAM/);
  assert.match(workflow, /PARSED_DESIGNATED_APPROVER/);
});

test('integration scaffold candidate resolution picks the latest requester attachment after corrections', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: loadCommentsFixture(),
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 6103);
});

test('valid requester csv_attachment for add-child-teams progresses from waiting_for_attachment to awaiting_approval', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;
  const issueComments = [
    {
      id: 7103,
      created_at: '2026-05-25T10:09:00Z',
      body: '[child-teams.csv](https://github.com/user-attachments/files/7103/child-teams.csv)',
      user: { login: 'requester' },
    },
  ];

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7103',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-7103',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture, issueComments),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('child_team\napplication-platform\nrelease-engineering\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.request.request_status, 'awaiting_approval');
  assert.equal(result.validation.request.accepted_attachment_submission.acceptance_status, 'accepted');
  assert.equal(result.validation.request.requested_child_links.length, 2);
});

test('failed attachment validation can be corrected by a later requester attachment comment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-corrected-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const firstRun = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7104',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-7104',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 71041,
        created_at: '2026-05-25T10:10:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/71041/child-teams.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('team\napplication-platform\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(firstRun.validation.is_valid, false);
  assert.equal(firstRun.validation.request_status, 'validation_failed');
  assert.equal(firstRun.validation.attachment_validation_attempt.attempt_status, 'csv_invalid');

  const secondRun = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7104',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-7104',
      GITHUB_RUN_ATTEMPT: '2',
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 71041,
        created_at: '2026-05-25T10:10:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/71041/child-teams.csv)',
        user: { login: 'requester' },
      },
      {
        id: 71042,
        created_at: '2026-05-25T10:12:00Z',
        body: '[child-teams-corrected.csv](https://github.com/user-attachments/files/71042/child-teams-corrected.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async (url) => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(
        url.includes('71042')
          ? 'child_team\napplication-platform\nrelease-engineering\n'
          : 'team\napplication-platform\n'
      ).buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(secondRun.validation.is_valid, true);
  assert.equal(secondRun.validation.request_status, 'awaiting_approval');
  assert.equal(secondRun.validation.request.accepted_attachment_submission.comment_id, 71042);
  assert.equal(
    secondRun.validation.attachment_validation_attempt.supersedes_attempt_id,
    `${firstRun.validation.request.request_id}:71041`
  );
});

test('approved attachment-driven add-child-teams request executes with mixed linked and no-op outcomes while preserving attachment provenance', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-approved-'));
  const auditPath = path.join(workspace, 'audit.json');
  const labels = [];
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const validationResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/octo-repo',
      ISSUE_NUMBER: '7105',
      REQUESTER_LOGIN: 'octocat',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-7105',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 71051,
        created_at: '2026-05-25T10:15:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/71051/child-teams.csv)',
        user: { login: 'octocat' },
      },
    ]),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('child_team\napplication-platform\nrelease-engineering\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(validationResult.validation.request_status, 'awaiting_approval');

  const approvalResult = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: {
      listIssueComments: async () => [
        {
          id: 71051,
          created_at: '2026-05-25T10:15:00Z',
          body: '[child-teams.csv](https://github.com/user-attachments/files/71051/child-teams.csv)',
          user: { login: 'octocat' },
        },
        {
          id: 71052,
          created_at: '2026-05-25T10:16:00Z',
          body: 'approved',
          user: { login: 'octocat' },
        },
      ],
      addIssueAssignees: async () => ({ status: 'assigned', assignees: ['aeruvakalpanaa'] }),
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      getMembershipForUser: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
    },
  });

  assert.equal(approvalResult.approval.approval_status, 'approved');

  const executionResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-7105',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_hierarchy_mutation: true,
    },
    createApi: () => ({
      listOrgTeams: async () => [
        { id: 1, name: 'Platform Engineering', slug: 'platform-engineering', parent: null },
        { id: 2, name: 'Application Platform', slug: 'application-platform', parent: null },
        { id: 3, name: 'Release Engineering', slug: 'release-engineering', parent: { id: 1, slug: 'platform-engineering' } },
      ],
      updateTeamParent: async ({ teamSlug, parentTeamId }) => ({
        id: 2,
        slug: teamSlug,
        parent: { id: parentTeamId, slug: 'platform-engineering' },
      }),
      addIssueLabels: async ({ labels: requestedLabels }) => {
        labels.push(...requestedLabels);
        return requestedLabels;
      },
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(executionResult.request.request_status, 'executed');
  assert.equal(persisted.execution.linked_count, 1);
  assert.equal(persisted.execution.noop_count, 1);
  assert.equal(persisted.request.accepted_attachment_submission.comment_id, 71051);
  assert.deepEqual(labels, ['issueops:add-child-teams:executed']);
  assert.match(summary, /Attachment comment ID: 71051/i);
  assert.match(summary, /Child links applied: 1/i);
  assert.match(summary, /No-op: 1/i);
});

test('terminal issue labels keep later add-child-teams attachment comments from reopening a completed request without a local artifact', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-terminal-label-'));
  const auditPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
      ISSUE_NUMBER: '7106',
      REQUESTER_LOGIN: 'himanshu-im',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'im-sandbox-himanshu',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'himanshu-im',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: false,
      }),
      ISSUE_LABELS_JSON: JSON.stringify([{ name: 'issueops:add-child-teams:executed' }]),
      COMMENT_ID: '71061',
      COMMENT_AUTHOR_LOGIN: 'himanshu-im',
      COMMENT_BODY: '[child-teams.csv](https://github.com/user-attachments/files/71061/child-teams.csv)',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.request_status, 'executed');
  assert.equal(result.validation.attachment_validation_attempt.attempt_status, 'ignored_terminal_state');

  const persisted = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(persisted.approval.approval_status, 'not_requested');
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Later attachment comments are ignored after the request reaches a terminal execution state\./i);
});
