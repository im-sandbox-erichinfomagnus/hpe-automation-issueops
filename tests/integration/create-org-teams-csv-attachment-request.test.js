'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function readWorkflow(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', fileName), 'utf8');
}

test('create-org-teams workflow already includes issue-comment and manual replay entrypoints for attachment intake', () => {
  const workflow = readWorkflow('create-org-teams.yml');

  assert.match(workflow, /issue_comment:\s*[\s\S]*types:\s*[\s\S]*- created/i);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- edited/i);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- deleted/i);
  assert.match(workflow, /workflow_dispatch:/i);
});

test('create-org-teams workflow keeps the Node 24 runtime assumption for phase-1 scaffolding', () => {
  const workflow = readWorkflow('create-org-teams.yml');

  assert.match(workflow, /uses:\s*actions\/setup-node@v6/i);
  assert.match(workflow, /node-version:\s*24/i);
});

test('workflow lint job keeps the actionlint guardrail used by the feature quickstart', () => {
  const workflow = readWorkflow('lint-workflows.yml');

  assert.match(workflow, /uses:\s*rhysd\/actionlint@v1\.7\.12/i);
  assert.match(workflow, /pull_request:/i);
  assert.match(workflow, /push:/i);
});

test('runRequestValidation records waiting-for-attachment state for create-org-teams attachment requests', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-attachment-waiting-'));
  const auditPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '611',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'platform-owner',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Create the requested teams to support the platform rollout.',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-611',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [],
    },
  });

  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(result.auditArtifact.request.request_status, 'waiting_for_attachment');
  assert.match(formatAuditSummary(result.auditArtifact), /waiting for requester CSV attachment comment/i);
});

test('runRequestValidation accepts a requester attachment and records attachment provenance for create-org-teams', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-attachment-valid-'));
  const auditPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '612',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'platform-owner',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Create the requested teams to support the platform rollout.',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-612',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [
        {
          id: 6101,
          created_at: '2026-05-22T09:05:00Z',
          body: '[team-creation.csv](https://github.com/octo-org/issueops-speckit/files/6101/team-creation.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('team_name\nPlatform Engineering\nRelease Managers\n').buffer,
    }),
  });

  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.request.accepted_attachment_submission.comment_id, 6101);
  assert.equal(result.auditArtifact.request.accepted_attachment_submission.comment_id, 6101);
  assert.match(formatAuditSummary(result.auditArtifact), /Attachment comment ID: 6101/i);
  assert.match(formatAuditSummary(result.auditArtifact), /CSV valid rows: 2/i);
});

test('runRequestValidation rejects invalid CSV content and records row-level findings', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-attachment-invalid-csv-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '613',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'platform-owner',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Create the requested teams.',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-613',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [
        {
          id: 6201,
          created_at: '2026-05-22T11:00:00Z',
          body: '[bad.csv](https://github.com/octo-org/issueops-speckit/files/6201/bad.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('wrong_header\nvalue\n').buffer,
    }),
  });

  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.is_valid, false);
  assert.ok(result.validation.errors.length > 0);
  assert.equal(result.auditArtifact.request.accepted_attachment_submission.comment_id, 6201);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Validation errors:/i);
});

test('runRequestValidation selects a corrected later attachment after a prior failed validation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-attachment-corrected-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  const priorArtifact = {
    request: {
      request_id: 'octo-org/issueops-speckit#614/run-614a.1',
      issue_number: 614,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      intended_owner_login: 'platform-owner',
      intake_mode: 'csv_attachment',
      requested_teams: [],
      request_status: 'validation_failed',
      dry_run: true,
      accepted_attachment_submission: {
        comment_id: 6301,
        comment_created_at: '2026-05-22T12:00:00Z',
        acceptance_status: 'accepted',
      },
      attachment_validation_attempt: {
        attempt_id: 'octo-org/issueops-speckit#614/run-614a.1:6301',
        attempt_status: 'csv_invalid',
        evaluated_at: '2026-05-22T12:01:00Z',
      },
    },
    validation: {
      is_valid: false,
      errors: ['CSV header missing required team_name column.'],
      request_status: 'validation_failed',
    },
    metadata: {
      operation: 'team_creation',
      run_id: 'run-614a',
      run_attempt: '1',
    },
  };
  fs.writeFileSync(auditPath, JSON.stringify(priorArtifact, null, 2));

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '614',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'platform-owner',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Create the requested teams.',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-614b',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [
        {
          id: 6301,
          created_at: '2026-05-22T12:00:00Z',
          body: '[bad.csv](https://github.com/octo-org/issueops-speckit/files/6301/bad.csv)',
          user: { login: 'requester' },
        },
        {
          id: 6302,
          created_at: '2026-05-22T12:05:00Z',
          body: '[corrected.csv](https://github.com/octo-org/issueops-speckit/files/6302/corrected.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('team_name\nCorrected Team Alpha\n').buffer,
    }),
  });

  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request.accepted_attachment_submission.comment_id, 6302);
  assert.equal(result.validation.request.requested_teams.length, 1);
  assert.equal(result.validation.request.requested_teams[0].normalized_slug, 'corrected-team-alpha');
  assert.equal(result.validation.attachment_validation_attempt.supersedes_attempt_id, 'octo-org/issueops-speckit#614/run-614a.1:6301');
  assert.match(formatAuditSummary(result.auditArtifact), /Attachment comment ID: 6302/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Create Organization Teams Workflow Summary/);
});

