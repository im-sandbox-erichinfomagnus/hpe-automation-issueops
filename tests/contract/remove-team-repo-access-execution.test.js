'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');

function createApprovedRemovalArtifact(overrides = {}) {
  return {
    request: {
      request_id: 'remove#9701/run.1',
      issue_number: 9701,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      team_name: 'Platform Engineering',
      intake_mode: 'manual',
      requested_repositories_input: 'service-catalog\ndeveloper-portal',
      requested_repository_removals: [
        {
          requested_repository_name: 'service-catalog',
          repository_owner: 'octo-org',
          repository_name: 'service-catalog',
          repository_full_name: 'octo-org/service-catalog',
          desired_action: 'remove_access',
          validation_status: 'valid',
          source_row_number: 1,
        },
        {
          requested_repository_name: 'developer-portal',
          repository_owner: 'octo-org',
          repository_name: 'developer-portal',
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
        },
      ],
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
        },
        {
          requested_repository_name: 'developer-portal',
          repository_owner: 'octo-org',
          repository_name: 'developer-portal',
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
        },
      ],
      already_absent_repository_removals: [
        {
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
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
        },
      ],
      already_absent_noops: [
        {
          repository_full_name: 'octo-org/developer-portal',
          desired_action: 'noop_already_absent',
          validation_status: 'already_absent',
          source_row_number: 2,
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
      run_id: '9701',
      run_attempt: '1',
    },
    ...overrides,
  };
}

function writeArtifact(artifact) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-exec-contract-'));
  const artifactPath = path.join(workspace, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('dry-run approved removal does not mutate and remains blocked by dry_run policy', async () => {
  const artifact = createApprovedRemovalArtifact();
  artifact.request.dry_run = true;
  const artifactPath = writeArtifact(artifact);

  let called = false;
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
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
        called = true;
      },
    }),
  });

  assert.equal(called, false);
  assert.equal(result.request.request_status, 'approved');
  assert.match(result.execution.summary, /dry-run only/i);
});

test('retryable rate-limit failure uses bounded retry budget and records failure when exhausted', async () => {
  const artifactPath = writeArtifact(createApprovedRemovalArtifact());
  const delays = [];
  let attempts = 0;

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '9702',
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
      removeTeamRepositoryPermission: async () => {
        attempts += 1;
        const error = new Error('secondary rate limit');
        error.status = 429;
        error.payload = { message: 'secondary rate limit' };
        error.headers = {
          get(name) {
            if (String(name).toLowerCase() === 'retry-after') {
              return '2';
            }
            return null;
          },
        };
        throw error;
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(result.execution.failure_count, 1);
  assert.match(result.execution.summary, /partial failure/i);
});

test('partial failure persists remediation and per-repository failure outcome fields', async () => {
  const artifactPath = writeArtifact(createApprovedRemovalArtifact());
  let first = true;

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '9703',
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
        if (first) {
          first = false;
          return { repository_full_name: `${owner}/${repo}` };
        }

        const error = new Error('validation failed');
        error.status = 422;
        error.payload = { message: 'validation failed' };
        error.headers = {};
        throw error;
      },
      getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
      getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'platform-engineering' } }),
      getRepository: async ({ owner, repo }) => ({
        exists: true,
        repository: { owner, name: repo, full_name: `${owner}/${repo}`, archived: false },
      }),
      getTeamRepositoryPermission: async ({ repo }) => ({
        exists: true,
        current_permission_api_value: repo === 'developer-portal' ? 'maintain' : 'maintain',
      }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    }),
  });

  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.match(result.execution.remediation_instructions[0], /failed subset only/i);
  assert.ok(Array.isArray(result.execution.mutated_repositories));
  assert.ok(Array.isArray(result.execution.failed_repositories));
});

test('operation-scope guardrail does not invoke unrelated admin mutation APIs in removal mode', async () => {
  const artifactPath = writeArtifact(createApprovedRemovalArtifact());

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '9704',
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
      removeTeamRepositoryPermission: async ({ owner, repo }) => ({ repository_full_name: `${owner}/${repo}` }),
      addOrUpdateTeamMembership: async () => {
        throw new Error('membership mutation is out of scope for removal execution');
      },
      createTeam: async () => {
        throw new Error('team creation is out of scope for removal execution');
      },
      updateTeamParent: async () => {
        throw new Error('team hierarchy mutation is out of scope for removal execution');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        throw new Error('repository grant mutation is out of scope for removal execution');
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 1);
  assert.equal(result.execution.noop_count, 1);
});
