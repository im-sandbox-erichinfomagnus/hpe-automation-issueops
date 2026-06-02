'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runRequestValidation } = require('../../src/scripts/run-request-validation');

function loadAttachmentIssueFixture() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'remove-team-repo-access-csv-issue.md'),
    'utf8'
  );
}

function loadAttachmentCommentsFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'remove-team-repo-access-csv-attachment-comments.json'),
      'utf8'
    )
  );
}

function createRemovalApi(comments = []) {
  return {
    getOrganization: async () => ({ exists: true, organization: { login: 'octo-org' } }),
    getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'platform-engineering' } }),
    getOrganizationMembership: async ({ username }) => ({
      exists: username === 'octocat',
      membership: username === 'octocat' ? { role: 'admin', state: 'active' } : null,
    }),
    getRepository: async ({ owner, repo }) => ({
      exists: true,
      repository: {
        id: `${owner}/${repo}`,
        owner,
        name: repo,
        full_name: `${owner}/${repo}`,
        archived: false,
      },
    }),
    getTeamRepositoryPermission: async ({ repo }) => ({
      exists: true,
      current_permission_api_value: repo === 'developer-portal' ? 'none' : 'maintain',
    }),
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

test('integration scaffold keeps remove-team-repo-access csv_attachment fixture aligned with expected metadata', () => {
  const markdown = loadAttachmentIssueFixture();

  assert.match(markdown, /### Target organization\s+octo-org/i);
  assert.match(markdown, /### Target team\s+platform-engineering/i);
  assert.match(markdown, /### Designated repository-access approver\s+octocat/i);
  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
});

test('csv_attachment lifecycle progresses from waiting_for_attachment to awaiting_approval after corrected requester CSV', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-csv-int-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const comments = loadAttachmentCommentsFixture();

  const waitingResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '9601',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        intake_mode: 'csv_attachment',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      COMMENT_ID: '9201',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: 'trigger',
    },
    api: createRemovalApi([]),
    fetchImpl: async () => createFetchResponse('repository\nservice-catalog\n'),
  });

  assert.equal(waitingResult.validation.request_status, 'waiting_for_attachment');
  assert.equal(waitingResult.validation.is_valid, false);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Attachment status: waiting for requester CSV attachment comment/i);

  const failedResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '9601',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        intake_mode: 'csv_attachment',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      COMMENT_ID: '9204',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: comments.find((comment) => comment.id === 9204).body,
    },
    api: createRemovalApi(comments.filter((comment) => comment.id <= 9204)),
    fetchImpl: async (url) => {
      assert.match(url, /remove-access\.csv/i);
      return createFetchResponse('repository,permission\nservice-catalog,write\n');
    },
    setProcessExitCode: false,
  });

  assert.equal(failedResult.validation.request_status, 'validation_failed');
  assert.equal(failedResult.validation.attachment_validation_attempt.attempt_status, 'csv_invalid');
  assert.equal(failedResult.validation.accepted_attachment_submission.comment_id, 9204);

  const correctedResult = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '9601',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        team: 'Platform Engineering',
        designated_approver: 'octocat',
        requested_repositories: '',
        intake_mode: 'csv_attachment',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
      COMMENT_ID: '9205',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: comments.find((comment) => comment.id === 9205).body,
    },
    api: createRemovalApi(comments),
    fetchImpl: async (url) => {
      assert.match(url, /remove-access-corrected\.csv/i);
      return createFetchResponse('repository\nservice-catalog\ndeveloper-portal\n');
    },
  });

  assert.equal(correctedResult.validation.request_status, 'awaiting_approval');
  assert.equal(correctedResult.validation.is_valid, true);
  assert.equal(correctedResult.validation.accepted_attachment_submission.comment_id, 9205);
  assert.equal(correctedResult.validation.requested_repository_removals.length, 2);
  assert.deepEqual(
    correctedResult.auditArtifact.reconciliation.removals_to_apply.map((entry) => entry.repository_full_name),
    ['octo-org/service-catalog']
  );
  assert.deepEqual(
    correctedResult.auditArtifact.reconciliation.already_absent_noops.map((entry) => entry.repository_full_name),
    ['octo-org/developer-portal']
  );
});
