'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'approver-roles.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createResolveRole(fixtureCase) {
  return async ({ approverLogin }) => ({
    approver_role: fixtureCase.roles[approverLogin] || 'other',
  });
}

test('approval gate passes when an organization owner approves', async () => {
  const fixtureCase = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'approved');
});

test('approval gate denies non-owner approval attempts', async () => {
  const fixtureCase = loadFixture().denied;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'denied');
});

test('approval gate remains pending when no approval signal exists', async () => {
  const fixtureCase = loadFixture().missing;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'pending');
});

test('approval gate invalidates a previously approved request when the approval comment is removed', async () => {
  const fixtureCase = loadFixture().missing;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
      priorApprovalStatus: 'approved',
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'invalidated');
  assert.match(decision.decision_note, /no longer present/i);
});

test('approval-ready manual summaries surface intake metadata before execution', () => {
  const summary = formatAuditSummary({
    request: {
      request_id: 'octo-org/issueops-speckit#220/local.1',
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requester_login: 'requester',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      requested_people: ['octocat', 'hubot'],
      csv_row_findings: [],
      csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
    },
    validation: {
      is_valid: true,
      errors: [],
      warnings: [],
      csv_row_findings: [],
    },
    approval: {
      approval_status: 'pending',
      approver_role: 'other',
    },
    execution: {
      mutation_count: 0,
      noop_count: 0,
      pending_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
    },
  });

  assert.match(summary, /Intake mode: manual/i);
  assert.doesNotMatch(summary, /CSV row findings:/i);
  assert.doesNotMatch(summary, /CSV valid rows:/i);
  assert.doesNotMatch(summary, /CSV duplicate rows:/i);
  assert.doesNotMatch(summary, /CSV invalid rows:/i);
  assert.doesNotMatch(summary, /CSV row numbering:/i);
});

test('manual approval guidance remains the organization-owner workflow path', async () => {
  const decision = await evaluateApprovalGate(
    {
      approvalMode: 'team_membership',
      organization: 'octo-org',
      issueComments: [],
    },
    {
      resolveRole: async () => ({ approver_role: 'other' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, /organization owner/i);
});

test('waiting attachment summaries do not present approval-ready manual guidance', () => {
  const summary = formatAuditSummary({
    request: {
      request_id: 'octo-org/issueops-speckit#221/local.1',
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requester_login: 'requester',
      request_status: 'waiting_for_attachment',
      intake_mode: 'csv_attachment',
      requested_people: [],
      csv_row_findings: [],
      csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
      accepted_attachment_submission: null,
    },
    validation: {
      is_valid: false,
      errors: [],
      warnings: ['Request is waiting for a requester-authored CSV attachment comment.'],
      csv_row_findings: [],
    },
    approval: {
      approval_status: 'not_requested',
      approver_role: 'other',
    },
    execution: {
      mutation_count: 0,
      noop_count: 0,
      pending_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
    },
  });

  assert.match(summary, /Attachment status: waiting for requester CSV attachment comment/i);
  assert.match(summary, /Approval: not_requested/i);
  assert.doesNotMatch(summary, /ready for approval/i);
});

test('runApprovalGate leaves waiting attachment requests outside the approval path', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-waiting-approval-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const outputPath = path.join(workspace, 'github-output.txt');

  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: {
      operation: 'team_membership',
      repository: 'octo-org/issueops-speckit',
    },
    request: {
      request_id: 'octo-org/issueops-speckit#616/local.1',
      issue_number: 616,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      intake_mode: 'csv_attachment',
      request_status: 'waiting_for_attachment',
      dry_run: true,
      requested_people: [],
      csv_row_findings: [],
    },
    validation: {
      is_valid: false,
      request_status: 'waiting_for_attachment',
      errors: [],
      warnings: ['Request is waiting for a requester-authored CSV attachment comment.'],
    },
    approval: {
      approval_status: 'not_requested',
      approver_role: 'other',
    },
    execution: {
      summary: 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.',
      rollback_status: 'not_needed',
    },
  }, null, 2));

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_OUTPUT: outputPath,
    },
    api: {
      listIssueComments: async () => {
        throw new Error('approval comments should not be loaded for waiting attachment requests');
      },
      addIssueAssignees: async () => {
        throw new Error('assignment should not be attempted for waiting attachment requests');
      },
      getAssignableOwners: async () => {
        throw new Error('assignable owners should not be loaded for waiting attachment requests');
      },
    },
  });

  assert.equal(result.request.request_status, 'waiting_for_attachment');
  assert.equal(result.approval.approval_status, 'not_requested');
  assert.match(fs.readFileSync(outputPath, 'utf8'), /approval-status=not_requested/);
});

