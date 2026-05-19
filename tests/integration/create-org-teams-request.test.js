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
  assert.equal(result.validation.existing_teams.length, 1);
  assert.equal(result.auditArtifact.request.intended_owner_login, 'octocat');
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
  assert.match(result.validation.errors.join('\n'), /intended owner is not an active member/i);
});