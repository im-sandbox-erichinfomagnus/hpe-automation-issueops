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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-speckit-child-teams-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(baseArtifact, null, 2));
  return artifactPath;
}

test('executes approved hierarchy mutation and records linked child teams', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifactPath = writeArtifact(fixture.approved_artifact);
  const calls = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '777',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: {
      token: 'test-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_hierarchy_mutation: true,
    },
    createApi: () => ({
      listOrgTeams: async () => fixture.current_teams,
      updateTeamParent: async ({ teamSlug, parentTeamId }) => {
        calls.push({ teamSlug, parentTeamId });
        return { id: 2, name: 'Application Platform', slug: teamSlug, parent: { id: parentTeamId, slug: 'platform-engineering' } };
      },
    }),
    sleep: async () => {
      throw new Error('sleep should not be called');
    },
  });

  assert.deepEqual(calls, [{ teamSlug: 'application-platform', parentTeamId: 1 }]);
  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.linked_count, 1);
  assert.equal(result.execution.noop_count, 1);
  assert.equal(result.execution.failure_count, 0);
});

test('re-running an approved hierarchy request with current child links already present produces a no-op outcome', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Release Engineering',
      requested_name: 'Release Engineering',
      child_team_slug: 'release-engineering',
      desired_action: 'link_child',
      validation_status: 'valid'
    }
  ];
  artifact.validation.requested_child_links = [...artifact.request.requested_child_links];
  artifact.validation.existing_child_links = [];
  artifact.reconciliation.child_links_to_apply = [];
  artifact.reconciliation.child_links_already_present = [];
  const artifactPath = writeArtifact(artifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: {
      token: 'test-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_hierarchy_mutation: true,
    },
    createApi: () => ({
      listOrgTeams: async () => fixture.current_teams,
      updateTeamParent: async () => {
        throw new Error('mutation should not run for satisfied child links');
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.linked_count, 0);
  assert.equal(result.execution.noop_count, 1);
  assert.match(result.execution.summary, /0 child link\(ies\).*1 no-op child link\(ies\)/i);
});

test('partial failure records compensating recovery guidance for the failed child-link subset', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Application Platform',
      requested_name: 'Application Platform',
      child_team_slug: 'application-platform',
      desired_action: 'link_child',
      validation_status: 'valid'
    },
    {
      requested_child_name: 'Release Engineering',
      requested_name: 'Release Engineering',
      child_team_slug: 'release-engineering',
      desired_action: 'link_child',
      validation_status: 'valid'
    }
  ];
  artifact.validation.requested_child_links = [...artifact.request.requested_child_links];
  artifact.validation.existing_child_links = [];
  artifact.reconciliation.child_links_to_apply = [];
  artifact.reconciliation.child_links_already_present = [];
  const currentTeams = [
    fixture.current_teams[0],
    { ...fixture.current_teams[1], parent: null },
    { ...fixture.current_teams[2], parent: null }
  ];
  const artifactPath = writeArtifact(artifact);
  let firstCall = true;

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: {
      token: 'test-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_hierarchy_mutation: true,
    },
    createApi: () => ({
      listOrgTeams: async () => currentTeams,
      updateTeamParent: async ({ teamSlug, parentTeamId }) => {
        if (firstCall) {
          firstCall = false;
          return { id: 2, name: 'Application Platform', slug: teamSlug, parent: { id: parentTeamId, slug: 'platform-engineering' } };
        }

        const error = new Error('Failed to update team parent');
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
  assert.equal(result.execution.linked_count, 1);
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.match(result.execution.remediation_instructions[0], /failed subset only: release-engineering/i);
});

test('retryable rate-limit failures use bounded retry and eventually succeed for hierarchy mutation', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifactPath = writeArtifact(fixture.approved_artifact);
  const rateLimitError = loadFixture('team-hierarchy-rate-limit.json').secondary_limit_error;
  let attempts = 0;
  const delays = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: {
      token: 'test-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_hierarchy_mutation: true,
    },
    createApi: () => ({
      listOrgTeams: async () => fixture.current_teams,
      updateTeamParent: async ({ teamSlug, parentTeamId }) => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('secondary rate limit');
          error.status = rateLimitError.status;
          error.payload = rateLimitError.payload;
          error.headers = rateLimitError.headers;
          throw error;
        }

        return { id: 2, name: 'Application Platform', slug: teamSlug, parent: { id: parentTeamId, slug: 'platform-engineering' } };
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.linked_count, 1);
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
});

test('execution persists hierarchy audit fields and requester-facing summary content', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifactPath = writeArtifact(fixture.approved_artifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '888',
      GITHUB_RUN_ATTEMPT: '3',
    },
    tokenInfo: {
      token: 'test-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_hierarchy_mutation: true,
    },
    createApi: () => ({
      listOrgTeams: async () => fixture.current_teams,
      updateTeamParent: async ({ teamSlug, parentTeamId }) => ({ id: 2, name: 'Application Platform', slug: teamSlug, parent: { id: parentTeamId, slug: 'platform-engineering' } }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.equal(persisted.execution.linked_count, 1);
  assert.equal(persisted.execution.noop_count, 1);
  assert.deepEqual(persisted.reconciliation.child_links_to_apply.map((entry) => entry.child_team_slug), ['application-platform']);
  assert.deepEqual(persisted.reconciliation.child_links_already_present.map((entry) => entry.child_team_slug), ['release-engineering']);
  assert.match(summary, /Request status: executed/i);
  assert.match(summary, /Child links applied: 1/i);
  assert.match(summary, /No-op: 1/i);
  assert.match(summary, /Approval: approved \(authorized\)/i);
});