function createCsvAttachmentApprovedArtifact(overrides = {}) {
  return {
    request: {
      request_id: 'octo-org/issueops-speckit#700/run-700.1',
      issue_number: 700,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      intended_owner_login: 'platform-owner',
      intake_mode: 'csv_attachment',
      requested_team_names: '',
      requested_team_names_input: '',
      bulk_csv_input: 'team_name\nAlpha Squad\nBravo Team\n',
      bulk_csv_submission: {
        encoding: 'utf-8',
        header_columns: ['team_name'],
        required_columns: ['team_name'],
        unsupported_columns: [],
        row_count: 2,
        valid_row_count: 2,
        invalid_row_count: 0,
        duplicate_row_count: 0,
        schema_status: 'valid',
        schema_errors: [],
      },
      csv_row_findings: [
        { row_number: 1, team_name: 'Alpha Squad', normalized_slug: 'alpha-squad', validation_status: 'valid' },
        { row_number: 2, team_name: 'Bravo Team', normalized_slug: 'bravo-team', validation_status: 'valid' },
      ],
      csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
      requested_teams: [
        {
          requested_name: 'Alpha Squad',
          normalized_slug: 'alpha-squad',
          intended_owner_login: 'platform-owner',
          source_row_number: 1,
          source_comment_id: 7001,
          validation_status: 'valid',
          desired_action: 'create_team',
          execution_result: 'not_started',
          failure_reason: null,
        },
        {
          requested_name: 'Bravo Team',
          normalized_slug: 'bravo-team',
          intended_owner_login: 'platform-owner',
          source_row_number: 2,
          source_comment_id: 7001,
          validation_status: 'valid',
          desired_action: 'create_team',
          execution_result: 'not_started',
          failure_reason: null,
        },
      ],
      accepted_attachment_submission: {
        comment_id: 7001,
        comment_created_at: '2026-05-22T14:00:00Z',
        uploader_login: 'requester',
        attachment_url: 'https://github.com/octo-org/issueops-speckit/files/7001/teams.csv',
        filename: 'teams.csv',
        extension: '.csv',
        content_hash: 'abc123def456',
        acceptance_status: 'accepted',
        rejection_reason: null,
      },
      attachment_validation_attempt: {
        attempt_id: 'octo-org/issueops-speckit#700/run-700.1:7001',
        request_id: 'octo-org/issueops-speckit#700/run-700.1',
        candidate_comment_id: 7001,
        attempt_status: 'csv_valid',
        evaluated_at: '2026-05-22T14:01:00Z',
      },
      request_status: 'awaiting_approval',
      dry_run: false,
      business_justification: 'CSV attachment team creation.',
      ...overrides.request,
    },
    validation: {
      is_valid: true,
      errors: [],
      warnings: [],
      organization_visible: true,
      intended_owner_membership: { exists: true, state: 'active', role: 'member' },
      requested_teams: [
        {
          requested_name: 'Alpha Squad',
          normalized_slug: 'alpha-squad',
          intended_owner_login: 'platform-owner',
          source_row_number: 1,
          source_comment_id: 7001,
          validation_status: 'valid',
          desired_action: 'create_team',
        },
        {
          requested_name: 'Bravo Team',
          normalized_slug: 'bravo-team',
          intended_owner_login: 'platform-owner',
          source_row_number: 2,
          source_comment_id: 7001,
          validation_status: 'valid',
          desired_action: 'create_team',
        },
      ],
      existing_teams: [],
      ...overrides.validation,
    },
    approval: {
      approval_status: 'approved',
      approver_login: 'platform-owner',
      approver_role: 'intended_owner',
      approver_membership_state: 'active',
      decision_source: 'comment',
      ...overrides.approval,
    },
    reconciliation: {
      organization_exists: true,
      intake_mode: 'csv_attachment',
      teams_to_create: [],
      teams_already_present: [],
      teams_rejected: [],
      dry_run: false,
      state: 'approved_for_execution',
      ...overrides.reconciliation,
    },
    execution: {
      summary: 'Request is approved and eligible for execution. No team creation was attempted in this phase.',
      ...overrides.execution,
    },
    metadata: {
      operation: 'team_creation',
      run_id: 'run-700',
      run_attempt: '1',
      ...overrides.metadata,
    },
  };
}

