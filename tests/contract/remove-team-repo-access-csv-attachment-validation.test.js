'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DEFAULT_ATTACHMENT_MAX_BYTES } = require('../../src/actions/team-repo-access-policy');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');
const { validateTeamRepoAccessRemovalRequest } = require('../../src/workflow-support/validate-team-repo-access-removal-request');

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'remove-team-repo-access-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function buildParsedCsvAttachmentRequest() {
  return {
    organization: 'octo-org',
    team: 'Platform Engineering',
    designated_approver: 'octocat',
    intake_mode: 'csv_attachment',
    requested_repositories: '',
    business_justification: 'Attachment-driven removal intake',
    dry_run: 'true',
  };
}

function createValidationDependencies(overrides = {}) {
  return {
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async () => ({
      exists: true,
      team: { id: 1, name: 'Platform Engineering', slug: 'platform-engineering' },
    }),
    getOrganizationMembership: async () => ({
      exists: true,
      membership: { role: 'admin', state: 'active' },
    }),
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
    getTeamRepositoryPermission: async ({ repo }) => ({
      exists: true,
      current_permission_api_value: repo === 'developer-portal' ? 'none' : 'maintain',
    }),
    ...overrides,
  };
}

function createFetchResponse({ text = '', bytes = null, contentLength = null }) {
  const payload = bytes == null ? Buffer.from(text, 'utf8') : Buffer.from(bytes);
  const headerValues = new Map();
  if (contentLength != null) {
    headerValues.set('content-length', String(contentLength));
  }

  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return headerValues.get(String(name || '').toLowerCase()) || null;
      },
    },
    arrayBuffer: async () => payload,
  };
}

test('waiting_for_attachment lifecycle keeps csv_attachment requests approval-blocked', async () => {
  const validation = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9501, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: [],
  }));

  assert.equal(validation.request_status, 'waiting_for_attachment');
  assert.equal(validation.is_valid, false);
  assert.match(validation.warnings.join('\n'), /waiting for a requester-authored CSV attachment comment/i);
});

test('requester-only and ambiguous candidate selection fail closed', async () => {
  const comments = loadAttachmentCommentsFixture();

  const nonRequesterOnly = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9502, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: comments.filter((comment) => comment.id <= 9201),
    fetchImpl: async () => createFetchResponse({ text: 'repository\nservice-catalog\n' }),
  }));

  assert.equal(nonRequesterOnly.request_status, 'waiting_for_attachment');
  assert.equal(nonRequesterOnly.is_valid, false);

  const ambiguous = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9503, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: comments.filter((comment) => comment.id <= 9203),
    fetchImpl: async () => createFetchResponse({ text: 'repository\nservice-catalog\n' }),
  }));

  assert.equal(ambiguous.request_status, 'validation_failed');
  assert.match(ambiguous.errors.join('\n'), /ambiguous_attachment_set/i);
  assert.equal(ambiguous.accepted_attachment_submission.rejection_reason, 'ambiguous_attachment_set');
});

test('correction supersession selects newest eligible attachment after failed attempt', async () => {
  const comments = loadAttachmentCommentsFixture();
  const malformedCandidateComments = comments.filter((comment) => comment.id <= 9204);

  const firstAttempt = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9504, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: malformedCandidateComments,
    fetchImpl: async (url) => {
      assert.match(url, /remove-access\.csv/i);
      return createFetchResponse({ text: 'repository,permission\nservice-catalog,write\n' });
    },
  }));

  assert.equal(firstAttempt.request_status, 'validation_failed');
  assert.equal(firstAttempt.attachment_validation_attempt.attempt_status, 'csv_invalid');
  assert.equal(firstAttempt.accepted_attachment_submission.comment_id, 9204);

  const secondAttempt = await validateTeamRepoAccessRemovalRequest({
    ...firstAttempt.request,
    issueComments: undefined,
  }, createValidationDependencies({
    issueComments: comments,
    latestFailedValidationAt: firstAttempt.accepted_attachment_submission.comment_created_at,
    latestFailedValidationAttemptId: firstAttempt.attachment_validation_attempt.attempt_id,
    fetchImpl: async (url) => {
      assert.match(url, /remove-access-corrected\.csv/i);
      return createFetchResponse({ text: 'repository\nservice-catalog\ndeveloper-portal\n' });
    },
  }));

  assert.equal(secondAttempt.request_status, 'awaiting_approval');
  assert.equal(secondAttempt.is_valid, true);
  assert.equal(secondAttempt.accepted_attachment_submission.comment_id, 9205);
  assert.equal(secondAttempt.attachment_validation_attempt.attempt_status, 'csv_valid');
  assert.equal(secondAttempt.requested_repository_removals.length, 2);
});

