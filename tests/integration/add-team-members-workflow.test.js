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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-speckit-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(baseArtifact, null, 2));
  return artifactPath;
}

test('executes approved mutations and records added memberships', async () => {
  const baseArtifact = loadFixture('add-member-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);
  const calls = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '777',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [],
      addOrUpdateTeamMembership: async ({ username }) => {
        calls.push(username);
        return { username, state: 'active', role: 'member' };
      },
    }),
    sleep: async () => {
      throw new Error('sleep should not be called');
    },
  });

  assert.deepEqual(calls, ['octocat', 'hubot']);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 2);
  assert.equal(result.execution.noop_count, 0);
  assert.equal(result.execution.failure_count, 0);
});

test('execution persists audit artifact fields and requester-facing summary content', async () => {
  const baseArtifact = loadFixture('add-member-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '888',
      GITHUB_RUN_ATTEMPT: '3',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true },
    createApi: () => ({
      listTeamMembers: async () => [{ login: 'octocat', state: 'active' }],
      addOrUpdateTeamMembership: async ({ username }) => ({ username, state: 'active', role: 'member' }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.deepEqual(persisted.request.requested_people, ['octocat', 'hubot']);
  assert.equal(persisted.execution.mutation_count, 1);
  assert.equal(persisted.execution.noop_count, 1);
  assert.deepEqual(persisted.reconciliation.people_already_present.map((entry) => entry.username), ['octocat']);
  assert.deepEqual(persisted.reconciliation.people_to_add.map((entry) => entry.username), ['hubot']);
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Added: 1/i);
  assert.match(summary, /No-op: 1/i);
  assert.match(summary, /Approval: approved \(org_owner\)/i);
});

test('re-running an approved request with current members already present produces a no-op outcome', async () => {
  const baseArtifact = loadFixture('add-member-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [
        { login: 'octocat', state: 'active' },
        { login: 'hubot', state: 'active' },
      ],
      addOrUpdateTeamMembership: async () => {
        throw new Error('mutation should not run for satisfied members');
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 0);
  assert.equal(result.execution.noop_count, 2);
  assert.match(result.execution.summary, /0 member\(s\).*2 no-op membership\(s\)/i);
});

test('partial failure records compensating recovery guidance for the failed subset', async () => {
  const baseArtifact = loadFixture('add-member-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);
  let firstCall = true;

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [],
      addOrUpdateTeamMembership: async ({ username }) => {
        if (firstCall) {
          firstCall = false;
          return { username, state: 'active', role: 'member' };
        }

        const error = new Error('Failed to add team membership');
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
  assert.equal(result.execution.mutation_count, 1);
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.match(result.execution.remediation_instructions[0], /failed subset only: hubot/i);
});

test('retryable rate-limit failures use bounded retry and eventually succeed', async () => {
  const baseArtifact = loadFixture('add-member-success.json').approved_artifact;
  const artifactPath = writeArtifact(baseArtifact);
  const rateLimitError = loadFixture('rate-limit-response.json').secondary_limit_error;
  let attempts = 0;
  const delays = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [],
      addOrUpdateTeamMembership: async ({ username }) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('secondary rate limit');
          error.status = rateLimitError.status;
          error.payload = rateLimitError.payload;
          error.headers = rateLimitError.headers;
          throw error;
        }
        return { username, state: 'active', role: 'member' };
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 2);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
});