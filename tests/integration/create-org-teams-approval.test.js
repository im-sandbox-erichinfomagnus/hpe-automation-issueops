'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-creation-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeAuditArtifact(directory, overrides = {}) {
  const artifactPath = path.join(directory, 'create-org-teams-validation.json');
  const artifact = {
    request: {
      request_id: 'repo#501/run.1',
      issue_number: 501,
      repository: 'im-sandbox-himanshu/issueops-speckit',
      requester_login: 'himanshu-im',
      organization: 'im-sandbox-himanshu',
      intended_owner_login: 'himanshu-im',
      intake_mode: 'manual',
      requested_team_names_input: 'Platform Engineering',
      bulk_csv_input: '',
      requested_teams: [
        {
          normalized_slug: 'platform-engineering',
          intended_owner_login: 'himanshu-im',
          desired_action: 'create_team'
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
      intended_owner_membership: {
        exists: true,
        state: 'active',
        role: 'admin'
      },
      requested_teams: [
        {
          requested_name: 'Platform Engineering',
          normalized_slug: 'platform-engineering',
          intended_owner_login: 'himanshu-im',
          desired_action: 'create_team',
          validation_status: 'valid'
        }
      ],
      existing_teams: []
    },
    approval: {
      approval_status: 'pending',
      approver_login: '',
      approver_role: 'other'
    },
    reconciliation: {
      organization_exists: true,
      teams_to_create: [
        {
          requested_name: 'Platform Engineering',
          normalized_slug: 'platform-engineering',
          intended_owner_login: 'himanshu-im',
          desired_action: 'create_team',
          validation_status: 'valid'
        }
      ],
      teams_already_present: [],
      teams_rejected: [],
      dry_run: true,
      state: 'validated'
    },
    execution: {
      summary: 'Request is validated and ready for approval. No team creation was attempted.'
    },
    metadata: {
      operation: 'team_creation',
      run_id: '501',
      run_attempt: '1'
    },
    ...overrides
  };

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('runApprovalGate approves a validated team-creation request when the intended owner comments approved', async () => {
  const fixture = loadFixture().approved;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-approval-'));
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
      getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, 'himanshu-im');
  assert.equal(result.request.request_status, 'approved');
  assert.equal(result.request.intake_mode, 'manual');
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: manual/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Approval: approved/);
  assert.doesNotMatch(fs.readFileSync(summaryPath, 'utf8'), /CSV row/i);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /approval-status=approved/);
});

test('runApprovalGate denies approval by a commenter who is not the intended owner', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-denied-'));
  const artifactPath = writeAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.execution.summary, /No team creation was attempted/);
});

test('runApprovalGate remains pending when no approval comment exists', async () => {
  const fixture = loadFixture().pending;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-pending-'));
  const artifactPath = writeAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'pending');
});