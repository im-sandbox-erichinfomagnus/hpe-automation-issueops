'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { DEFAULT_ATTACHMENT_MAX_BYTES } = require('../../src/actions/team-repo-access-policy');
const { validateTeamRepoAccessRequest } = require('../../src/workflow-support/validate-team-repo-access-request');

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function buildParsedCsvAttachmentRequest() {
  return {
    organization: 'octo-org',
    target_team: 'Platform Engineering',
    designated_approver: 'octocat',
    intake_mode: 'csv_attachment',
    requested_repositories: '',
    permission_level: 'write',
    business_justification: 'Attachment-driven intake for repo access',
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
    getTeamRepositoryPermission: async () => ({
      exists: false,
      current_permission_api_value: 'none',
    }),
    ...overrides,
  };
}

function createFetchResponse({ ok = true, status = 200, text = '', bytes = null, contentLength = null }) {
  const payload = bytes == null ? Buffer.from(text, 'utf8') : Buffer.from(bytes);
  const headerValues = new Map();
  if (contentLength != null) {
    headerValues.set('content-length', String(contentLength));
  }

  return {
    ok,
    status,
    headers: {
      get(name) {
        return headerValues.get(String(name || '').toLowerCase()) || null;
      },
    },
    arrayBuffer: async () => payload,
  };
}

test('validation fixture scaffold includes non-requester, ambiguous, corrected, and approval events', () => {
  const comments = loadAttachmentCommentsFixture();

  assert.ok(comments.some((comment) => comment.user.login === 'other-user'));
  assert.ok(comments.some((comment) => comment.id === 9103));
  assert.ok(comments.some((comment) => comment.id === 9105));
  assert.equal(comments.at(-1).body, 'approved');
});

test('validation fixture scaffold includes CSV links for candidate discovery coverage', () => {
  const joinedBodies = loadAttachmentCommentsFixture()
    .map((comment) => comment.body)
    .join('\n');

  assert.ok(joinedBodies.includes('https://github.com/user-attachments/files/'));
  assert.ok(joinedBodies.toLowerCase().includes('.csv)'));
});

test('rejects requester CSV links hosted outside github.com user-attachments path', async () => {
  const maliciousComments = [
    {
      id: 9991,
      created_at: '2026-05-20T12:00:00Z',
      user: { login: 'requester' },
      body: '[repo-access.csv](https://evil.example/https://github.com/user-attachments/files/9105/repo-access.csv)',
    },
  ];

  const validation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 999, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: maliciousComments,
    fetchImpl: async () => createFetchResponse({ text: 'repository\nservice-catalog\n' }),
  }));

  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /unsupported_attachment_host/i);
  assert.equal(validation.accepted_attachment_submission.rejection_reason, 'unsupported_attachment_host');
});

test('validate requester-only acceptance and ambiguous-candidate fail-closed behavior', async () => {
  const comments = loadAttachmentCommentsFixture();

  const waitingValidation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 920, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: comments.filter((comment) => comment.id <= 9101),
    fetchImpl: async () => createFetchResponse({ text: 'repository\nservice-catalog\n' }),
  }));

  assert.equal(waitingValidation.request_status, 'waiting_for_attachment');
  assert.equal(waitingValidation.is_valid, false);
  assert.match(waitingValidation.warnings.join('\n'), /waiting for a requester-authored CSV attachment comment/i);

  const ambiguousValidation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 921, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: comments.filter((comment) => comment.id <= 9103),
    fetchImpl: async () => createFetchResponse({ text: 'repository\nservice-catalog\n' }),
  }));

  assert.equal(ambiguousValidation.request_status, 'validation_failed');
  assert.match(ambiguousValidation.errors.join('\n'), /ambiguous_attachment_set/i);
  assert.equal(ambiguousValidation.accepted_attachment_submission.rejection_reason, 'ambiguous_attachment_set');
});

