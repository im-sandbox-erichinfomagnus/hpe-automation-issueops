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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-speckit-'));
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

function createBulkCsvApprovedArtifact() {
  const artifact = loadFixture('add-member-success.json').approved_artifact;
  artifact.request.intake_mode = 'bulk_csv';
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['username'],
    required_columns: ['username'],
    unsupported_columns: [],
    row_count: 3,
    valid_row_count: 2,
    invalid_row_count: 0,
    duplicate_row_count: 1,
    schema_status: 'valid',
    schema_errors: [],
  };
  artifact.request.csv_row_findings = [
    { row_number: 1, original_row: 'octocat', username: 'octocat', validation_status: 'valid', failure_reason: null },
    { row_number: 2, original_row: 'hubot', username: 'hubot', validation_status: 'valid', failure_reason: null },
    { row_number: 3, original_row: '@OCTOCAT', username: 'octocat', validation_status: 'duplicate', failure_reason: 'duplicate_username' },
  ];
  artifact.request.csv_row_numbering_convention = '1-based data-row numbers that exclude the header row';
  artifact.validation.csv_row_findings = [...artifact.request.csv_row_findings];
  artifact.validation.requested_people = [
    {
      username: 'octocat',
      source_row_number: 1,
      source_comment_id: 8801,
      resolution_status: 'resolved',
      current_membership_state: 'unknown',
      desired_action: 'add_member',
      execution_result: 'not_started',
      failure_reason: null,
    },
    {
      username: 'hubot',
      source_row_number: 2,
      source_comment_id: 8801,
      resolution_status: 'resolved',
      current_membership_state: 'unknown',
      desired_action: 'add_member',
      execution_result: 'not_started',
      failure_reason: null,
    },
  ];
  return artifact;
}

function createCsvAttachmentApprovedArtifact() {
  const artifact = loadFixture('add-member-success.json').approved_artifact;
  artifact.request.intake_mode = 'csv_attachment';
  artifact.request.accepted_attachment_submission = {
    comment_id: 8801,
    comment_created_at: '2026-05-21T10:00:00Z',
    uploader_login: 'requester',
    attachment_url: 'https://github.com/user-attachments/files/8801/sample.csv',
    filename: 'sample.csv',
    extension: '.csv',
    content_hash: 'hash-123',
    downloaded_at: '2026-05-21T10:01:00Z',
    byte_size: 32,
    acceptance_status: 'accepted',
    rejection_reason: null,
  };
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['username'],
    required_columns: ['username'],
    unsupported_columns: [],
    row_count: 2,
    valid_row_count: 2,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'valid',
    schema_errors: [],
  };
  artifact.request.csv_row_findings = [
    { row_number: 1, original_row: 'octocat', username: 'octocat', validation_status: 'valid', failure_reason: null },
    { row_number: 2, original_row: 'hubot', username: 'hubot', validation_status: 'valid', failure_reason: null },
  ];
  artifact.request.csv_row_numbering_convention = '1-based data-row numbers that exclude the header row';
  artifact.validation.csv_row_findings = [...artifact.request.csv_row_findings];
  artifact.validation.requested_people = [
    {
      username: 'octocat',
      source_row_number: 1,
      resolution_status: 'resolved',
      current_membership_state: 'unknown',
      desired_action: 'add_member',
      execution_result: 'not_started',
      failure_reason: null,
    },
    {
      username: 'hubot',
      source_row_number: 2,
      resolution_status: 'resolved',
      current_membership_state: 'unknown',
      desired_action: 'add_member',
      execution_result: 'not_started',
      failure_reason: null,
    },
  ];
  return artifact;
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

test('re-running an approved bulk CSV request with satisfied members remains a no-op and keeps CSV metadata visible', async () => {
  const artifactPath = writeArtifact(createBulkCsvApprovedArtifact());

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

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.noop_count, 2);
  assert.equal(result.execution.mutation_count, 0);
  assert.equal(result.execution.duplicate_row_count, 1);
  assert.match(summary, /Intake mode: bulk_csv/i);
  assert.match(summary, /CSV duplicate rows: 1/i);
  assert.match(summary, /No-op: 2/i);
});

test('partial failure for a bulk CSV request keeps CSV counts and row provenance in the final artifact', async () => {
  const artifactPath = writeArtifact(createBulkCsvApprovedArtifact());
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

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(persisted.execution.duplicate_row_count, 1);
  assert.equal(persisted.execution.invalid_row_count, 0);
  assert.deepEqual(
    persisted.reconciliation.people_to_add.map((entry) => entry.source_row_number),
    [1, 2]
  );
  assert.match(result.execution.remediation_instructions[0], /hubot/i);
});

test('retryable rate-limit handling for a bulk CSV request preserves CSV execution metadata', async () => {
  const artifactPath = writeArtifact(createBulkCsvApprovedArtifact());
  const rateLimitError = loadFixture('rate-limit-response.json').secondary_limit_error;
  let attempts = 0;

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
    sleep: async () => {},
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.duplicate_row_count, 1);
  assert.equal(result.execution.invalid_row_count, 0);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
});

test('re-running an approved attachment request with satisfied members remains a no-op and keeps attachment metadata visible', async () => {
  const artifactPath = writeArtifact(createCsvAttachmentApprovedArtifact());

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

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.noop_count, 2);
  assert.equal(result.execution.mutation_count, 0);
  assert.match(summary, /Intake mode: csv_attachment/i);
  assert.match(summary, /Attachment comment ID: 8801/i);
  assert.match(summary, /No-op: 2/i);
});

