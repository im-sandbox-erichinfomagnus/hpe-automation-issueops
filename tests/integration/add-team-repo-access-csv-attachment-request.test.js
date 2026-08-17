'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');

const { runRequestValidation } = require('../../src/scripts/run-request-validation');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');

function loadAttachmentIssueFixture() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-csv-attachment-issue.md'),
    'utf8'
  );
}

function loadAttachmentCommentsFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-csv-attachment-comments.json'),
      'utf8'
    )
  );
}

function loadValidationScenario() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'github-api', 'team-repo-access-validation.json'),
      'utf8'
    )
  ).visible_org;
}

function loadApprovedExecutionFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'github-api', 'team-repo-access-update-success.json'),
      'utf8'
    )
  ).approved_artifact;
}

function createRepoAccessApi(scenario, comments = []) {
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
    listIssueComments: async () => comments,
  };
}

function createFetchResponse(text) {
  const payload = Buffer.from(text, 'utf8');
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (String(name || '').toLowerCase() === 'content-length') {
          return String(payload.byteLength);
        }

        return null;
      },
    },
    arrayBuffer: async () => payload,
  };
}

test('integration scaffold keeps csv_attachment issue fixture aligned with expected request metadata', () => {
  const markdown = loadAttachmentIssueFixture();

  assert.match(markdown, /### Target organization\s+octo-org/i);
  assert.match(markdown, /### Target team\s+Platform Engineering/i);
  assert.match(markdown, /### Designated repository-access approver\s+octocat/i);
  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Dry-run mode\s+true/i);
});

test('integration scaffold preserves requester correction event ordering for attachment comments', () => {
  const comments = loadAttachmentCommentsFixture();

  assert.equal(comments[0].user.login, 'other-user');
  assert.match(comments.find((comment) => comment.id === 9102).body, /repo-access\.txt/i);
  assert.match(comments.find((comment) => comment.id === 9105).body, /repo-access-corrected\.csv/i);
  assert.equal(comments.at(-1).body, 'approved');
});

test('workflow assumptions keep add-team-repo-access issue and issue_comment trigger wiring in place', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-team-repo-access.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /issues:\s*[\s\S]*- opened/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- created/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- edited/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- deleted/);
  assert.match(workflow, /name:\s+Check request applicability/);
  assert.match(workflow, /issue_labels_json=\$\(jq -c '\.issue\.labels \/\/ \[\]' "\$GITHUB_EVENT_PATH"\)/);
  assert.match(workflow, /issue_labels_json=\$\(printf '%s' "\$issue_json" \| jq -c '\.labels \/\/ \[\]'\)/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/);
});

test('lint and dependency workflow assumptions cover mainline updates', () => {
  const lintWorkflow = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'lint-workflows.yml'),
    'utf8'
  );
  const dependabot = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'dependabot.yml'),
    'utf8'
  );

  assert.match(lintWorkflow, /push:\s*[\s\S]*013-setup-feature-branch/);
  assert.match(lintWorkflow, /pull_request:/);
  assert.match(dependabot, /package-ecosystem:\s*github-actions[\s\S]*interval:\s*weekly/);
  assert.match(dependabot, /package-ecosystem:\s*npm[\s\S]*interval:\s*weekly/);
  assert.doesNotMatch(dependabot, /target-branch:/);
});

test('validate end-to-end waiting_for_attachment progression for csv_attachment intake', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-csv-waiting-int-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const scenario = loadValidationScenario();

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '940',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        permission_level: 'write',
        business_justification: 'Attachment-driven request',
        dry_run: true,
        intake_mode: 'csv_attachment',
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      COMMENT_ID: '9101',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: 'trigger',
    },
    api: createRepoAccessApi(scenario, []),
    fetchImpl: async () => createFetchResponse('repository\nservice-catalog\n'),
  });

  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(result.validation.is_valid, false);
  assert.equal(result.auditArtifact.request.request_status, 'waiting_for_attachment');
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Request is waiting for a requester-authored CSV attachment comment/i);
});

test('validate failed then corrected attachment progression to awaiting_approval', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-csv-corrected-int-'));
  const auditPath = path.join(workspace, 'audit.json');
  const scenario = loadValidationScenario();
  const comments = loadAttachmentCommentsFixture();

  const firstResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '941',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        permission_level: 'write',
        business_justification: 'Attachment-driven request',
        dry_run: true,
        intake_mode: 'csv_attachment',
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      COMMENT_ID: '9103',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: comments.find((comment) => comment.id === 9104).body,
    },
    api: createRepoAccessApi(scenario, comments.filter((comment) => comment.id <= 9104)),
    fetchImpl: async (url) => {
      assert.match(url, /repo-access\.csv/i);
      return createFetchResponse('repository,permission\nservice-catalog,write\n');
    },
  });

  assert.equal(firstResult.validation.request_status, 'validation_failed');
  assert.equal(firstResult.validation.attachment_validation_attempt.attempt_status, 'csv_invalid');
  assert.equal(firstResult.validation.accepted_attachment_submission.comment_id, 9104);

  const secondResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '941',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        target_team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        permission_level: 'write',
        business_justification: 'Attachment-driven request',
        dry_run: true,
        intake_mode: 'csv_attachment',
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      COMMENT_ID: '9105',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: comments.find((comment) => comment.id === 9105).body,
    },
    api: createRepoAccessApi(scenario, comments),
    fetchImpl: async (url) => {
      assert.match(url, /repo-access-corrected\.csv/i);
      return createFetchResponse('repository\nservice-catalog\ndeveloper-portal\n');
    },
  });

  assert.equal(secondResult.validation.request_status, 'awaiting_approval');
  assert.equal(secondResult.validation.is_valid, true);
  assert.equal(secondResult.validation.accepted_attachment_submission.comment_id, 9105);
  assert.equal(secondResult.validation.attachment_validation_attempt.attempt_status, 'csv_valid');
  assert.equal(secondResult.validation.accepted_attachment_submission.comment_created_at, '2026-05-25T10:07:00Z');
  assert.equal(secondResult.validation.requested_repository_grants.length, 2);
});

test('approved csv_attachment execution preserves attachment metadata and applies mixed grant/no-op reconciliation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-csv-approved-exec-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const artifact = loadApprovedExecutionFixture();
  artifact.request.intake_mode = 'csv_attachment';
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
    },
  ];
  artifact.validation.requested_repository_grants = structuredClone(artifact.request.requested_repository_grants);
  artifact.validation.already_satisfied_repository_grants = [artifact.validation.requested_repository_grants[1]];
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

  const grantedCalls = [];
  const labels = [];
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_RUN_ID: '942',
      GITHUB_RUN_ATTEMPT: '1',
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
        grantedCalls.push(`${owner}/${repo}:${permission}`);
        return { repository_full_name: `${owner}/${repo}`, permission };
      },
      addIssueLabels: async ({ labels: applied }) => {
        labels.push(...applied);
      },
    }),
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.granted_count, 1);
  assert.equal(result.execution.noop_count, 1);
  assert.deepEqual(grantedCalls, ['octo-org/service-catalog:maintain']);
  assert.match(result.execution.summary, /repository-access execution completed/i);
  assert.equal(result.reconciliation.accepted_attachment_submission.comment_id, 4533445282);
  assert.deepEqual(labels, ['issueops:add-team-repo-access:executed']);
});
