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

test('approved csv_attachment dry-run keeps execution blocked without mutating repository access', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'csv_attachment';
  artifact.request.dry_run = true;
  artifact.request.request_status = 'approved';
  artifact.request.requested_repository_grants = [
    {
      requested_repository_name: 'service-catalog',
      repository_owner: 'octo-org',
      repository_name: 'service-catalog',
      repository_full_name: 'octo-org/service-catalog',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
      source_row_number: 1,
      source_comment_id: 4533445282,
    },
  ];
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = [];
  artifact.reconciliation.repositories_to_grant = structuredClone(artifact.request.requested_repository_grants);
  artifact.reconciliation.repositories_already_satisfied = [];
  const artifactPath = writeArtifact(artifact);

  let mutationAttempted = false;
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
        mutationAttempted = true;
        throw new Error('mutation should not run in dry-run mode');
      },
    }),
  });

  assert.equal(mutationAttempted, false);
  assert.equal(result.request.request_status, 'approved');
  assert.match(result.execution.summary, /dry-run only/i);
  assert.match(result.execution.summary, /No repository-access mutation was attempted/i);
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

test('csv-derived approved execution preserves source row numbers across rerun no-op and rejected outcomes', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'bulk_csv';
  artifact.request.bulk_csv_input = '```csv\nrepository\nservice-catalog\ndeveloper-portal\nlegacy-portal\n```';
  artifact.request.bulk_csv_submission = {
    encoding: 'utf-8',
    header_columns: ['repository'],
    required_columns: ['repository'],
    unsupported_columns: [],
    row_count: 3,
    valid_row_count: 3,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'valid',
    schema_errors: [],
    raw_input: '```csv\nrepository\nservice-catalog\ndeveloper-portal\nlegacy-portal\n```',
    csv_row_findings: [
      { row_number: 1, validation_status: 'valid', repository_value: 'service-catalog', normalized_repository_full_name: 'octo-org/service-catalog' },
      { row_number: 2, validation_status: 'valid', repository_value: 'developer-portal', normalized_repository_full_name: 'octo-org/developer-portal' },
      { row_number: 3, validation_status: 'valid', repository_value: 'legacy-portal', normalized_repository_full_name: 'octo-org/legacy-portal' },
    ],
    csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
  };
  artifact.request.csv_row_findings = structuredClone(artifact.request.bulk_csv_submission.csv_row_findings);
  artifact.request.csv_row_numbering_convention = artifact.request.bulk_csv_submission.csv_row_numbering_convention;
  artifact.request.requested_repository_grants = [
    {
      requested_repository_name: 'service-catalog',
      repository_owner: 'octo-org',
      repository_name: 'service-catalog',
      repository_full_name: 'octo-org/service-catalog',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
      source_row_number: 1,
    },
    {
      requested_repository_name: 'developer-portal',
      repository_owner: 'octo-org',
      repository_name: 'developer-portal',
      repository_full_name: 'octo-org/developer-portal',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
      source_row_number: 2,
    },
    {
      requested_repository_name: 'legacy-portal',
      repository_owner: 'octo-org',
      repository_name: 'legacy-portal',
      repository_full_name: 'octo-org/legacy-portal',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
      source_row_number: 3,
    }
  ];
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = [];
  artifact.reconciliation.repositories_to_grant = structuredClone(artifact.request.requested_repository_grants);
  artifact.reconciliation.repositories_already_satisfied = [];
  artifact.reconciliation.intake_mode = 'bulk_csv';
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
        repository: { id: `${owner}/${repo}`, name: repo, full_name: `${owner}/${repo}`, owner, archived: false, private: true },
      }),
      getTeamRepositoryPermission: async ({ repo }) =>
        repo === 'service-catalog'
          ? { exists: true, current_permission_api_value: 'maintain' }
          : repo === 'developer-portal'
            ? { exists: false, current_permission_api_value: 'none' }
            : { exists: true, current_permission_api_value: 'pull' },
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.request.intake_mode, 'bulk_csv');
  assert.equal(result.reconciliation.intake_mode, 'bulk_csv');
  assert.equal(result.execution.intake_mode, 'bulk_csv');
  assert.equal(result.execution.rejected_count, 1);
  assert.match(result.execution.summary, /1 rejected repository\(ies\)/i);
  assert.deepEqual(
    persisted.execution.noop_teams.map((entry) => entry.source_row_number),
    [1]
  );
  assert.deepEqual(
    persisted.execution.created_teams.map((entry) => entry.source_row_number),
    [2]
  );
  assert.deepEqual(
    persisted.execution.rejected_subset.map((entry) => entry.source_row_number),
    [3]
  );
});