test('validate oversized, decode-failure, malformed CSV, unsupported-column outcomes, row numbering, and policy size caps', async () => {
  const comments = loadAttachmentCommentsFixture();
  const selectedCandidateComments = comments.filter((comment) => comment.id <= 9104);
  const selectedCandidateUrl = 'https://github.com/user-attachments/files/9105/repo-access.csv';

  const oversizedValidation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 922, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    repositoryPolicy: { attachment_max_bytes: 8 },
    fetchImpl: async (url) => {
      assert.equal(url, selectedCandidateUrl);
      return createFetchResponse({ text: 'repository\nservice-catalog\n', contentLength: 32 });
    },
  }));

  assert.equal(oversizedValidation.request_status, 'validation_failed');
  assert.match(oversizedValidation.errors.join('\n'), /configured size cap of 8 bytes/i);
  assert.equal(oversizedValidation.attachment_max_bytes, 8);

  const decodeFailureValidation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 923, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    fetchImpl: async () => createFetchResponse({ bytes: [0xff, 0xfe, 0xfd] }),
  }));

  assert.equal(decodeFailureValidation.request_status, 'validation_failed');
  assert.match(decodeFailureValidation.errors.join('\n'), /decoded as UTF-8 text/i);

  const malformedCsvValidation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 924, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    fetchImpl: async () => createFetchResponse({ text: 'repository\nfoo,bar\nservice-catalog\n' }),
  }));

  assert.equal(malformedCsvValidation.request_status, 'validation_failed');
  assert.equal(malformedCsvValidation.csv_row_numbering_convention, '1-based data-row numbers that exclude the header row');
  assert.match(malformedCsvValidation.errors.join('\n'), /CSV row 1 does not match the header column count/i);

  const unsupportedColumnsValidation = await validateTeamRepoAccessRequest({
    parsedRequest: buildParsedCsvAttachmentRequest(),
    issue: { number: 925, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, createValidationDependencies({
    issueComments: selectedCandidateComments,
    repositoryPolicy: { attachment_max_bytes: 'invalid' },
    fetchImpl: async () => createFetchResponse({ text: 'repository,permission\nservice-catalog,write\n' }),
  }));

  assert.equal(unsupportedColumnsValidation.attachment_max_bytes, DEFAULT_ATTACHMENT_MAX_BYTES);
  assert.equal(unsupportedColumnsValidation.request_status, 'validation_failed');
  assert.match(unsupportedColumnsValidation.errors.join('\n'), /unsupported columns: permission/i);
});

test('revalidation allows persisted accepted attachment csv content for csv_attachment intake', async () => {
  const validation = await validateTeamRepoAccessRequest({
    request_id: 'repo#999/run.1',
    issue_number: 999,
    repository: 'octo-org/issueops-speckit',
    requester_login: 'requester',
    organization: 'octo-org',
    team_slug: 'platform-engineering',
    team_name: 'Platform Engineering',
    designated_approver_login: 'octocat',
    requested_permission_label: 'write',
    requested_permission_api_value: 'push',
    requested_permission_rank: 3,
    intake_mode: 'csv_attachment',
    requested_repositories_input: '',
    bulk_csv_input: 'repository\nservice-catalog\ndeveloper-portal\n',
    bulk_csv_submission: {
      encoding: 'utf-8',
      header_columns: ['repository'],
      required_columns: ['repository'],
      unsupported_columns: [],
      row_count: 2,
      valid_row_count: 2,
      invalid_row_count: 0,
      duplicate_row_count: 0,
      schema_status: 'valid',
      schema_errors: [],
      raw_input: 'repository\nservice-catalog\ndeveloper-portal\n',
      csv_row_findings: [
        {
          row_number: 1,
          original_row: 'service-catalog',
          repository_value: 'service-catalog',
          normalized_repository_full_name: 'octo-org/service-catalog',
          validation_status: 'valid',
          failure_reason: null,
        },
        {
          row_number: 2,
          original_row: 'developer-portal',
          repository_value: 'developer-portal',
          normalized_repository_full_name: 'octo-org/developer-portal',
          validation_status: 'valid',
          failure_reason: null,
        },
      ],
      csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
    },
    requested_repository_grants: [
      {
        requested_repository_name: 'service-catalog',
        repository_owner: 'octo-org',
        repository_name: 'service-catalog',
        repository_full_name: 'octo-org/service-catalog',
        desired_action: 'grant_access',
        validation_status: 'valid',
      },
      {
        requested_repository_name: 'developer-portal',
        repository_owner: 'octo-org',
        repository_name: 'developer-portal',
        repository_full_name: 'octo-org/developer-portal',
        desired_action: 'grant_access',
        validation_status: 'valid',
      },
    ],
    accepted_attachment_submission: {
      comment_id: 4533527433,
      comment_created_at: '2026-05-25T11:00:00Z',
      uploader_login: 'requester',
      attachment_url: 'https://github.com/user-attachments/files/28217120/team-repo-access.csv',
      filename: 'team-repo-access.csv',
      extension: '.csv',
      content_hash: '5fb55ba1ac5f729241d0bc9828ba5100fa0be75ededc153566df9a13ec7ca172',
      acceptance_status: 'accepted',
      rejection_reason: null,
    },
    attachment_validation_attempt: {
      request_id: 'repo#999/run.1',
      attempt_status: 'csv_valid',
      evaluated_at: '2026-05-25T11:00:00Z',
      errors: [],
    },
    validation_findings: {},
    unsupported_inputs: {
      requested_team_names: '',
      requested_people: '',
      parent_team: '',
    },
    request_status: 'approved',
    dry_run: false,
  }, createValidationDependencies());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.doesNotMatch(validation.errors.join('\n'), /bulk_csv_requested_repositories must be empty/i);
});
