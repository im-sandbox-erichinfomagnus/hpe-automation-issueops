'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function createRemovalApi() {
  return {
    getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
    getTeamBySlug: async () => ({ exists: true, team: { id: 10, slug: 'platform-engineering' } }),
    getOrganizationMembership: async ({ username }) => ({
      exists: username === 'octocat',
      membership: username === 'octocat' ? { role: 'admin', state: 'active' } : null,
    }),
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        owner,
        name: repo,
        full_name: `${owner}/${repo}`,
        archived: false,
      },
    }),
    getTeamRepositoryPermission: async ({ repo }) => ({
      exists: true,
      current_permission_api_value: repo === 'developer-portal' ? 'none' : 'maintain',
    }),
    listIssueComments: async () => ([
      {
        id: 1101,
        body: 'approved',
        created_at: '2026-06-02T10:00:00Z',
        user: { login: 'octocat' },
      },
    ]),
    addIssueAssignees: async () => ({ status: 'assigned', assignees: ['central-owner'] }),
    getAssignableOwners: async () => ['central-owner', 'requester'],
  };
}

test('manual removal request progresses through validation and approval while keeping assignment routing-only', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-manual-governance-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const validationResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '9401',
      REQUESTER_LOGIN: 'requester',
      AUDIT_ARTIFACT_PATH: artifactPath,
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        team: 'Platform Engineering',
        designated_approver: 'octocat',
        intake_mode: 'manual',
        requested_repositories: ['service-catalog', 'developer-portal'],
        dry_run: true,
      }),
    },
    api: createRemovalApi(),
  });

  assert.equal(validationResult.validation.is_valid, true);
  assert.equal(validationResult.validation.request_status, 'awaiting_approval');
  assert.equal(validationResult.auditArtifact.metadata.operation, 'team_repo_access_removal');
  assert.deepEqual(
    validationResult.auditArtifact.reconciliation.removals_to_apply.map((entry) => entry.repository_full_name),
    ['octo-org/service-catalog']
  );
  assert.deepEqual(
    validationResult.auditArtifact.reconciliation.already_absent_noops.map((entry) => entry.repository_full_name),
    ['octo-org/developer-portal']
  );

  const approvalResult = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: createRemovalApi(),
  });

  assert.equal(approvalResult.approval.approval_status, 'approved');
  assert.equal(approvalResult.request.request_status, 'approved');
  assert.match(approvalResult.assignment.assignment_note, /queue ownership only/i);
  assert.match(approvalResult.assignment.assignment_note, /does not authorize repository access removal mutation/i);
  assert.match(approvalResult.execution.summary, /No repository-access removal mutation was attempted/i);
});

test('approved removal execution fails closed when ISSUEOPS_GITHUB_TOKEN is missing', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-missing-token-execution-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '9402',
      REQUESTER_LOGIN: 'requester',
      AUDIT_ARTIFACT_PATH: artifactPath,
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        team: 'Platform Engineering',
        designated_approver: 'octocat',
        intake_mode: 'manual',
        requested_repositories: ['service-catalog'],
        dry_run: false,
      }),
    },
    api: createRemovalApi(),
  });

  await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: createRemovalApi(),
  });

  const executionResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '9402',
      GITHUB_RUN_ATTEMPT: '1',
    },
    setProcessExitCode: false,
  });

  assert.equal(executionResult.request.request_status, 'failed');
  assert.equal(executionResult.execution.failure_count, 1);
  assert.match(
    executionResult.execution.summary,
    /not PAT-backed for repository-access mutation|Missing workflow token/i
  );
  assert.match(executionResult.execution.summary, /No repository-access mutation was attempted/i);
});