test('csv row diagnostics, normalization, and attachment policy size caps are enforced', async () => {
  const comments = loadAttachmentCommentsFixture();
  const selectedCandidateComments = comments.filter((comment) => comment.id <= 9204);
  const selectedCandidateUrl = 'https://github.com/user-attachments/files/9204/remove-access.csv';

  const oversized = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9505, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    repositoryPolicy: { attachment_max_bytes: 8 },
    fetchImpl: async (url) => {
      assert.equal(url, selectedCandidateUrl);
      return createFetchResponse({ text: 'repository\nservice-catalog\n', contentLength: 64 });
    },
  }));

  assert.equal(oversized.request_status, 'validation_failed');
  assert.match(oversized.errors.join('\n'), /configured size cap of 8 bytes/i);
  assert.equal(oversized.attachment_max_bytes, 8);

  const decodeFailure = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9506, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    fetchImpl: async () => createFetchResponse({ bytes: [0xff, 0xfe, 0xfd] }),
  }));

  assert.equal(decodeFailure.request_status, 'validation_failed');
  assert.match(decodeFailure.errors.join('\n'), /decoded as UTF-8 text/i);

  const malformedCsv = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9507, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    fetchImpl: async () => createFetchResponse({ text: 'repository\nfoo,bar\nservice-catalog\n' }),
  }));

  assert.equal(malformedCsv.request_status, 'validation_failed');
  assert.equal(malformedCsv.csv_row_numbering_convention, '1-based data-row numbers that exclude the header row');
  assert.match(malformedCsv.errors.join('\n'), /CSV row 1 does not match the header column count/i);

  const unsupportedColumns = await validateTeamRepoAccessRemovalRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 9508, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    repositoryPolicy: { attachment_max_bytes: 'invalid' },
    fetchImpl: async () => createFetchResponse({ text: 'repository,permission\nservice-catalog,write\n' }),
  }));

  assert.equal(unsupportedColumns.attachment_max_bytes, DEFAULT_ATTACHMENT_MAX_BYTES);
  assert.equal(unsupportedColumns.request_status, 'validation_failed');
  assert.match(unsupportedColumns.errors.join('\n'), /unsupported columns: permission/i);
});

test('terminal-state immutability ignores later attachment comments after executed status', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-terminal-immutability-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '9510',
      REQUESTER_LOGIN: 'requester',
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUE_LABELS_JSON: JSON.stringify([
        { name: 'issueops:remove-team-repo-access:executed' },
      ]),
      COMMENT_ID: '9207',
      COMMENT_AUTHOR_LOGIN: 'requester',
      COMMENT_BODY: 'new attachment comment after terminal state',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        team: 'Platform Engineering',
        designated_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_repositories: '',
        dry_run: true,
      }),
    },
    api: createValidationDependencies(),
  });

  assert.equal(result.validation.request_status, 'executed');
  assert.equal(result.auditArtifact.request.request_status, 'executed');
  assert.equal(result.validation.attachment_validation_attempt.attempt_status, 'ignored_terminal_state');
  assert.equal(result.validation.accepted_attachment_submission.acceptance_status, 'ignored_terminal_state');
  assert.match(result.validation.warnings.join('\n'), /ignored after the request reaches a terminal execution state/i);
});
