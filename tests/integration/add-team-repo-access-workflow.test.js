'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');

function loadFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeArtifact(baseArtifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-speckit-team-repo-access-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(baseArtifact, null, 2));
  return artifactPath;
}

test('executes approved repository-access requests without falling back to membership policy', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifactPath = writeArtifact(fixture.approved_artifact);

  const calls = [];
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '900',
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
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => {
        calls.push(`${owner}/${repo}:${permission}`);
        return { repository_full_name: `${owner}/${repo}`, permission };
      },
    }),
    sleep: async () => {
      throw new Error('sleep should not be called');
    },
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.deepEqual(calls, ['octo-org/service-catalog:maintain']);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.granted_count, 1);
  assert.equal(result.execution.noop_count, 1);
  assert.equal(result.execution.failure_count, 0);
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Granted repositories: 1/i);
  assert.match(summary, /No-op repositories: 1/i);
  assert.match(summary, /repository-access execution completed/i);
});

test('re-running an approved repository-access request with all repositories already satisfied produces a no-op outcome', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.requested_repository_grants = artifact.request.requested_repository_grants.map((entry) => ({
    ...entry,
    desired_action: 'noop',
    validation_status: 'exact_match',
    current_permission_api_value: 'maintain',
  }));
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.reconciliation.repositories_to_grant = [];
  artifact.reconciliation.repositories_already_satisfied = structuredClone(artifact.request.requested_repository_grants);
  const artifactPath = writeArtifact(artifact);

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
      addOrUpdateTeamRepositoryPermission: async () => {
        throw new Error('mutation should not run for satisfied repositories');
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.granted_count, 0);
  assert.equal(result.execution.noop_count, 2);
  assert.match(result.execution.summary, /0 repository\(ies\).*2 no-op repository\(ies\)/i);
});

test('partial failure records compensating recovery guidance for the failed repository subset', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.requested_repository_grants = [
    {
      requested_repository_name: 'service-catalog',
      repository_owner: 'octo-org',
      repository_name: 'service-catalog',
      repository_full_name: 'octo-org/service-catalog',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
    },
    {
      requested_repository_name: 'developer-portal',
      repository_owner: 'octo-org',
      repository_name: 'developer-portal',
      repository_full_name: 'octo-org/developer-portal',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
    }
  ];
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = [];
  artifact.reconciliation.repositories_to_grant = structuredClone(artifact.request.requested_repository_grants);
  artifact.reconciliation.repositories_already_satisfied = [];
  const artifactPath = writeArtifact(artifact);
  let firstCall = true;

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
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => {
        if (firstCall) {
          firstCall = false;
          return { repository_full_name: `${owner}/${repo}`, permission };
        }

        const error = new Error('Failed to add team repository permission');
        error.status = 422;
        error.payload = { message: 'Validation failed' };
        error.headers = {};
        throw error;
      },
    }),
    sleep: async () => {
      throw new Error('sleep should not be called for non-retryable failures');
    },
  });

  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(result.execution.granted_count, 1);
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.match(result.execution.remediation_instructions[0], /failed subset only: octo-org\/developer-portal/i);
});

test('retryable rate-limit failures use bounded retry and eventually succeed for repository-access mutation', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const rateLimitError = loadFixture('team-repo-access-rate-limit.json').secondary_limit_error;
  const artifactPath = writeArtifact(fixture.approved_artifact);
  let attempts = 0;
  const delays = [];

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
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('secondary rate limit');
          error.status = rateLimitError.status;
          error.payload = rateLimitError.payload;
          error.headers = rateLimitError.headers;
          throw error;
        }

        return { repository_full_name: `${owner}/${repo}`, permission };
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.granted_count, 1);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
});

test('execution persists repository-access audit fields and requester-facing summary content', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifactPath = writeArtifact(fixture.approved_artifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '901',
      GITHUB_RUN_ATTEMPT: '3',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.equal(persisted.execution.granted_count, 1);
  assert.equal(persisted.execution.noop_count, 1);
  assert.deepEqual(persisted.reconciliation.repositories_to_grant.map((entry) => entry.repository_full_name), ['octo-org/service-catalog']);
  assert.deepEqual(persisted.reconciliation.repositories_already_satisfied.map((entry) => entry.repository_full_name), ['octo-org/developer-portal']);
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Granted repositories: 1/i);
  assert.match(summary, /No-op repositories: 1/i);
  assert.match(summary, /Approval: approved \(authorized\)/i);
});

test('approved execution re-reads current repository state and converts stale grants into no-op or rejection outcomes', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.requested_repository_grants = [
    {
      requested_repository_name: 'service-catalog',
      repository_owner: 'octo-org',
      repository_name: 'service-catalog',
      repository_full_name: 'octo-org/service-catalog',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none'
    },
    {
      requested_repository_name: 'legacy-portal',
      repository_owner: 'octo-org',
      repository_name: 'legacy-portal',
      repository_full_name: 'octo-org/legacy-portal',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none'
    }
  ];
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = [];
  artifact.reconciliation.repositories_to_grant = structuredClone(artifact.request.requested_repository_grants);
  artifact.reconciliation.repositories_already_satisfied = [];
  const artifactPath = writeArtifact(artifact);

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
      getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
      getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'platform-engineering' } }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      getRepository: async ({ owner, repo }) => ({
        exists: true,
        repository: {
          id: `${owner}/${repo}`,
          name: repo,
          full_name: `${owner}/${repo}`,
          owner,
          archived: false,
          private: true,
        },
      }),
      getTeamRepositoryPermission: async ({ repo }) =>
        repo === 'service-catalog'
          ? { exists: true, current_permission_api_value: 'maintain' }
          : { exists: true, current_permission_api_value: 'pull' },
      addOrUpdateTeamRepositoryPermission: async () => {
        throw new Error('mutation should not run for stale-state no-op or rejected repositories');
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.granted_count, 0);
  assert.equal(result.execution.noop_count, 1);
  assert.equal(result.execution.rejected_count, 1);
  assert.match(result.execution.summary, /1 no-op repository\(ies\).*1 rejected repository\(ies\)/i);
});