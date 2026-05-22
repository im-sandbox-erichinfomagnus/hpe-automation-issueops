'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { reconcileTeamCreation } = require('../../src/workflow-support/reconcile-team-creation');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadJsonFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('runRequestValidation records an approval-ready create-org-teams request with existing-team detection', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');
  const validationFixture = loadJsonFixture('team-creation-validation.json').visible_org;
  const currentTeams = loadJsonFixture('current-org-teams.json').existing_team;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '401',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: ['Platform Engineering', 'Release Managers'],
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_ID: 'run-401',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => currentTeams,
    },
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.request.intake_mode, 'manual');
  assert.equal(result.validation.request.bulk_csv_submission, null);
  assert.deepEqual(result.validation.request.csv_row_findings, []);
  assert.equal(result.validation.request.csv_row_numbering_convention, null);
  assert.deepEqual(result.validation.request.requested_team_names_input, ['Platform Engineering', 'Release Managers']);
  assert.equal(result.validation.existing_teams.length, 1);
  assert.equal(result.auditArtifact.request.intake_mode, 'manual');
  assert.equal(result.auditArtifact.request.bulk_csv_submission, null);
  assert.deepEqual(result.auditArtifact.request.csv_row_findings, []);
  assert.equal(result.auditArtifact.request.csv_row_numbering_convention, null);
  assert.equal(result.auditArtifact.request.intended_owner_login, 'octocat');
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Intake mode: manual/i);
  assert.doesNotMatch(fs.readFileSync(summaryPath, 'utf8'), /CSV row/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Create Organization Teams Workflow Summary/);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /validation-status=awaiting_approval/);

  const reconciliation = reconcileTeamCreation({
    request: result.validation.request,
    requested_teams: result.validation.requested_teams,
    current_teams: currentTeams,
  });

  assert.equal(reconciliation.teams_already_present.length, 1);
  assert.equal(reconciliation.teams_to_create.length, 1);
});

test('runRequestValidation fails when the intended owner is not active in the target organization', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-invalid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-creation-validation.json').inactive_owner;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '402',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: ['Platform Engineering'],
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => [],
    },
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.request.intake_mode, 'manual');
  assert.equal(result.validation.request.bulk_csv_input, '');
  assert.match(result.validation.errors.join('\n'), /intended owner is not an active member/i);
});

test('runRequestValidation rejects ambiguous create-org-teams requests when neither manual nor CSV intake is populated', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-ambiguous-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const validationFixture = loadJsonFixture('team-creation-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '403',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        requested_team_names: '',
        bulk_csv_requested_team_names: '',
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-403',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => validationFixture.organization,
      getOrganizationMembership: async ({ username }) => validationFixture.memberships[username] || { exists: false },
      listOrgTeams: async () => [],
    },
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.request.intake_mode, null);
  assert.match(result.validation.errors.join('\n'), /Exactly one intake source must be populated/i);
  assert.match(result.validation.errors.join('\n'), /At least one valid requested team name is required/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Validation errors: .*Exactly one intake source must be populated/i);
});

test('runRequestValidation produces Create Organization Teams summary header for waiting-for-attachment requests', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-waiting-header-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '405',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-405',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [],
    },
  });

  const summary = fs.readFileSync(summaryPath, 'utf8');
  assert.match(summary, /Create Organization Teams Workflow Summary/);
  assert.doesNotMatch(summary, /Add Team Members Workflow Summary/);
  assert.match(summary, /Attachment status: waiting for requester CSV attachment comment/i);
  assert.match(summary, /Intake mode: csv_attachment/i);
  assert.match(summary, /execution remains blocked until the requester posts a qualifying CSV attachment comment/i);
});

test('runRequestValidation keeps empty-manual-input attachment requests in scope and waiting for a requester CSV attachment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-org-teams-attachment-scope-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '404',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        intended_owner: 'octocat',
        intake_mode: 'csv_attachment',
        requested_team_names: '',
        business_justification: 'Need empty teams',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_RUN_ID: 'run-404',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [],
    },
  });

  assert.equal(result.validation.request.intake_mode, 'csv_attachment');
  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(result.validation.is_valid, false);
  assert.deepEqual(result.validation.errors, []);
  assert.match(result.validation.warnings.join('\n'), /waiting for a requester-authored CSV attachment comment/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Attachment status: waiting for requester CSV attachment comment/i);
});