test('csv attachment approvals require a newer owner approval comment than the accepted attachment comment', async () => {
  const decision = await evaluateApprovalGate(
    {
      approvalMode: 'team_membership',
      organization: 'octo-org',
      intake_mode: 'csv_attachment',
      request_status: 'awaiting_approval',
      acceptedAttachmentCommentCreatedAt: '2026-05-21T11:00:00Z',
      issueComments: [
        {
          body: 'approved',
          user: { login: 'org-owner-user' },
          created_at: '2026-05-21T10:55:00Z',
        },
      ],
    },
    {
      resolveRole: async () => ({ approver_role: 'org_owner' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, /after the accepted CSV attachment comment/i);
});

test('runApprovalGate ignores stale owner approval comments that predate the accepted attachment comment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-stale-attachment-approval-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: {
      operation: 'team_membership',
      repository: 'octo-org/issueops-speckit',
    },
    request: {
      request_id: 'octo-org/issueops-speckit#617/local.1',
      issue_number: 617,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      intake_mode: 'csv_attachment',
      request_status: 'awaiting_approval',
      dry_run: true,
      requested_people: ['octocat'],
      csv_row_findings: [],
      accepted_attachment_submission: {
        comment_id: 9101,
        comment_created_at: '2026-05-21T11:00:00Z',
        uploader_login: 'requester',
        attachment_url: 'https://github.com/user-attachments/files/123/sample.csv',
        filename: 'sample.csv',
        extension: '.csv',
        acceptance_status: 'accepted',
      },
    },
    validation: {
      is_valid: true,
      request_status: 'awaiting_approval',
      errors: [],
      warnings: [],
      requested_people: [
        {
          username: 'octocat',
          source_row_number: 1,
          resolution_status: 'resolved',
          current_membership_state: 'unknown',
          desired_action: 'add_member',
          execution_result: 'not_started',
          failure_reason: null,
        },
      ],
    },
    approval: {
      approval_status: 'not_requested',
      approver_role: 'other',
    },
    execution: {
      summary: 'Request is validated and ready for approval. No membership mutation was attempted.',
      rollback_status: 'not_needed',
    },
  }, null, 2));

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
    api: {
      listIssueComments: async () => [
        {
          body: 'approved',
          user: { login: 'org-owner-user' },
          created_at: '2026-05-21T10:55:00Z',
        },
      ],
      addIssueAssignees: async () => ({ status: 'assigned', assignees: ['central-owner'] }),
      getAssignableOwners: async () => ['central-owner'],
      getMembershipForUser: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
    },
  });

  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.approval.decision_note, /after the accepted CSV attachment comment/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Approval: pending/i);
});

test('runApprovalGate ignores later attachment comments after an executed attachment request reaches terminal state', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-members-terminal-approval-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const outputPath = path.join(workspace, 'github-output.txt');

  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: {
      operation: 'team_membership',
      repository: 'octo-org/issueops-speckit',
    },
    request: {
      request_id: 'octo-org/issueops-speckit#719/local.1',
      issue_number: 719,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      intake_mode: 'csv_attachment',
      request_status: 'executed',
      dry_run: false,
      requested_people: ['octocat'],
      accepted_attachment_submission: {
        comment_id: 9901,
        comment_created_at: '2026-05-21T10:00:00Z',
        uploader_login: 'requester',
        attachment_url: 'https://github.com/user-attachments/files/9001/sample.csv',
        filename: 'sample.csv',
        extension: '.csv',
        acceptance_status: 'accepted',
      },
      csv_row_findings: [],
    },
    validation: {
      is_valid: true,
      request_status: 'executed',
      errors: [],
      warnings: [],
    },
    approval: {
      approval_status: 'approved',
      approver_login: 'org-owner-user',
      approver_role: 'org_owner',
    },
    execution: {
      mutation_count: 1,
      noop_count: 0,
      pending_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
      summary: 'Approved execution completed. Processed 1 member(s), 0 no-op membership(s), 0 rejected membership(s), 0 pending membership(s), and 0 failed membership(s).',
    },
  }, null, 2));

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_OUTPUT: outputPath,
    },
    api: {
      listIssueComments: async () => {
        throw new Error('terminal attachment requests should not re-enter approval evaluation');
      },
      addIssueAssignees: async () => {
        throw new Error('terminal attachment requests should not be reassigned');
      },
      getAssignableOwners: async () => {
        throw new Error('terminal attachment requests should not reload assignable owners');
      },
    },
  });

  assert.equal(result.request.request_status, 'executed');
  assert.match(fs.readFileSync(outputPath, 'utf8'), /approval-status=not_requested/);
});