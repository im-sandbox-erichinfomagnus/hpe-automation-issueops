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

function createHierarchyApi(validationFixture) {
  return {
    getOrganization: async () => validationFixture.organization,
    listOrgTeams: async () => validationFixture.teams || [],
    getMembershipForUser: async ({ teamSlug, username }) => {
      const teamMemberships = validationFixture.memberships || {};
      return teamMemberships[teamSlug] && teamMemberships[teamSlug][username]
        ? teamMemberships[teamSlug][username]
        : { membership: null };
    },
  };
}

test('runRequestValidation records an approval-ready add-child-teams request with no-op and link preview', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '601',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: ['Application Platform', 'Release Engineering'],
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_ID: 'run-601',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture),
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.auditArtifact.metadata.operation, 'team_hierarchy');
  assert.deepEqual(
    result.auditArtifact.reconciliation.child_links_to_apply.map((entry) => entry.child_team_slug),
    ['application-platform']
  );
  assert.deepEqual(
    result.auditArtifact.reconciliation.child_links_already_present.map((entry) => entry.child_team_slug),
    ['release-engineering']
  );
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Add Child Teams Workflow Summary/);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /validation-status=awaiting_approval/);
});

test('runRequestValidation fails when the target organization is not visible', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-missing-org-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').missing_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '602',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: ['Application Platform'],
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /target organization does not exist or is not visible/i);
});

test('runRequestValidation fails when a requested child team is missing', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-missing-child-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '603',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: ['Unknown Team'],
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.match(result.validation.errors.join('\n'), /child teams do not exist/i);
});

test('runRequestValidation fails duplicate child-team requests instead of silently deduplicating them', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-duplicates-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '604',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: ['Application Platform', 'Application Platform'],
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.match(result.validation.errors.join('\n'), /duplicate child teams/i);
});

test('runRequestValidation rejects re-parenting and cycle-creating requests', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-blocked-'));
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const reparentResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '605',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_child_teams: ['Security Engineering'],
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: path.join(workspace, 'reparent-audit.json'),
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(reparentResult.validation.is_valid, false);
  assert.match(reparentResult.validation.errors.join('\n'), /re-parenting is out of scope/i);

  const cycleResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '606',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Application Infrastructure',
        designated_approver: 'octocat',
        requested_child_teams: ['Application Platform'],
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: path.join(workspace, 'cycle-audit.json'),
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(cycleResult.validation.is_valid, false);
  assert.match(cycleResult.validation.errors.join('\n'), /team hierarchy cycle/i);
});