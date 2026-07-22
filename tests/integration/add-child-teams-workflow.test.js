'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { restoreRequestAuditArtifact } = require('../../src/scripts/restore-request-audit-artifact');
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

function createArtifactZipBuffer(files) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-artifact-zip-'));
  const sourceDir = path.join(workspace, 'source');
  const zipPath = path.join(workspace, 'artifact.zip');

  fs.mkdirSync(sourceDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
  }

  const zipCommand = process.platform === 'win32'
    ? `Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${zipPath}' -Force`
    : `zip -qr '${zipPath}' .`;

  if (process.platform === 'win32') {
    const { spawnSync } = require('child_process');
    const result = spawnSync('powershell', ['-NoProfile', '-Command', zipCommand], {
      cwd: sourceDir,
      stdio: 'pipe',
    });
    assert.equal(result.status, 0);
  } else {
    const { spawnSync } = require('child_process');
    const result = spawnSync('sh', ['-c', zipCommand], {
      cwd: sourceDir,
      stdio: 'pipe',
    });
    assert.equal(result.status, 0);
  }

  return fs.readFileSync(zipPath);
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

test('bounded retry exhaustion still reports partial execution details and rate-limit context', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const rateLimitError = loadFixture('team-hierarchy-rate-limit.json').secondary_limit_error;
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Application Platform',
      requested_name: 'Application Platform',
      child_team_slug: 'application-platform',
      desired_action: 'link_child',
      validation_status: 'valid',
    },
    {
      requested_child_name: 'Release Engineering',
      requested_name: 'Release Engineering',
      child_team_slug: 'release-engineering',
      desired_action: 'link_child',
      validation_status: 'valid',
    },
  ];
  artifact.validation.requested_child_links = [...artifact.request.requested_child_links];
  artifact.validation.existing_child_links = [];
  artifact.reconciliation.child_links_to_apply = [];
  artifact.reconciliation.child_links_already_present = [];
  const artifactPath = writeArtifact(artifact);
  const currentTeams = [
    fixture.current_teams[0],
    { ...fixture.current_teams[1], parent: null },
    { ...fixture.current_teams[2], parent: null },
  ];
  let releaseAttempts = 0;
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
      listOrgTeams: async () => currentTeams,
      updateTeamParent: async ({ teamSlug, parentTeamId }) => {
        if (teamSlug === 'application-platform') {
          return { id: 2, name: 'Application Platform', slug: teamSlug, parent: { id: parentTeamId, slug: 'platform-engineering' } };
        }

        releaseAttempts += 1;
        const error = new Error('secondary rate limit');
        error.status = rateLimitError.status;
        error.payload = rateLimitError.payload;
        error.headers = rateLimitError.headers;
        throw error;
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(releaseAttempts, 2);
  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(result.execution.linked_count, 1);
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.match(result.execution.summary, /processed 1 child link\(ies\).*1 failed child link\(ies\)/i);
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

test('CSV-derived approved hierarchy reruns remain no-op and preserve row provenance in the final artifact', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'bulk_csv';
  artifact.request.bulk_csv_input = 'child_team\nRelease Engineering';
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['child_team'],
    required_columns: ['child_team'],
    unsupported_columns: [],
    row_count: 1,
    valid_row_count: 1,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'valid',
    schema_errors: [],
  };
  artifact.request.csv_row_numbering_convention = '1-based data-row numbers that exclude the header row';
  artifact.request.csv_row_findings = [
    {
      row_number: 1,
      original_row: 'Release Engineering',
      child_team_name: 'Release Engineering',
      normalized_slug: 'release-engineering',
      validation_status: 'valid',
      failure_reason: null,
    },
  ];
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Release Engineering',
      requested_name: 'Release Engineering',
      child_team_slug: 'release-engineering',
      source_row_number: 1,
      desired_action: 'link_child',
      validation_status: 'valid',
    },
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
  assert.equal(result.reconciliation.intake_mode, 'bulk_csv');
  assert.equal(result.execution.intake_mode, 'bulk_csv');
  assert.equal(result.execution.linked_count, 0);
  assert.equal(result.execution.noop_count, 1);
  assert.deepEqual(
    result.reconciliation.child_links_already_present.map((entry) => entry.source_row_number),
    [1]
  );
  assert.deepEqual(
    result.execution.noop_teams.map((entry) => entry.source_row_number),
    [1]
  );
});

