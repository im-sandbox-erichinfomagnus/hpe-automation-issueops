'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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

test('runRequestValidation records an approval-ready add-team-repo-access request with grant and no-op preview', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');
  const validationFixture = loadJsonFixture('team-repo-access-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '801',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: ['service-catalog', 'developer-portal'],
        permission_level: 'write',
        business_justification: 'Need repository access',
        dry_run: true
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_ID: 'run-801',
      GITHUB_RUN_ATTEMPT: '1'
    },
    api: createRepoAccessApi(validationFixture),
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.auditArtifact.metadata.operation, 'team_repo_access');
  assert.deepEqual(
    result.auditArtifact.reconciliation.repositories_to_grant.map((entry) => entry.repository_full_name),
    ['octo-org/service-catalog']
  );
  assert.deepEqual(
    result.auditArtifact.reconciliation.repositories_already_satisfied.map((entry) => entry.repository_full_name),
    ['octo-org/developer-portal']
  );
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Add Team Repository Access Workflow Summary/);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /No-op repositories: 1/);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /validation-status=awaiting_approval/);
});

test('runRequestValidation fails when the target organization is not visible', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-missing-org-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-repo-access-validation.json').missing_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '802',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: ['service-catalog'],
        permission_level: 'write',
        business_justification: 'Need repository access',
        dry_run: true
      }),
      AUDIT_ARTIFACT_PATH: auditPath
    },
    api: createRepoAccessApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /target organization does not exist or is not visible/i);
});

test('runRequestValidation fails when the target team does not exist', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-missing-team-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-repo-access-validation.json').missing_team;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '803',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: ['service-catalog'],
        permission_level: 'write',
        business_justification: 'Need repository access',
        dry_run: true
      }),
      AUDIT_ARTIFACT_PATH: auditPath
    },
    api: createRepoAccessApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.match(result.validation.errors.join('\n'), /target team does not exist/i);
});

test('runRequestValidation rejects weaker existing permission conflicts and preserves dry-run preview', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-weaker-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-repo-access-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '804',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: ['legacy-portal'],
        permission_level: 'write',
        business_justification: 'Need repository access',
        dry_run: true
      }),
      AUDIT_ARTIFACT_PATH: auditPath
    },
    api: createRepoAccessApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.match(result.validation.errors.join('\n'), /permission upgrades are out of scope/i);
  assert.equal(result.auditArtifact.reconciliation.dry_run, true);
});