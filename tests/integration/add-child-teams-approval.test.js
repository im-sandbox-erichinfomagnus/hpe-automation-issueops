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