test('CSV-derived partial hierarchy failures preserve row provenance and compensating guidance', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'bulk_csv';
  artifact.request.bulk_csv_input = 'child_team\nApplication Platform\nRelease Engineering';
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['child_team'],
    required_columns: ['child_team'],
    unsupported_columns: [],
    row_count: 2,
    valid_row_count: 2,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'valid',
    schema_errors: [],
  };
  artifact.request.csv_row_numbering_convention = '1-based data-row numbers that exclude the header row';
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Application Platform',
      requested_name: 'Application Platform',
      child_team_slug: 'application-platform',
      source_row_number: 1,
      desired_action: 'link_child',
      validation_status: 'valid',
    },
    {
      requested_child_name: 'Release Engineering',
      requested_name: 'Release Engineering',
      child_team_slug: 'release-engineering',
      source_row_number: 2,
      desired_action: 'link_child',
      validation_status: 'valid',
    },
  ];
  artifact.validation.requested_child_links = [...artifact.request.requested_child_links];
  artifact.validation.existing_child_links = [];
  artifact.reconciliation.child_links_to_apply = [];
  artifact.reconciliation.child_links_already_present = [];
  const currentTeams = [
    fixture.current_teams[0],
    { ...fixture.current_teams[1], parent: null },
    { ...fixture.current_teams[2], parent: null },
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
  assert.equal(result.execution.rollback_status, 'compensating_action_required');
  assert.equal(result.execution.linked_count, 1);
  assert.deepEqual(
    result.execution.failed_teams.map((entry) => ({ entity_id: entry.entity_id, source_row_number: entry.source_row_number })),
    [{ entity_id: 'release-engineering', source_row_number: 2 }]
  );
  assert.match(result.execution.remediation_instructions[0], /failed subset only: release-engineering/i);
});

test('CSV-derived hierarchy rate-limit retries preserve retry metadata and row provenance', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const rateLimitError = loadFixture('team-hierarchy-rate-limit.json').secondary_limit_error;
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'bulk_csv';
  artifact.request.bulk_csv_input = 'child_team\nApplication Platform\nRelease Engineering';
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['child_team'],
    required_columns: ['child_team'],
    unsupported_columns: [],
    row_count: 2,
    valid_row_count: 2,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'valid',
    schema_errors: [],
  };
  artifact.request.csv_row_numbering_convention = '1-based data-row numbers that exclude the header row';
  artifact.request.requested_child_links[0].source_row_number = 1;
  artifact.request.requested_child_links[1].source_row_number = 2;
  artifact.validation.requested_child_links = structuredClone(artifact.request.requested_child_links);
  artifact.validation.existing_child_links = [structuredClone(artifact.request.requested_child_links[1])];
  artifact.reconciliation.child_links_to_apply = [];
  artifact.reconciliation.child_links_already_present = [];
  const artifactPath = writeArtifact(artifact);
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
      listOrgTeams: async () => fixture.current_teams.map((team) => team.slug === 'application-platform' ? { ...team, parent: null } : team),
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
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
  assert.deepEqual(
    result.execution.noop_teams.map((entry) => entry.source_row_number),
    [2]
  );
});

test('CSV-derived rejected hierarchy links remain rejected with row provenance and no mutation', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'bulk_csv';
  artifact.request.bulk_csv_input = 'child_team\nSecurity Engineering\nApplication Infrastructure';
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['child_team'],
    required_columns: ['child_team'],
    unsupported_columns: [],
    row_count: 2,
    valid_row_count: 2,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'valid',
    schema_errors: [],
  };
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Security Engineering',
      requested_name: 'Security Engineering',
      child_team_slug: 'security-engineering',
      source_row_number: 1,
      desired_action: 'reject',
      validation_status: 'reparent_blocked',
      failure_reason: 'reparent_blocked',
    },
    {
      requested_child_name: 'Application Infrastructure',
      requested_name: 'Application Infrastructure',
      child_team_slug: 'application-infrastructure',
      source_row_number: 2,
      desired_action: 'reject',
      validation_status: 'cycle_blocked',
      failure_reason: 'cycle_blocked',
    },
  ];
  artifact.validation.requested_child_links = structuredClone(artifact.request.requested_child_links);
  artifact.validation.existing_child_links = [];
  artifact.reconciliation.child_links_to_apply = [];
  artifact.reconciliation.child_links_already_present = [];
  artifact.reconciliation.child_links_rejected = [];
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
        throw new Error('mutation should not run for rejected child links');
      },
    }),
  });

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.execution.linked_count, 0);
  assert.equal(result.execution.failure_count, 2);
  assert.deepEqual(
    result.reconciliation.child_links_rejected.map((entry) => ({ failure_reason: entry.failure_reason, source_row_number: entry.source_row_number })),
    [
      { failure_reason: 'reparent_blocked', source_row_number: 1 },
      { failure_reason: 'cycle_blocked', source_row_number: 2 },
    ]
  );
  assert.deepEqual(
    result.execution.failed_teams.map((entry) => ({ entity_id: entry.entity_id, source_row_number: entry.source_row_number })),
    [
      { entity_id: 'security-engineering', source_row_number: 1 },
      { entity_id: 'application-infrastructure', source_row_number: 2 },
    ]
  );
});