test('approved attachment requests preserve dry-run mode and avoid mutation execution', async () => {
  const artifact = createCsvAttachmentApprovedArtifact();
  artifact.request.dry_run = true;
  const artifactPath = writeArtifact(artifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => {
      throw new Error('API should not be created for dry-run attachment execution');
    },
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.dry_run, true);
  assert.equal(result.request.request_status, 'approved');
  assert.equal(persisted.request.accepted_attachment_submission.comment_id, 8801);
  assert.match(result.execution.summary, /dry-run only/i);
  assert.match(summary, /Attachment comment ID: 8801/i);
});

test('partial failure for an attachment request preserves row provenance and failed-subset guidance', async () => {
  const artifactPath = writeArtifact(createCsvAttachmentApprovedArtifact());
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

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(persisted.execution.failure_count, 1);
  assert.equal(persisted.execution.failed_subset[0].source_row_number, 2);
  assert.equal(persisted.execution.failed_subset[0].source_comment_id, 8801);
  assert.match(result.execution.remediation_instructions[0], /hubot/i);
});

test('attachment execution reports retry-required failure details when current member reads exhaust bounded retry', async () => {
  const artifactPath = writeArtifact(createCsvAttachmentApprovedArtifact());
  const rateLimitError = loadFixture('rate-limit-response.json').secondary_limit_error;
  const delays = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => {
        const error = new Error('secondary rate limit');
        error.status = rateLimitError.status;
        error.payload = rateLimitError.payload;
        error.headers = rateLimitError.headers;
        throw error;
      },
      addOrUpdateTeamMembership: async () => {
        throw new Error('mutation should not run when team state reads exhaust retries');
      },
    }),
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.execution.failure_count, 1);
  assert.equal(result.reconciliation.rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
  assert.match(result.execution.summary, /retry the request later/i);
  assert.match(summary, /Request status: failed/i);
});

test('restoreRequestAuditArtifact restores the latest prior per-issue artifact before validation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-artifact-restore-'));
  const artifactPath = path.join(workspace, 'artifacts', 'add-team-members-validation-121.json');
  const zipBuffer = createArtifactZipBuffer({
    'artifacts/add-team-members-validation-121.json': JSON.stringify({
      request: { request_status: 'executed', intake_mode: 'csv_attachment' },
      validation: { is_valid: true },
    }, null, 2),
  });

  const result = await restoreRequestAuditArtifact({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '121',
      GITHUB_TOKEN: 'test-token',
      GITHUB_RUN_ID: '999',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    fetchImpl: async (url) => {
      if (url.includes('/actions/artifacts?')) {
        return {
          ok: true,
          json: async () => ({
            artifacts: [
              {
                id: 12,
                name: 'add-team-members-validation-121',
                expired: false,
                created_at: '2026-05-21T10:00:00Z',
                archive_download_url: 'https://api.github.com/repos/octo-org/issueops-speckit/actions/artifacts/12/zip',
                workflow_run: { id: 998 },
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        arrayBuffer: async () => zipBuffer,
      };
    },
  });

  const restored = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.restored, true);
  assert.equal(restored.request.request_status, 'executed');
});

test('restoreRequestAuditArtifact skips restore when no prior artifact exists for the issue', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-artifact-no-restore-'));
  const artifactPath = path.join(workspace, 'artifacts', 'add-team-members-validation-122.json');

  const result = await restoreRequestAuditArtifact({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '122',
      GITHUB_TOKEN: 'test-token',
      GITHUB_RUN_ID: '1000',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ artifacts: [] }),
    }),
  });

  assert.equal(result.restored, false);
  assert.equal(fs.existsSync(artifactPath), false);
});

test('restoreRequestAuditArtifact prefers the newest terminal artifact over a newer reopened awaiting-approval artifact', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-artifact-terminal-restore-'));
  const artifactPath = path.join(workspace, 'artifacts', 'add-team-members-validation-123.json');
  const executedZip = createArtifactZipBuffer({
    'artifacts/add-team-members-validation-123.json': JSON.stringify({
      request: { request_status: 'executed', intake_mode: 'csv_attachment' },
      validation: { is_valid: true },
    }, null, 2),
  });
  const reopenedZip = createArtifactZipBuffer({
    'artifacts/add-team-members-validation-123.json': JSON.stringify({
      request: { request_status: 'awaiting_approval', intake_mode: 'csv_attachment' },
      validation: { is_valid: true },
    }, null, 2),
  });

  const result = await restoreRequestAuditArtifact({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '123',
      GITHUB_TOKEN: 'test-token',
      GITHUB_RUN_ID: '1001',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    fetchImpl: async (url) => {
      if (url.includes('/actions/artifacts?')) {
        return {
          ok: true,
          json: async () => ({
            artifacts: [
              {
                id: 21,
                name: 'add-team-members-validation-123',
                expired: false,
                created_at: '2026-05-21T10:15:00Z',
                archive_download_url: 'https://api.github.com/repos/octo-org/issueops-speckit/actions/artifacts/21/zip',
                workflow_run: { id: 1000 },
              },
              {
                id: 20,
                name: 'add-team-members-validation-123',
                expired: false,
                created_at: '2026-05-21T10:10:00Z',
                archive_download_url: 'https://api.github.com/repos/octo-org/issueops-speckit/actions/artifacts/20/zip',
                workflow_run: { id: 999 },
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        arrayBuffer: async () => url.includes('/21/zip') ? reopenedZip : executedZip,
      };
    },
  });

  const restored = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.restored, true);
  assert.equal(result.artifactId, 20);
  assert.equal(restored.request.request_status, 'executed');
});