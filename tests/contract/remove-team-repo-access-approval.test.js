'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { resolveTeamRepoApprover } = require('../../src/workflow-support/resolve-team-repo-approver');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { assertRepositoryAccessAllowed } = require('../../src/actions/team-repo-access-policy');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-repo-access-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeRemovalAuditArtifact(directory, overrides = {}) {
  const artifactPath = path.join(directory, 'remove-team-repo-access-validation.json');
  const baseArtifact = {
    request: {
      request_id: 'remove#9301/run.1',
      issue_number: 9301,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      team_name: 'Platform Engineering',
      intake_mode: 'manual',
      requested_repositories_input: 'service-catalog',
      requested_repository_removals: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'remove_access',
          validation_status: 'valid',
        },
      ],
      designated_approver_login: 'octocat',
      request_status: 'awaiting_approval',
      dry_run: true,
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
        role: 'target_org_owner',
      },
      requested_repository_removals: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'remove_access',
          validation_status: 'valid',
        },
      ],
      already_absent_repository_removals: [],
    },
    assignment: {
      assignment_status: 'not_attempted',
      assigned_login: '',
      assignment_note: '',
      assigned_at: null,
    },
    approval: {
      approval_status: 'pending',
      approver_login: '',
      approver_role: 'other',
    },
    reconciliation: {
      organization_exists: true,
      team_exists: true,
      removals_to_apply: [
        {
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'remove_access',
          validation_status: 'valid',
        },
      ],
      already_absent_noops: [],
      rejected_items: [],
      dry_run: true,
      state: 'validated',
    },
    execution: {
      summary: 'Request is validated and ready for approval. No repository-access removal mutation was attempted.',
    },
    metadata: {
      operation: 'team_repo_access_removal',
      run_id: '9301',
      run_attempt: '1',
    },
  };

  const artifact = {
    ...baseArtifact,
    ...overrides,
  };

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('approval gate accepts designated target organization owner for repository-access removal', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'octo-org',
      designatedApproverLogin: 'octocat',
      approvalMode: 'team_repo_access_removal',
      intake_mode: 'manual',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin }) =>
        resolveTeamRepoApprover(
          { organization, approverLogin, designatedApproverLogin },
          {
            getOrganizationMembership: async ({ username }) =>
              fixture.membership[username] || { exists: false, membership: null },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'octocat');
  assert.equal(decision.approver_role, 'target_org_owner');
});

test('approval gate denies repository-access removal approval by non-designated approver', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const decision = await evaluateApprovalGate(
    {
      organization: 'octo-org',
      designatedApproverLogin: 'octocat',
      approvalMode: 'team_repo_access_removal',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin }) =>
        resolveTeamRepoApprover(
          { organization, approverLogin, designatedApproverLogin },
          {
            getOrganizationMembership: async ({ username }) =>
              fixture.membership[username] || { exists: false, membership: null },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.match(decision.decision_note, /does not authorize repository-access mutation/i);
});

test('runApprovalGate fails closed when ISSUEOPS_GITHUB_TOKEN is missing for removal requests', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-approval-missing-token-'));
  const artifactPath = writeRemovalAuditArtifact(workspace);

  const result = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  assert.equal(result.assignment.assignment_status, 'failed');
  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.assignment.assignment_note, /workflow token secret is missing/i);
  assert.match(result.approval.decision_note, /workflow token secret is missing/i);
});

test('repository-access removal execution policy fails closed for non-PAT workflow token', () => {
  assert.throws(
    () => assertRepositoryAccessAllowed({
      approval_status: 'approved',
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
      dry_run: false,
      tokenInfo: {
        token: 'github-token',
        source: 'GITHUB_TOKEN',
        is_pat_backed: false,
        token_kind: 'github_token',
        supports_team_repo_access_mutation: false,
      },
    }),
    /not PAT-backed for repository-access mutation/i
  );
});