test('csv_attachment hierarchy execution that fully fails after approval records failed_after_approved_execution terminal state and label', async () => {
  const fixture = loadFixture('team-hierarchy-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'csv_attachment';
  artifact.request.accepted_attachment_submission = {
    comment_id: 9901,
    comment_created_at: '2026-05-25T10:00:00Z',
    uploader_login: 'himanshu-im',
    attachment_url: 'https://github.com/user-attachments/files/9901/child-teams.csv',
    filename: 'child-teams.csv',
    extension: '.csv',
    content_hash: 'hash-9901',
    downloaded_at: '2026-05-25T10:00:02Z',
    byte_size: 64,
    acceptance_status: 'accepted',
    rejection_reason: null,
  };
  artifact.request.requested_child_links = [
    {
      requested_child_name: 'Application Platform',
      requested_name: 'Application Platform',
      child_team_slug: 'application-platform',
      source_row_number: 1,
      source_comment_id: 9901,
      desired_action: 'link_child',
      validation_status: 'valid',
    },
  ];
  artifact.validation.requested_child_links = structuredClone(artifact.request.requested_child_links);
  artifact.validation.existing_child_links = [];
  const artifactPath = writeArtifact(artifact);
  const labels = [];

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
      listOrgTeams: async () => fixture.current_teams.map((team) =>
        team.slug === 'application-platform' ? { ...team, parent: null } : team
      ),
      updateTeamParent: async () => {
        const error = new Error('Failed to update team parent');
        error.status = 422;
        error.payload = { message: 'Validation failed' };
        error.headers = {};
        throw error;
      },
      addIssueLabels: async ({ labels: requestedLabels }) => {
        labels.push(...requestedLabels);
        return requestedLabels;
      },
    }),
    sleep: async () => {
      throw new Error('sleep should not be called for non-retryable failures');
    },
  });

  assert.equal(result.request.request_status, 'failed_after_approved_execution');
  assert.equal(result.execution.failure_count, 1);
  assert.deepEqual(labels, ['issueops:add-child-teams:failed_after_approved_execution']);
});

test('restoreRequestAuditArtifact prefers the newest terminal add-child-teams artifact over a newer reopened awaiting-approval artifact', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-child-teams-terminal-restore-'));
  const artifactPath = path.join(workspace, 'restored.json');
  const terminalArtifact = {
    request: {
      request_id: 'repo#901/run.3',
      issue_number: 901,
      repository: 'im-sandbox-himanshu/issueops-speckit',
      organization: 'im-sandbox-himanshu',
      parent_team_slug: 'platform-engineering',
      designated_approver_login: 'himanshu-im',
      intake_mode: 'csv_attachment',
      request_status: 'executed',
      dry_run: false,
    },
    validation: { is_valid: true, errors: [], warnings: [] },
    assignment: {},
    approval: { approval_status: 'approved' },
    reconciliation: {},
    execution: { summary: 'completed' },
    metadata: { operation: 'team_hierarchy', run_id: '901', run_attempt: '3' },
  };
  const reopenedArtifact = {
    request: {
      request_id: 'repo#901/run.4',
      issue_number: 901,
      repository: 'im-sandbox-himanshu/issueops-speckit',
      organization: 'im-sandbox-himanshu',
      parent_team_slug: 'platform-engineering',
      designated_approver_login: 'himanshu-im',
      intake_mode: 'csv_attachment',
      request_status: 'awaiting_approval',
      dry_run: false,
    },
    validation: { is_valid: true, errors: [], warnings: [] },
    assignment: {},
    approval: { approval_status: 'pending' },
    reconciliation: {},
    execution: { summary: 'pending' },
    metadata: { operation: 'team_hierarchy', run_id: '901', run_attempt: '4' },
  };

  const zippedTerminal = createArtifactZipBuffer({
    'artifacts/add-child-teams-validation-901.json': JSON.stringify(terminalArtifact, null, 2),
  });
  const zippedReopened = createArtifactZipBuffer({
    'artifacts/add-child-teams-validation-901.json': JSON.stringify(reopenedArtifact, null, 2),
  });

  const artifacts = [
    {
      id: 2,
      name: 'add-child-teams-validation-901',
      expired: false,
      created_at: '2026-05-25T10:20:00Z',
      archive_download_url: 'https://example.test/reopened.zip',
      workflow_run: { id: 2 },
    },
    {
      id: 1,
      name: 'add-child-teams-validation-901',
      expired: false,
      created_at: '2026-05-25T10:10:00Z',
      archive_download_url: 'https://example.test/terminal.zip',
      workflow_run: { id: 1 },
    },
  ];

  const result = await restoreRequestAuditArtifact({
    repository: 'im-sandbox-himanshu/issueops-speckit',
    issueNumber: '901',
    token: 'test-token',
    artifactPath,
    currentRunId: '3',
    downloadArtifactArchive: async ({ artifact }) =>
      artifact.id === 2 ? zippedReopened : zippedTerminal,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ artifacts }),
    }),
  });

  assert.equal(result.restored, true);
  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(persisted.request.request_status, 'executed');
});