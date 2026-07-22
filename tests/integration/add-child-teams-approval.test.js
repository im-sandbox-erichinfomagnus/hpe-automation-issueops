'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-hierarchy-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeAuditArtifact(directory, overrides = {}) {
  const artifactPath = path.join(directory, 'add-child-teams-validation.json');
  const artifact = {
    request: {
      request_id: 'repo#701/run.1',
      issue_number: 701,
      repository: 'im-sandbox-himanshu/issueops-speckit',
      requester_login: 'himanshu-im',
      organization: 'im-sandbox-himanshu',
      parent_team_slug: 'platform-engineering',
      parent_team_name: 'Platform Engineering',
      designated_approver_login: 'himanshu-im',
      intake_mode: 'manual',
      requested_child_teams_input: 'Application Platform',
      bulk_csv_input: '',
      bulk_csv_submission: null,
      csv_row_findings: [],
      csv_row_numbering_convention: null,
      requested_child_links: [
        {
          requested_name: 'Application Platform',
          child_team_slug: 'application-platform',
          desired_action: 'link_child',
          validation_status: 'valid'
        }
      ],
      request_status: 'awaiting_approval',
      dry_run: true
    },
    validation: {
      is_valid: true,
      errors: [],
      warnings: [],
      organization_visible: true,
      parent_team_exists: true,
      designated_approver_authorization: {
        login: 'himanshu-im',
        state: 'authorized',
        parent_team_role: 'maintainer',
        child_team_roles: [
          {
            child_team_slug: 'application-platform',
            role: 'maintainer'
          }
        ]
      },
      requested_child_links: [
        {
          requested_name: 'Application Platform',
          child_team_slug: 'application-platform',
          desired_action: 'link_child',
          validation_status: 'valid'
        }
      ],
      existing_child_links: []
    },
    assignment: {
      assignment_status: 'not_attempted',
      assigned_login: '',
      assignment_note: '',
      assigned_at: null
    },
    approval: {
      approval_status: 'pending',
      approver_login: '',
      approver_role: 'other'
    },
    reconciliation: {
      organization_exists: true,
      parent_team_exists: true,
      child_links_to_apply: [
        {
          requested_name: 'Application Platform',
          child_team_slug: 'application-platform',
          desired_action: 'link_child',
          validation_status: 'valid'
        }
      ],
      child_links_already_present: [],
      child_links_rejected: [],
      dry_run: true,
      state: 'validated'
    },
    execution: {
      summary: 'Request is validated and ready for approval. No child-team mutation was attempted.'
    },
    metadata: {
      operation: 'team_hierarchy',
      run_id: '701',
      run_attempt: '1'
    },
    ...overrides
  };

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('runApprovalGate approves a validated hierarchy request when the designated approver comments approved', async () => {
  const fixture = loadFixture().approved;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-approval-'));
  const artifactPath = writeAuditArtifact(workspace);
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, 'himanshu-im');
  assert.equal(result.request.request_status, 'approved');
  assert.equal(result.request.intake_mode, 'manual');
  assert.equal(result.request.accepted_attachment_submission, null);
  assert.equal(result.assignment.assigned_login, 'central-owner');
  assert.match(result.assignment.assignment_note, /team hierarchy mutation/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: manual/);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Approval: approved/);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /approval-status=approved/);
});

test('runApprovalGate denies approval by a commenter who is not the designated approver', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-denied-'));
  const artifactPath = writeAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.execution.summary, /No child-team mutation was attempted/);
});

test('runApprovalGate remains pending when no approval comment exists', async () => {
  const fixture = loadFixture().pending;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-pending-'));
  const artifactPath = writeAuditArtifact(workspace);
  const summaryPath = path.join(workspace, 'summary.md');

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async () => ({ membership: null }),
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(result.assignment.assigned_login, 'central-owner');
  assert.match(result.approval.decision_note, /designated hierarchy approver/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Approval: pending \(authorized\)/);
});

