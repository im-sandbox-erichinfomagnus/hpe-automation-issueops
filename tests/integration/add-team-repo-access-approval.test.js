'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-repo-access-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeAuditArtifact(directory, overrides = {}) {
  const artifactPath = path.join(directory, 'add-team-repo-access-validation.json');
  const artifact = {
    request: {
      request_id: 'repo#901/run.1',
      issue_number: 901,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      team_name: 'Platform Engineering',
      intake_mode: 'manual',
      requested_repositories_input: 'service-catalog',
      bulk_csv_input: '',
      bulk_csv_submission: {
        encoding: 'utf-8',
        header_columns: [],
        required_columns: ['repository'],
        unsupported_columns: [],
        row_count: 0,
        valid_row_count: 0,
        invalid_row_count: 0,
        duplicate_row_count: 0,
        schema_status: 'not_provided',
        schema_errors: [],
        raw_input: '',
        csv_row_findings: [],
        csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
      },
      designated_approver_login: 'octocat',
      requested_permission_label: 'write',
      requested_permission_api_value: 'push',
      requested_repository_grants: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'grant_access',
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
      team_exists: true,
      designated_approver_authorization: {
        login: 'octocat',
        state: 'authorized',
        membership_state: 'active',
        role: 'target_org_owner'
      },
      requested_repository_grants: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'grant_access',
          validation_status: 'valid'
        }
      ],
      already_satisfied_repository_grants: []
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
      team_exists: true,
      repositories_to_grant: [
        {
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'grant_access',
          validation_status: 'valid'
        }
      ],
      repositories_already_satisfied: [],
      repositories_rejected: [],
      dry_run: true,
      state: 'validated'
    },
    execution: {
      summary: 'Request is validated and ready for approval. No repository-access mutation was attempted.'
    },
    metadata: {
      operation: 'team_repo_access',
      run_id: '901',
      run_attempt: '1'
    },
    ...overrides
  };

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('runApprovalGate approves a validated repo-access request when the designated owner comments approved', async () => {
  const fixture = loadFixture().approved;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-approval-'));
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
      getOrganizationMembership: async ({ username }) =>
        fixture.membership[username] || { exists: false, membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, 'octocat');
  assert.equal(result.request.request_status, 'approved');
  assert.equal(result.request.intake_mode, 'manual');
  assert.equal(result.request.requested_repositories_input, 'service-catalog');
  assert.equal(result.request.bulk_csv_submission.schema_status, 'not_provided');
  assert.equal(result.assignment.assigned_login, 'central-owner');
  assert.match(result.assignment.assignment_note, /repository access mutation/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: manual/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Approval: approved/);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Add Team Repository Access Workflow Summary/);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /approval-status=approved/);
});

test('runApprovalGate denies approval by a commenter who is not the designated owner', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-denied-'));
  const artifactPath = writeAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getOrganizationMembership: async ({ username }) =>
        fixture.membership[username] || { exists: false, membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.execution.summary, /No repository-access mutation was attempted/);
});

test('runApprovalGate remains pending when no approval comment exists', async () => {
  const fixture = loadFixture().pending;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-pending-'));
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
      getOrganizationMembership: async () => ({ exists: false, membership: null }),
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(result.assignment.assigned_login, 'central-owner');
  assert.match(result.approval.decision_note, /designated target organization owner/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Approval: pending \(authorized\)/);
});

test('runApprovalGate preserves manual intake when the stored optional CSV field is an empty fenced block', async () => {
  const fixture = loadFixture().pending;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-pending-empty-csv-fence-'));
  const artifactPath = writeAuditArtifact(workspace, {
    request: {
      request_id: 'repo#902/run.1',
      issue_number: 902,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      team_name: 'Platform Engineering',
      intake_mode: null,
      requested_repositories_input: 'service-catalog',
      bulk_csv_input: '```csv\n\n```',
      bulk_csv_submission: {
        encoding: 'utf-8',
        header_columns: [],
        required_columns: ['repository'],
        unsupported_columns: [],
        row_count: 0,
        valid_row_count: 0,
        invalid_row_count: 0,
        duplicate_row_count: 0,
        schema_status: 'not_provided',
        schema_errors: [],
        raw_input: '```csv\n\n```',
        csv_row_findings: [],
        csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
      },
      designated_approver_login: 'octocat',
      requested_permission_label: 'write',
      requested_permission_api_value: 'push',
      requested_repository_grants: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'grant_access',
          validation_status: 'valid'
        }
      ],
      request_status: 'awaiting_approval',
      dry_run: true
    },
  });
  const summaryPath = path.join(workspace, 'summary.md');

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getOrganizationMembership: async () => ({ exists: false, membership: null }),
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
  });

  assert.equal(result.request.intake_mode, 'manual');
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: manual/i);
});

test('runApprovalGate denies approval when the designated approver loses owner authorization before evaluation', async () => {
  const fixture = loadFixture().denied_stale_authorization;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-stale-'));
  const artifactPath = writeAuditArtifact(workspace, {
    approval: {
      approval_status: 'approved',
      approver_login: 'octocat',
      approver_role: 'target_org_owner'
    }
  });

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => fixture.comments,
      getOrganizationMembership: async ({ username }) =>
        fixture.membership[username] || { exists: false, membership: null },
      addIssueAssignees: async () => ({ status: 'assigned', assignees: fixture.assignees }),
      getAssignableOwners: async () => fixture.assignees,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.match(result.approval.decision_note, /does not authorize repository-access mutation/i);
});