function writeArtifact(artifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-csv-exec-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('approved csv_attachment team creation executes only missing teams and preserves source_comment_id provenance', async () => {
  const artifact = createCsvAttachmentApprovedArtifact();
  const artifactPath = writeArtifact(artifact);
  const summaryPath = path.join(path.dirname(artifactPath), 'summary.md');
  const calls = [];

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-700',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [
        { id: 10, name: 'Alpha Squad', slug: 'alpha-squad' },
      ],
      createTeam: async ({ name }) => {
        calls.push(name);
        return { id: 20, name, slug: 'bravo-team' };
      },
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.created_count, 1);
  assert.equal(result.execution.noop_count, 1);
  assert.deepEqual(calls, ['Bravo Team']);
  assert.deepEqual(
    persisted.execution.noop_teams.map((e) => e.source_comment_id),
    [7001]
  );
  assert.deepEqual(
    persisted.execution.created_teams.map((e) => e.source_comment_id),
    [7001]
  );
  assert.match(summary, /Intake mode: csv_attachment/i);
  assert.match(summary, /Teams created: 1/i);
  assert.match(summary, /No-op: 1/i);
  assert.match(summary, /Attachment comment ID: 7001/i);
  assert.match(summary, /Attachment content hash: abc123def456/i);
});

test('dry-run csv_attachment team creation skips mutation and preserves attachment provenance in summary', async () => {
  const artifact = createCsvAttachmentApprovedArtifact({
    request: { dry_run: true },
  });
  const artifactPath = writeArtifact(artifact);
  const summaryPath = path.join(path.dirname(artifactPath), 'summary.md');

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-701',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [],
      createTeam: async () => {
        throw new Error('mutation should not run in dry-run mode');
      },
    }),
  });

  assert.match(result.execution.summary, /dry-run only/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Attachment comment ID: 7001/i);
});

test('partial failure for csv_attachment team creation records per-team results and compensating guidance', async () => {
  const artifact = createCsvAttachmentApprovedArtifact();
  const artifactPath = writeArtifact(artifact);
  let firstCall = true;

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: 'run-702',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [],
      createTeam: async ({ name }) => {
        if (firstCall) {
          firstCall = false;
          return { id: 30, name, slug: 'alpha-squad' };
        }
        const error = new Error('Failed to create team');
        error.status = 422;
        error.payload = { message: 'Validation failed' };
        error.headers = {};
        throw error;
      },
    }),
    sleep: async () => { throw new Error('sleep should not be called'); },
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.request.request_status, 'partially_executed');
  assert.equal(persisted.execution.created_count, 1);
  assert.equal(persisted.execution.failure_count, 1);
  assert.equal(persisted.execution.rollback_status, 'compensating_action_required');
  assert.match(persisted.execution.remediation_instructions[0], /bravo-team/i);
  assert.deepEqual(persisted.execution.created_teams.map((e) => e.source_comment_id), [7001]);
  assert.deepEqual(persisted.execution.failed_teams.map((e) => e.source_comment_id), [7001]);
});

test('rerun of csv_attachment team creation with all teams present produces no-op outcome', async () => {
  const artifact = createCsvAttachmentApprovedArtifact();
  const artifactPath = writeArtifact(artifact);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: 'run-703',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [
        { id: 10, name: 'Alpha Squad', slug: 'alpha-squad' },
        { id: 20, name: 'Bravo Team', slug: 'bravo-team' },
      ],
      createTeam: async () => { throw new Error('mutation should not run for satisfied teams'); },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.created_count, 0);
  assert.equal(result.execution.noop_count, 2);
});

test('approval gate ignores post-terminal-state attachment comments for executed csv_attachment team creation', async () => {
  const artifact = createCsvAttachmentApprovedArtifact({
    request: { request_status: 'executed' },
  });
  const artifactPath = writeArtifact(artifact);
  const outputPath = path.join(path.dirname(artifactPath), 'output.txt');

  const result = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_OUTPUT: outputPath,
    },
    api: {
      listIssueComments: async () => [
        {
          id: 8001,
          created_at: '2026-05-22T16:00:00Z',
          body: '[new-teams.csv](https://github.com/octo-org/issueops-speckit/files/8001/new-teams.csv)',
          user: { login: 'requester' },
        },
      ],
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      addIssueAssignees: async () => ({ status: 'assigned' }),
      getAssignableOwners: async () => ['platform-owner'],
    },
  });

  assert.match(fs.readFileSync(outputPath, 'utf8'), /approval-status=not_requested/);
});

