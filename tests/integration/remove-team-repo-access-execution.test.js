'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');

function createApprovedArtifact() {
  return {
    request: {
      request_id: 'remove#9801/run.1',
      issue_number: 9801,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      team_name: 'Platform Engineering',
      intake_mode: 'csv_attachment',
      requested_repository_removals: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'remove_access',
          validation_status: 'valid',
          source_row_number: 1,
          source_comment_id: 9205,
        },
        {
          requested_repository_name: 'developer-portal',
          repository_owner: 'octo-org',
          repository_name: 'developer-portal',
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
          source_comment_id: 9205,
        },
      ],
      accepted_attachment_submission: {
        comment_id: 9205,
        comment_created_at: '2026-06-02T09:08:00Z',
        uploader_login: 'requester',
        attachment_url: 'https://github.com/user-attachments/files/9205/remove-access-corrected.csv',
        filename: 'remove-access-corrected.csv',
        extension: '.csv',
        content_hash: 'hash',
        acceptance_status: 'accepted',
      },
      designated_approver_login: 'octocat',
      request_status: 'approved',
      dry_run: false,
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
          source_row_number: 1,
          source_comment_id: 9205,
        },
        {
          requested_repository_name: 'developer-portal',
          repository_owner: 'octo-org',
          repository_name: 'developer-portal',
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
          source_comment_id: 9205,
        },
      ],
      already_absent_repository_removals: [
        {
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
          source_comment_id: 9205,
        },
      ],
    },
    assignment: {
      assignment_status: 'assigned',
      assigned_login: 'central-owner',
      assignment_note: 'routing only',
      assigned_at: '2026-06-02T10:00:00Z',
    },
    approval: {
      approval_status: 'approved',
      approver_login: 'octocat',
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
      approver_membership_state: 'active',
      decision_source: 'comment',
      decision_note: 'approved',
    },
    reconciliation: {
      organization_exists: true,
      team_exists: true,
      removals_to_apply: [
        {
          repository_full_name: 'octo-org/service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          desired_action: 'remove_access',
          validation_status: 'valid',
          source_row_number: 1,
          source_comment_id: 9205,
        },
      ],
      already_absent_noops: [
        {
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
          source_comment_id: 9205,
        },
      ],
      rejected_items: [],
      dry_run: false,
      state: 'approved_for_execution',
    },
    execution: {
      summary: 'approved removal ready',
    },
    metadata: {
      operation: 'team_repo_access_removal',
      run_id: '9801',
      run_attempt: '1',
    },
  };
}

function writeArtifact(artifact) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-exec-int-'));
  const artifactPath = path.join(workspace, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('mixed-state approved removal execution is idempotent across reruns', async () => {
  const artifactPath = writeArtifact(createApprovedArtifact());

  const removedCalls = [];
  const firstResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '9801',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      removeTeamRepositoryPermission: async ({ owner, repo }) => {
        removedCalls.push(`${owner}/${repo}`);
        return { repository_full_name: `${owner}/${repo}` };
      },
      getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
      getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'platform-engineering' } }),
      getRepository: async ({ owner, repo }) => ({
        exists: true,
        repository: { owner, name: repo, full_name: `${owner}/${repo}`, archived: false },
      }),
      getTeamRepositoryPermission: async ({ repo }) => ({
        exists: true,
        current_permission_api_value: repo === 'service-catalog' ? 'maintain' : 'none',
      }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      addIssueLabels: async () => {},
    }),
  });

  assert.equal(firstResult.request.request_status, 'executed');
  assert.equal(firstResult.execution.mutation_count, 1);
  assert.equal(firstResult.execution.noop_count, 1);
  assert.deepEqual(removedCalls, ['octo-org/service-catalog']);

  const rerunResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '9801',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      removeTeamRepositoryPermission: async () => {
        throw new Error('rerun should not mutate already-removed repository access');
      },
      getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
      getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'platform-engineering' } }),
      getRepository: async ({ owner, repo }) => ({
        exists: true,
        repository: { owner, name: repo, full_name: `${owner}/${repo}`, archived: false },
      }),
      getTeamRepositoryPermission: async () => ({ exists: true, current_permission_api_value: 'none' }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      addIssueLabels: async () => {},
    }),
  });

  assert.equal(rerunResult.request.request_status, 'executed');
  assert.equal(rerunResult.execution.mutation_count, 0);
  assert.equal(rerunResult.execution.noop_count, 2);
});