test('runApprovalGate invalidates approval when the designated approver loses authorization before evaluation', async () => {
  const fixture = loadFixture().denied_stale_authorization;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-stale-'));
  const artifactPath = writeAuditArtifact(workspace, {
    approval: {
      approval_status: 'approved',
      approver_login: 'himanshu-im',
      approver_role: 'designated_hierarchy_approver'
    }
  });

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.match(result.approval.decision_note, /does not authorize team hierarchy mutation/i);
});

test('runApprovalGate supports routing and approval checks with GITHUB_TOKEN when PAT mutation is not being executed', async () => {
  const fixture = loadFixture().pending;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-github-token-'));
  const artifactPath = writeAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      GITHUB_TOKEN: 'github-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async () => ({ membership: null }),
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.equal(result.assignment.assignment_status, 'assigned');
  assert.match(result.assignment.assignment_note, /queue ownership only and does not authorize team hierarchy mutation/i);
});

test('runApprovalGate keeps csv_attachment hierarchy requests blocked while waiting_for_attachment even if an approval comment exists', async () => {
  const fixture = loadFixture().approved;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-waiting-approval-'));
  const artifactPath = writeAuditArtifact(workspace);
  const waitingArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  waitingArtifact.request.intake_mode = 'csv_attachment';
  waitingArtifact.request.request_status = 'waiting_for_attachment';
  waitingArtifact.request.requested_child_links = [];
  waitingArtifact.request.accepted_attachment_submission = {
    comment_id: null,
    comment_created_at: null,
    uploader_login: null,
    attachment_url: null,
    filename: null,
    extension: null,
    content_hash: null,
    downloaded_at: null,
    byte_size: 0,
    acceptance_status: 'waiting',
    rejection_reason: null,
  };
  fs.writeFileSync(artifactPath, JSON.stringify(waitingArtifact, null, 2));

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'not_requested');
  assert.equal(result.request.request_status, 'waiting_for_attachment');
  assert.match(result.approval.decision_note, /waiting for a requester-authored CSV attachment comment/i);
});

test('runApprovalGate does not treat central queue assignment as authorization for hierarchy approval', async () => {
  const fixture = {
    comments: [
      {
        id: 999001,
        body: 'approved',
        created_at: '2026-05-25T12:00:00Z',
        user: { login: 'central-owner' },
      },
    ],
    assignees: ['central-owner', 'himanshu-im'],
    memberships: {
      'platform-engineering': {
        'central-owner': { membership: { role: 'maintainer', state: 'active' } },
      },
      'application-platform': {
        'central-owner': { membership: { role: 'maintainer', state: 'active' } },
      },
    },
  };
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-central-routing-'));
  const artifactPath = writeAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getMembershipForUser: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.assignment.assigned_login, 'central-owner');
  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.approver_login, 'central-owner');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.assignment.assignment_note, /queue ownership only and does not authorize team hierarchy mutation/i);
  assert.match(result.approval.decision_note, /does not authorize team hierarchy mutation/i);
});

test('runApprovalGate ignores later attachment comments after an executed csv_attachment hierarchy request reaches terminal state', async () => {
  const fixture = loadFixture().approved;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-terminal-approval-'));
  const artifactPath = writeAuditArtifact(workspace);
  let commentsFetched = false;
  const terminalArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  terminalArtifact.request.intake_mode = 'csv_attachment';
  terminalArtifact.request.request_status = 'executed';
  terminalArtifact.request.accepted_attachment_submission = {
    comment_id: 70101,
    comment_created_at: '2026-05-25T10:00:00Z',
    uploader_login: 'himanshu-im',
    attachment_url: 'https://github.com/user-attachments/files/70101/child-teams.csv',
    filename: 'child-teams.csv',
    extension: '.csv',
    content_hash: 'hash-70101',
    downloaded_at: '2026-05-25T10:00:02Z',
    byte_size: 64,
    acceptance_status: 'accepted',
    rejection_reason: null,
  };
  fs.writeFileSync(artifactPath, JSON.stringify(terminalArtifact, null, 2));

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => {
        commentsFetched = true;
        return fixture.comments;
      },
      getMembershipForUser: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(commentsFetched, false);
});