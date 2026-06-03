'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadJsonFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function writeArtifact(baseArtifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-bulk-csv-execution-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(baseArtifact, null, 2));
  return artifactPath;
}

test('workflow applicability keeps empty-intake create-org-teams requests in scope for validation', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-org-teams.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

  assert.ok(requestScopeBlock);
  assert.match(requestScopeBlock[0], /PARSED_INTENDED_OWNER/);
  assert.match(requestScopeBlock[0], /PARSED_REQUESTED_TEAM_NAMES/);
  assert.match(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_TEAM_NAMES/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$\{PARSED_ORGANIZATION:-\}" \] && \[ -n "\$\{PARSED_INTENDED_OWNER:-\}" \] && \{ \[ -n "\$\{PARSED_INTAKE_MODE:-\}" \] \|\| \[ -n "\$\{PARSED_REQUESTED_TEAM_NAMES:-\}" \] \|\| \[ -n "\$\{PARSED_BULK_CSV_REQUESTED_TEAM_NAMES:-\}" \]; \}; then/);
});

test('records an approval-ready create-org-teams request from bulk CSV intake', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-bulk-csv-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');
  const validationFixture = loadJsonFixture('team-creation-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '611',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_ID: 'run-611',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => [],
    },
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.request.intake_mode, 'bulk_csv');
  assert.deepEqual(
    result.validation.requested_teams.map((team) => ({
      normalized_slug: team.normalized_slug,
      source_row_number: team.source_row_number,
    })),
    [
      { normalized_slug: 'platform-engineering', source_row_number: 1 },
      { normalized_slug: 'release-managers', source_row_number: 2 },
    ]
  );
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: bulk_csv/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /CSV row findings: 2/i);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /validation-status=awaiting_approval/);
});

test('workflow applicability keeps empty-intake create-org-teams requests in validation scope', () => {
	const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-org-teams.yml');
	const workflow = fs.readFileSync(workflowPath, 'utf8');
	const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

	assert.ok(requestScopeBlock);
	assert.match(requestScopeBlock[0], /PARSED_INTENDED_OWNER:/);
  assert.match(requestScopeBlock[0], /PARSED_REQUESTED_TEAM_NAMES:/);
  assert.match(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_TEAM_NAMES:/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$\{PARSED_ORGANIZATION:-\}" \] && \[ -n "\$\{PARSED_INTENDED_OWNER:-\}" \] && \{ \[ -n "\$\{PARSED_INTAKE_MODE:-\}" \] \|\| \[ -n "\$\{PARSED_REQUESTED_TEAM_NAMES:-\}" \] \|\| \[ -n "\$\{PARSED_BULK_CSV_REQUESTED_TEAM_NAMES:-\}" \]; \}; then/);
});

test('workflow applicability keeps empty-intake create-org-teams requests in validation scope', () => {
	const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-org-teams.yml');
	const workflow = fs.readFileSync(workflowPath, 'utf8');
	const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

	assert.ok(requestScopeBlock);
	assert.match(requestScopeBlock[0], /PARSED_INTENDED_OWNER:/);
	assert.doesNotMatch(requestScopeBlock[0], /PARSED_REQUESTED_TEAM_NAMES:/);
	assert.doesNotMatch(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_TEAM_NAMES:/);
	assert.match(requestScopeBlock[0], /if \[ -n "\$\{PARSED_INTENDED_OWNER:-\}" \]; then/);
});

test('preserves intake-mode metadata for bulk CSV requests through validation and audit output', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-bulk-csv-audit-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-creation-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '612',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nPlatform Engineering\n\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-612',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => [],
    },
  });

  assert.equal(result.auditArtifact.request.intake_mode, 'bulk_csv');
  assert.equal(result.auditArtifact.request.bulk_csv_submission.duplicate_row_count, 1);
  assert.equal(result.auditArtifact.request.bulk_csv_submission.valid_row_count, 2);
  assert.equal(result.auditArtifact.execution.duplicate_row_count, 1);
  assert.equal(result.auditArtifact.execution.invalid_row_count, 0);
  assert.equal(result.auditArtifact.request.csv_row_numbering_convention, '1-based data-row numbers that exclude the header row');
  assert.deepEqual(
    result.auditArtifact.request.requested_teams.map((team) => team.source_row_number),
    [1, 4]
  );
});

test('approved bulk CSV requests preserve approval and execution metadata through the final artifact', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-bulk-csv-approved-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-creation-validation.json').visible_org;

  const validationResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '613',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nPlatform Engineering\n\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-613',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => [],
    },
  });

  const approvedArtifact = writeArtifact({
    ...validationResult.auditArtifact,
    approval: {
      approval_status: 'approved',
      approver_login: 'octocat',
      approver_role: 'intended_owner',
      approver_membership_state: 'active',
      approved_at: '2026-05-19T12:00:00Z',
      decision_source: 'comment',
      decision_note: 'The approval comment approved was added by the active intended owner for this request batch.',
    },
  });

  await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: approvedArtifact,
      GITHUB_RUN_ID: 'run-613',
      GITHUB_RUN_ATTEMPT: '2',
    },
    tokenInfo: { token: 'pat-token', source: 'ISSUEOPS_GITHUB_TOKEN', is_pat_backed: true, token_kind: 'pat' },
    createApi: () => ({
      listOrgTeams: async () => [{ id: 100, name: 'Platform Engineering', slug: 'platform-engineering' }],
      createTeam: async ({ name }) => ({ id: 200, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(approvedArtifact, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(persisted.request.intake_mode, 'bulk_csv');
  assert.equal(persisted.request.request_status, 'executed');
  assert.equal(persisted.execution.duplicate_row_count, 1);
  assert.equal(persisted.execution.invalid_row_count, 0);
  assert.deepEqual(
    persisted.reconciliation.teams_already_present.map((entry) => entry.source_row_number),
    [1]
  );
  assert.deepEqual(
    persisted.reconciliation.teams_to_create.map((entry) => entry.source_row_number),
    [4]
  );
  assert.deepEqual(
    persisted.execution.noop_teams.map((entry) => entry.source_row_number),
    [1]
  );
  assert.deepEqual(
    persisted.execution.created_teams.map((entry) => entry.source_row_number),
    [4]
  );
  assert.match(summary, /Intake mode: bulk_csv/i);
  assert.match(summary, /CSV duplicate rows: 1/i);
  assert.match(summary, /Teams created: 1/i);
  assert.match(summary, /No-op: 1/i);
});

test('approval gate preserves bulk CSV audit metadata before approved execution', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-bulk-csv-gate-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-creation-validation.json').visible_org;

  await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '614',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '```csv\nteam_name\nPlatform Engineering\nRelease Managers\n```',
        business_justification: 'Need empty teams',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-614',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => [],
    },
  });

  const gated = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: auditPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          body: 'approved',
          created_at: '2026-05-19T12:10:00Z',
          user: { login: 'octocat' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { state: 'active', role: 'member' },
      }),
    },
  });

  assert.equal(gated.request.intake_mode, 'bulk_csv');
  assert.equal(gated.request.request_status, 'approved');
  assert.equal(gated.approval.approval_status, 'approved');
  assert.equal(gated.request.bulk_csv_submission.valid_row_count, 2);
  assert.equal(gated.execution.duplicate_row_count, 0);
  assert.equal(gated.execution.invalid_row_count, 0);
  assert.deepEqual(
    gated.request.requested_teams.map((entry) => entry.source_row_number),
    [1, 2]
  );
});