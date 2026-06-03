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

function writeArtifact(baseArtifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-bulk-csv-artifact-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(baseArtifact, null, 2));
  return artifactPath;
}

test('workflow applicability keeps empty-intake add-child-teams requests in scope for validation', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-child-teams.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

  assert.ok(requestScopeBlock);
  assert.match(requestScopeBlock[0], /PARSED_PARENT_TEAM/);
  assert.match(requestScopeBlock[0], /PARSED_DESIGNATED_HIERARCHY_APPROVER/);
  assert.match(requestScopeBlock[0], /PARSED_DESIGNATED_APPROVER/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_REQUESTED_CHILD_TEAMS/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_CHILD_TEAMS/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$parsed_parent_team" \] && \[ -n "\$parsed_designated_approver" \]; then/);
});

test('workflow scaffolding keeps add-child-teams runtime and lint assumptions in place', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-child-teams.yml');
  const lintWorkflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'lint-workflows.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const lintWorkflow = fs.readFileSync(lintWorkflowPath, 'utf8');

  assert.match(workflow, /uses:\s+actions\/setup-node@v6/);
  assert.match(workflow, /node-version:\s+24/);
  assert.match(lintWorkflow, /uses:\s+rhysd\/actionlint@v1/);
  assert.match(lintWorkflow, /\.github\/ISSUE_TEMPLATE\/\*\.yml/);
});

test('rejects legacy add-child-teams bulk CSV textarea intake with clear guidance', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-bulk-csv-valid-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const outputPath = path.join(workspace, 'github-output.txt');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '821',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_RUN_ID: 'run-821',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture),
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.request.intake_mode, 'bulk_csv');
  assert.match(result.validation.errors.join('\n'), /bulk CSV textarea intake is no longer supported/i);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Validation: failed/i);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /validation-status=validation_failed/);
});

test('workflow applicability keeps empty-intake add-child-teams requests in validation scope', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-child-teams.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const requestScopeBlock = workflow.match(/- name: Check request applicability[\s\S]*?echo "matches-request=\$matches_request" >> "\$GITHUB_OUTPUT"/);

  assert.ok(requestScopeBlock);
  assert.match(requestScopeBlock[0], /PARSED_PARENT_TEAM:/);
  assert.match(requestScopeBlock[0], /PARSED_DESIGNATED_HIERARCHY_APPROVER:/);
  assert.match(requestScopeBlock[0], /PARSED_DESIGNATED_APPROVER:/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_REQUESTED_CHILD_TEAMS:/);
  assert.doesNotMatch(requestScopeBlock[0], /PARSED_BULK_CSV_REQUESTED_CHILD_TEAMS:/);
  assert.match(requestScopeBlock[0], /if \[ -n "\$parsed_parent_team" \] && \[ -n "\$parsed_designated_approver" \]; then/);
});

test('preserves bulk CSV request metadata through validation and audit scaffolding', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-bulk-csv-audit-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '822',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\nApplication Platform\n\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-822',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(result.auditArtifact.request.intake_mode, 'bulk_csv');
  assert.equal(result.auditArtifact.request.bulk_csv_submission.duplicate_row_count, 1);
  assert.equal(result.auditArtifact.request.bulk_csv_submission.valid_row_count, 2);
  assert.equal(result.auditArtifact.execution.duplicate_row_count, 1);
  assert.equal(result.auditArtifact.execution.invalid_row_count, 0);
  assert.equal(result.auditArtifact.request.csv_row_numbering_convention, '1-based data-row numbers that exclude the header row');
  assert.deepEqual(
    result.auditArtifact.request.requested_child_links.map((childLink) => childLink.source_row_number),
    [1, 4]
  );
});

test('legacy bulk CSV textarea requests remain validation-failed and are not execution-ready', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-bulk-csv-approved-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const validationResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '823',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-823',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture),
    setProcessExitCode: false,
  });

  assert.equal(validationResult.auditArtifact.validation.is_valid, false);
  assert.equal(validationResult.auditArtifact.request.request_status, 'validation_failed');
  assert.equal(validationResult.auditArtifact.request.intake_mode, 'bulk_csv');
  assert.match(
    validationResult.auditArtifact.validation.errors.join('\n'),
    /bulk CSV textarea intake is no longer supported/i
  );
});

test('approval gate keeps legacy bulk CSV textarea requests in validation_failed state', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-bulk-csv-gate-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '824',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        requested_child_teams: '',
        bulk_csv_requested_child_teams: '```csv\nchild_team\nApplication Platform\nRelease Engineering\n```',
        business_justification: 'Need hierarchy updates',
        dry_run: false,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_RUN_ID: 'run-824',
      GITHUB_RUN_ATTEMPT: '1',
    },
    api: createHierarchyApi(validationFixture),
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
          created_at: '2026-05-20T12:10:00Z',
          user: { login: 'octocat' },
        },
      ],
      getMembershipForUser: async ({ teamSlug, username }) => {
        const teamMemberships = validationFixture.memberships || {};
        return teamMemberships[teamSlug] && teamMemberships[teamSlug][username]
          ? teamMemberships[teamSlug][username]
          : { membership: null };
      },
    },
  });

  assert.equal(gated.request.intake_mode, 'bulk_csv');
  assert.equal(gated.request.request_status, 'validation_failed');
  assert.equal(gated.approval.approval_status, 'not_requested');
  assert.equal(gated.execution.duplicate_row_count, 0);
  assert.equal(gated.execution.invalid_row_count, 0);
  assert.match(gated.validation.errors.join('\n'), /bulk CSV textarea intake is no longer supported/i);
});