test('approved csv_attachment execution keeps attachment provenance while applying grant/no-op reconciliation', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const artifact = structuredClone(fixture.approved_artifact);
  artifact.request.intake_mode = 'csv_attachment';
  artifact.request.request_status = 'approved';
  artifact.request.accepted_attachment_submission = {
    comment_id: 4533445282,
    comment_created_at: '2026-05-25T11:00:00Z',
    uploader_login: 'himanshu-im',
    attachment_url: 'https://github.com/user-attachments/files/28216659/team-repo-access.csv',
    filename: 'team-repo-access.csv',
    extension: '.csv',
    content_hash: '5fb55ba1ac5f729241d0bc9828ba5100fa0be75ededc153566df9a13ec7ca172',
    acceptance_status: 'accepted',
  };
  artifact.request.requested_repository_grants = [
    {
      requested_repository_name: 'service-catalog',
      repository_owner: 'octo-org',
      repository_name: 'service-catalog',
      repository_full_name: 'octo-org/service-catalog',
      desired_action: 'grant_access',
      validation_status: 'valid',
      current_permission_api_value: 'none',
      source_row_number: 1,
      source_comment_id: 4533445282,
    },
    {
      requested_repository_name: 'developer-portal',
      repository_owner: 'octo-org',
      repository_name: 'developer-portal',
      repository_full_name: 'octo-org/developer-portal',
      desired_action: 'noop',
      validation_status: 'stronger_existing_access',
      current_permission_api_value: 'admin',
      source_row_number: 2,
      source_comment_id: 4533445282,
    }
  ];
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = [artifact.validation.requested_repository_grants[1]];
  artifact.reconciliation.repositories_to_grant = [artifact.request.requested_repository_grants[0]];
  artifact.reconciliation.repositories_already_satisfied = [artifact.request.requested_repository_grants[1]];
  artifact.reconciliation.intake_mode = 'csv_attachment';
  const artifactPath = writeArtifact(artifact);

  const labels = [];
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
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
      addIssueLabels: async ({ labels: applied }) => {
        labels.push(...applied);
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.granted_count, 1);
  assert.equal(result.execution.noop_count, 1);
  assert.equal(result.reconciliation.accepted_attachment_submission.comment_id, 4533445282);
  assert.deepEqual(labels, ['issueops:add-team-repo-access:executed']);
});

test('post-terminal csv_attachment comments do not reopen lifecycle after executed status', async () => {
  const fixture = loadFixture('team-repo-access-update-success.json');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-terminal-ignore-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const priorArtifact = structuredClone(fixture.approved_artifact);
  priorArtifact.request.intake_mode = 'csv_attachment';
  priorArtifact.request.request_status = 'executed';
  priorArtifact.request.accepted_attachment_submission = {
    comment_id: 4533445282,
    comment_created_at: '2026-05-25T11:00:00Z',
    uploader_login: 'himanshu-im',
    attachment_url: 'https://github.com/user-attachments/files/28216659/team-repo-access.csv',
    filename: 'team-repo-access.csv',
    extension: '.csv',
    content_hash: '5fb55ba1ac5f729241d0bc9828ba5100fa0be75ededc153566df9a13ec7ca172',
    acceptance_status: 'accepted',
  };
  fs.writeFileSync(artifactPath, JSON.stringify(priorArtifact, null, 2));

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '999',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        permission_level: 'maintain',
        business_justification: 'post terminal comment should be ignored',
        dry_run: false,
        intake_mode: 'csv_attachment',
      }),
      AUDIT_ARTIFACT_PATH: artifactPath,
      COMMENT_ID: '6000',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: 'new csv attachment comment after execution',
      ISSUE_LABELS_JSON: JSON.stringify([{ name: 'issueops:add-team-repo-access:executed' }]),
    },
    api: {
      listIssueComments: async () => {
        throw new Error('issue comments should not be fetched for terminal-state ignore path');
      },
    },
  });

  assert.equal(result.validation.request_status, 'executed');
  assert.equal(result.auditArtifact.request.request_status, 'executed');
  assert.match(result.validation.warnings.join('\n'), /ignored after the request reaches a terminal execution state/i);
});