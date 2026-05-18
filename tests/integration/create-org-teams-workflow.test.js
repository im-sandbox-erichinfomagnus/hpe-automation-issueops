'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeArtifact(baseArtifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-speckit-team-create-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(baseArtifact, null, 2));
  return artifactPath;
}

test('executes approved team creation and records created teams', async () => {
  const baseArtifact = loadFixture('create-team-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);
  const calls = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '777',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [],
      createTeam: async ({ name, organization }) => {
        calls.push({ name, organization });
        return { id: calls.length, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
      },
    }),
    sleep: async () => {
      throw new Error('sleep should not be called');
    },
  });

  assert.deepEqual(calls.map((entry) => entry.name), ['Platform Engineering', 'AI Model Routing Specialists']);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.created_count, 2);
  assert.equal(result.execution.noop_count, 0);
  assert.equal(result.execution.failure_count, 0);
});

test('execution persists team-creation audit fields and requester-facing summary content', async () => {
  const baseArtifact = loadFixture('create-team-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '888',
      GITHUB_RUN_ATTEMPT: '3',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [{ id: 1, name: 'Platform Engineering', slug: 'platform-engineering' }],
      createTeam: async ({ name }) => ({ id: 2, name, slug: 'ai-model-routing-specialists' }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.deepEqual(persisted.request.requested_teams.map((entry) => entry.normalized_slug), ['platform-engineering', 'ai-model-routing-specialists']);
  assert.equal(persisted.execution.created_count, 1);
  assert.equal(persisted.execution.noop_count, 1);
  assert.deepEqual(persisted.reconciliation.teams_already_present.map((entry) => entry.normalized_slug), ['platform-engineering']);
  assert.deepEqual(persisted.reconciliation.teams_to_create.map((entry) => entry.normalized_slug), ['ai-model-routing-specialists']);
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Teams created: 1/i);
  assert.match(summary, /No-op: 1/i);
  assert.match(summary, /Approval: approved \(intended_owner\)/i);
});

test('re-running an approved request with current teams already present produces a no-op outcome', async () => {
  const baseArtifact = loadFixture('create-team-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [
        { id: 1, name: 'Platform Engineering', slug: 'platform-engineering' },
        { id: 2, name: 'AI Model Routing Specialists', slug: 'ai-model-routing-specialists' },
      ],
      createTeam: async () => {
        throw new Error('mutation should not run for satisfied teams');
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.created_count, 0);
  assert.equal(result.execution.noop_count, 2);
  assert.match(result.execution.summary, /0 team\(ies\).*2 no-op team\(ies\)/i);
});

test('partial failure records compensating recovery guidance for the failed team subset', async () => {
  const baseArtifact = loadFixture('create-team-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);
  let firstCall = true;

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [],
      createTeam: async ({ name }) => {
        if (firstCall) {
          firstCall = false;
          return { id: 1, name, slug: 'platform-engineering' };
        }

        const error = new Error('Failed to create team');
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
  assert.equal(result.execution.created_count, 1);
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.match(result.execution.remediation_instructions[0], /failed subset only: ai-model-routing-specialists/i);
});

test('retryable rate-limit failures use bounded retry and eventually succeed for team creation', async () => {
  const baseArtifact = loadFixture('create-team-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);
  const rateLimitError = loadFixture('team-create-rate-limit.json').secondary_limit_error;
  let attempts = 0;
  const delays = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [],
      createTeam: async ({ name }) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('secondary rate limit');
          error.status = rateLimitError.status;
          error.payload = rateLimitError.payload;
          error.headers = rateLimitError.headers;
          throw error;
        }
        return { id: 1, name, slug: 'platform-engineering' };
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.created_count, 2);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
});

test('validation summary and audit artifact clearly reject out-of-scope empty-team violations', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-phase6-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '499',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: ['Platform Engineering'],
        requested_people: ['octocat'],
        parent_team: 'platform',
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-499',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'admin' } }),
      listOrgTeams: async () => [],
    },
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = fs.readFileSync(summaryPath, 'utf8');

  assert.equal(result.validation.is_valid, false);
  assert.match(result.validation.errors.join('\n'), /parent-team input is out of scope/i);
  assert.match(result.validation.errors.join('\n'), /only creates empty teams/i);
  assert.equal(persisted.metadata.operation, 'team_creation');
  assert.equal(persisted.request.requester_login, 'requester');
  assert.equal(persisted.request.intended_owner_login, 'octocat');
  assert.match(summary, /Validation: failed/i);
  assert.match(summary, /No team creation was attempted/i);
});

test('execution summary documents the creator-maintainer constraint for operator awareness', async () => {
  const baseArtifact = loadFixture('create-team-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '999',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [],
      createTeam: async ({ name }) => ({ id: 1, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }),
    }),
  });

  assert.match(result.execution.summary, /creator becomes a team maintainer/i);
});