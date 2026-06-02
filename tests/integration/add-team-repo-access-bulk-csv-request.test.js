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

function loadJsonFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createRepoAccessApi(scenario) {
  return {
    getOrganization: async () => scenario.organization,
    getTeamBySlug: async () => scenario.team,
    getOrganizationMembership: async () => scenario.approver_membership,
    getRepository: async ({ owner, repo }) => {
      return scenario.repositories[`${owner}/${repo}`] || { exists: false, repository: null };
    },
    getTeamRepositoryPermission: async ({ owner, repo }) => {
      const repositoryEntry = scenario.repositories[`${owner}/${repo}`];
      return repositoryEntry ? repositoryEntry.permission : { exists: false, current_permission_api_value: 'none' };
    },
  };
}

function loadBulkCsvFixtureMarkdown() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-bulk-csv-issue.md');
  return fs.readFileSync(fixturePath, 'utf8');
}

test('workflow applicability keeps empty-intake add-team-repo-access requests in scope for validation', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-team-repo-access.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

  assert.ok(requestScopeBlock);
  assert.match(requestScopeBlock[0], /PARSED_TARGET_TEAM/);
  assert.match(requestScopeBlock[0], /PARSED_DESIGNATED_APPROVER/);
  assert.match(requestScopeBlock[0], /PARSED_PERMISSION_LEVEL/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_REQUESTED_REPOSITORIES/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_REPOSITORIES/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$\{PARSED_TARGET_TEAM:-\}" \] && \[ -n "\$\{PARSED_DESIGNATED_APPROVER:-\}" \] && \[ -n "\$\{PARSED_PERMISSION_LEVEL:-\}" \]; then/);
});

test('workflow scaffolding keeps add-team-repo-access runtime and lint assumptions in place', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-team-repo-access.yml');
  const lintWorkflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'lint-workflows.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const lintWorkflow = fs.readFileSync(lintWorkflowPath, 'utf8');

  assert.match(workflow, /on:\s+issues:\s+types:\s+- opened\s+- edited\s+- reopened\s+- labeled/m);
  assert.match(workflow, /issue_comment:\s+types:\s+- created\s+- edited\s+- deleted/m);
  assert.doesNotMatch(workflow, /issue_comment:\s+if \[/m);
  assert.match(workflow, /uses:\s+actions\/setup-node@v6/);
  assert.match(workflow, /node-version:\s+24/);
  assert.match(lintWorkflow, /uses:\s+rhysd\/actionlint@v1/);
  assert.match(lintWorkflow, /\.github\/ISSUE_TEMPLATE\/\*\.yml/);
});

test('bulk CSV fixture scaffold is available for later request-validation coverage', () => {
  const fixtureMarkdown = loadBulkCsvFixtureMarkdown();

  assert.match(fixtureMarkdown, /^### Bulk CSV requested repositories$/m);
  assert.match(fixtureMarkdown, /```csv[\s\S]*repository/);
  assert.match(fixtureMarkdown, /^### Requested permission level$/m);
  assert.match(fixtureMarkdown, /^write$/m);
});

test('runRequestValidation records an approval-ready add-team-repo-access request from bulk CSV intake', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-bulk-csv-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');
  const validationFixture = loadJsonFixture('team-repo-access-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '920',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\ndeveloper-portal\n```',
        permission_level: 'write',
        business_justification: 'Need repository access',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_ID: 'run-920',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createRepoAccessApi(validationFixture),
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.auditArtifact.request.intake_mode, 'bulk_csv');
  assert.equal(result.auditArtifact.request.requested_repositories_input, '');
  assert.equal(result.auditArtifact.request.bulk_csv_submission.schema_status, 'valid');
  assert.equal(result.auditArtifact.request.bulk_csv_submission.valid_row_count, 2);
  assert.deepEqual(
    result.auditArtifact.request.requested_repository_grants.map((grant) => ({
      repository_full_name: grant.repository_full_name,
      source_row_number: grant.source_row_number,
    })),
    [
      { repository_full_name: 'octo-org/service-catalog', source_row_number: 1 },
      { repository_full_name: 'octo-org/developer-portal', source_row_number: 2 },
    ]
  );
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: bulk_csv/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /CSV row findings: 2/i);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /validation-status=awaiting_approval/);
});

test('workflow applicability keeps empty-intake add-team-repo-access requests in validation scope', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-team-repo-access.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

  assert.ok(requestScopeBlock);
  assert.match(requestScopeBlock[0], /PARSED_TARGET_TEAM:/);
  assert.match(requestScopeBlock[0], /PARSED_DESIGNATED_APPROVER:/);
  assert.match(requestScopeBlock[0], /PARSED_PERMISSION_LEVEL:/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_REQUESTED_REPOSITORIES:/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_REPOSITORIES:/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$\{PARSED_TARGET_TEAM:-\}" \] && \[ -n "\$\{PARSED_DESIGNATED_APPROVER:-\}" \] && \[ -n "\$\{PARSED_PERMISSION_LEVEL:-\}" \]; then/);
});

test('approved bulk CSV requests preserve intake mode and source row provenance through the final artifact', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-bulk-csv-approved-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-repo-access-validation.json').visible_org;

  const validationResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '921',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        bulk_csv_requested_repositories: '```csv\nrepository\nservice-catalog\ndeveloper-portal\n```',
        permission_level: 'write',
        business_justification: 'Need repository access',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-921',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createRepoAccessApi(validationFixture),
    setProcessExitCode: false,
  });

  const approvalResult = await runApprovalGate({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-921',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      listIssueComments: async () => ([
        {
          body: 'approved',
          created_at: '2026-05-20T12:00:00Z',
          user: { login: 'octocat' },
        },
      ]),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      addIssueAssignees: async () => ({ status: 'assigned', assignees: ['central-owner'] }),
      getAssignableOwners: async () => ['central-owner'],
    },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-921',
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
      getOrganization: async () => validationFixture.organization,
      getTeamBySlug: async () => validationFixture.team,
      getOrganizationMembership: async () => validationFixture.approver_membership,
      getRepository: async ({ owner, repo }) => validationFixture.repositories[`${owner}/${repo}`],
      getTeamRepositoryPermission: async ({ owner, repo }) => {
        const repositoryEntry = validationFixture.repositories[`${owner}/${repo}`];
        return repositoryEntry ? repositoryEntry.permission : { exists: false, current_permission_api_value: 'none' };
      },
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(validationResult.auditArtifact.request.intake_mode, 'bulk_csv');
  assert.equal(approvalResult.request.intake_mode, 'bulk_csv');
  assert.equal(result.request.intake_mode, 'bulk_csv');
  assert.equal(result.reconciliation.intake_mode, 'bulk_csv');
  assert.deepEqual(
    result.reconciliation.repositories_to_grant.map((entry) => entry.source_row_number),
    [1]
  );
  assert.deepEqual(
    result.reconciliation.repositories_already_satisfied.map((entry) => entry.source_row_number),
    [2]
  );
  assert.deepEqual(
    persisted.execution.created_teams.map((entry) => entry.source_row_number),
    [1]
  );
  assert.deepEqual(
    persisted.execution.noop_teams.map((entry) => entry.source_row_number),
    [2]
  );
  assert.match(summary, /Intake mode: bulk_csv/i);
  assert.match(summary, /CSV row findings: 2/i);
});