test('runRequestValidation ignores post-terminal-state attachment comments for executed csv_attachment team creation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-attachment-terminal-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  const priorArtifact = createCsvAttachmentApprovedArtifact({
    request: { request_status: 'executed' },
    execution: {
      created_count: 2,
      noop_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
      summary: 'Processed 2 team(ies).',
    },
  });
  fs.writeFileSync(auditPath, JSON.stringify(priorArtifact, null, 2));

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '700',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'platform-owner',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Create teams.',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-700b',
      GITHUB_RUN_ATTEMPT: '1',
      COMMENT_ID: '8001',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: '[new-teams.csv](https://github.com/octo-org/issueops-speckit/files/8001/new-teams.csv)',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [
        {
          id: 8001,
          created_at: '2026-05-22T18:00:00Z',
          body: '[new-teams.csv](https://github.com/octo-org/issueops-speckit/files/8001/new-teams.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('team_name\nNewTeam\n').buffer,
    }),
  });

  const summary = fs.readFileSync(summaryPath, 'utf8');
  assert.match(summary, /terminal.*state/i);
  assert.notEqual(result.validation.request_status, 'awaiting_approval');
});

test('full lifecycle: submit csv_attachment request, attach CSV, approve, and execute with mixed outcomes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-lifecycle-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const csvContent = 'team_name\nAlpha Squad\nBeta Squad\nGamma Squad\n';

  // Step 1: Initial submission — waiting for attachment
  const step1 = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '900',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_INTENDED_OWNER: 'himanshu-im',
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_REQUESTED_TEAM_NAMES: '',
      PARSED_BUSINESS_JUSTIFICATION: 'E2E validation',
      PARSED_DRY_RUN: 'false',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [],
    },
    setProcessExitCode: false,
  });

  assert.equal(step1.validation.request_status, 'waiting_for_attachment');

  // Step 2: Requester posts CSV attachment comment
  const step2 = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '900',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_INTENDED_OWNER: 'himanshu-im',
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_REQUESTED_TEAM_NAMES: '',
      PARSED_BUSINESS_JUSTIFICATION: 'E2E validation',
      PARSED_DRY_RUN: 'false',
      COMMENT_ID: '9100',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: '[teams.csv](https://github.com/user-attachments/files/9100/teams.csv)',
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [
        { id: 99, name: 'Gamma Squad', slug: 'gamma-squad' },
      ],
      listIssueComments: async () => [
        {
          id: 9100,
          created_at: '2026-05-22T12:00:00Z',
          body: '[teams.csv](https://github.com/user-attachments/files/9100/teams.csv)',
          user: { login: 'requester' },
        },
      ],
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(csvContent).buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(step2.validation.request_status, 'awaiting_approval');
  assert.equal(step2.validation.csv_row_findings.length, 3);
  assert.equal(step2.validation.existing_teams.length, 1);
  assert.equal(step2.validation.requested_teams.filter((t) => t.desired_action === 'create_team').length, 2);

  // Step 3: Approval gate
  const step3 = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      listIssueComments: async () => [
        {
          id: 9100,
          created_at: '2026-05-22T12:00:00Z',
          body: '[teams.csv](https://github.com/user-attachments/files/9100/teams.csv)',
          user: { login: 'requester' },
        },
        {
          id: 9101,
          created_at: '2026-05-22T12:05:00Z',
          body: 'approved',
          user: { login: 'himanshu-im' },
        },
      ],
      addIssueAssignees: async () => ({ status: 'assigned', assignees: ['central-owner'] }),
      getAssignableOwners: async () => ['central-owner'],
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    },
  });

  assert.equal(step3.approval.approval_status, 'approved');

  // Step 4: Execute — two created, one already present
  const step4 = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-900',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [
        { id: 99, name: 'Gamma Squad', slug: 'gamma-squad' },
      ],
      createTeam: async ({ name }) => ({
        id: Math.random() * 1000 | 0,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      }),
      addIssueLabels: async () => {},
    }),
  });

  assert.equal(step4.request.request_status, 'executed');
  assert.equal(step4.execution.created_count, 2);
  assert.equal(step4.execution.noop_count, 1);

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const finalSummary = formatAuditSummary(persisted);
  assert.match(finalSummary, /Intake mode: csv_attachment/i);
  assert.match(finalSummary, /Teams created: 2/i);
  assert.match(finalSummary, /No-op: 1/i);
  assert.match(finalSummary, /Attachment comment ID: 9100/i);
  assert.match(finalSummary, /Request status: executed/i);
});