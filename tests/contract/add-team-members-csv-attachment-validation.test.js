'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  classifyAttachmentComment,
  extractCommentLinks,
  resolveCsvAttachmentComment,
} = require('../../src/workflow-support/resolve-csv-attachment-comment');
const { parseTeamMembershipRequest } = require('../../src/workflow-support/parse-team-membership-request');
const { validateTeamMembershipRequest } = require('../../src/workflow-support/validate-team-membership-request');

function loadCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-members-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function loadRateLimitFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'rate-limit-response.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createAttachmentRequest() {
  return parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      intake_mode: 'csv_attachment',
      requested_people: '',
      business_justification: 'Need support access',
      dry_run: 'true',
    },
    issue: { number: 701, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });
}

function createValidationOptions(overrides = {}) {
  return {
    getTeam: async () => ({ exists: true, team_sync_blocked: false }),
    resolveUser: async () => ({ exists: true }),
    token: 'test-token',
    ...overrides,
  };
}

function createHeaders(values = {}) {
  return {
    get(name) {
      return values[String(name).toLowerCase()] ?? null;
    },
  };
}

test('attachment comment fixture scaffolding includes requester, non-requester, correction, and approval events', () => {
  const comments = loadCommentsFixture();

  assert.equal(comments.length, 4);
  assert.deepEqual(
    comments.map((comment) => comment.user.login),
    ['requester', 'other-user', 'requester', 'org-owner-user']
  );
  assert.equal(comments.at(-1).body, 'approved');
});

test('attachment comment fixture scaffolding exposes exactly one attachment link per attachment comment', () => {
  const comments = loadCommentsFixture().filter((comment) => /files\//.test(comment.body));

  assert.equal(comments.length, 3);
  assert.ok(comments.every((comment) => (comment.body.match(/https:\/\/github\.com\/[^\s)]+/g) || []).length === 1));
  assert.ok(comments.every((comment) => /\.csv\)/i.test(comment.body)));
});

test('attachment discovery accepts markdown CSV labels even when the GitHub attachment URL basename is opaque', () => {
  const classification = classifyAttachmentComment(
    {
      id: 4505411894,
      created_at: '2026-05-21T11:30:00Z',
      body: 'Uploading the membership file.\n\n[team-members.csv](https://github.com/user-attachments/files/22222222/26f62ea1-5df9-4f4a-8d2c-e7dc2f9b9d6d)',
      user: { login: 'requester' },
    },
    { requesterLogin: 'requester' }
  );

  assert.equal(classification.status, 'accepted_candidate');
  assert.equal(classification.filename, 'team-members.csv');
  assert.equal(classification.extension, '.csv');
  assert.equal(classification.attachment_url, 'https://github.com/user-attachments/files/22222222/26f62ea1-5df9-4f4a-8d2c-e7dc2f9b9d6d');
});

test('attachment discovery extracts CSV links from HTML anchors in comment bodies', () => {
  const links = extractCommentLinks(
    'Uploading the file.<br><a href="https://github.com/user-attachments/files/33333333/opaque-id">team-members.csv</a>'
  );

  assert.equal(links.length, 1);
  assert.equal(links[0].filename, 'team-members.csv');
});

test('attachment discovery keeps GitHub attachment URLs found in image-style markdown', () => {
  const classification = classifyAttachmentComment(
    {
      id: 4505411895,
      created_at: '2026-05-21T11:31:00Z',
      body: 'Uploading the membership file.\n\n![team-members.csv](https://github.com/user-attachments/files/44444444/opaque-id)',
      user: { login: 'requester' },
    },
    { requesterLogin: 'requester' }
  );

  assert.equal(classification.status, 'accepted_candidate');
  assert.equal(classification.filename, 'team-members.csv');
  assert.equal(classification.extension, '.csv');
});

test('attachment resolution ignores requester comments that contain no attachment links', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: [
      {
        id: 4505628953,
        created_at: '2026-05-21T12:00:00Z',
        body: 'approved',
        user: { login: 'requester' },
      },
    ],
  });

  assert.equal(resolution.resolution_status, 'waiting_for_attachment');
  assert.equal(resolution.candidate, null);
  assert.equal(resolution.findings.length, 1);
  assert.equal(resolution.findings[0].rejection_reason, 'no_csv_attachment');
});

test('non-requester attachment comments do not advance validation out of waiting state', async () => {
  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7201,
          created_at: '2026-05-21T12:10:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/7201/team-members.csv)',
          user: { login: 'other-user' },
        },
      ],
    })
  );

  assert.equal(validation.request_status, 'waiting_for_attachment');
  assert.equal(validation.is_valid, false);
  assert.equal(validation.request.accepted_attachment_submission.comment_id, null);
});

test('requester comments with multiple CSV attachments fail closed as ambiguous', async () => {
  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7202,
          created_at: '2026-05-21T12:11:00Z',
          body: [
            '[team-members-a.csv](https://github.com/user-attachments/files/7202/team-members-a.csv)',
            '[team-members-b.csv](https://github.com/user-attachments/files/7203/team-members-b.csv)',
          ].join('\n'),
          user: { login: 'requester' },
        },
      ],
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.request.accepted_attachment_submission.rejection_reason, 'ambiguous_attachment_set');
  assert.match(validation.errors.join('\n'), /ambiguous_attachment_set/i);
});

test('requester comments with non-CSV attachment links are rejected explicitly', async () => {
  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7203,
          created_at: '2026-05-21T12:12:00Z',
          body: '[team-members.txt](https://github.com/user-attachments/files/7204/team-members.txt)',
          user: { login: 'requester' },
        },
      ],
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.request.accepted_attachment_submission.rejection_reason, 'missing_csv_extension');
});

test('oversized CSV attachments fail validation before decoding', async () => {
  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7204,
          created_at: '2026-05-21T12:13:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/7205/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
      maxAttachmentBytes: 10,
      fetchImpl: async () => ({
        ok: true,
        headers: createHeaders({ 'content-length': '20' }),
        arrayBuffer: async () => new TextEncoder().encode('username\noctocat\n').buffer,
      }),
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.request.accepted_attachment_submission.rejection_reason, 'oversized_attachment');
});

test('CSV attachments that cannot be decoded as UTF-8 fail validation with a decode error', async () => {
  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7206,
          created_at: '2026-05-21T12:13:30Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/7206/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
      fetchImpl: async () => ({
        ok: true,
        headers: createHeaders(),
        arrayBuffer: async () => Uint8Array.from([0xff, 0xfe, 0xfd]).buffer,
      }),
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.request.accepted_attachment_submission.rejection_reason, 'decode_failed');
  assert.match(validation.errors.join('\n'), /decoded as UTF-8/i);
});

test('attachment downloads use bounded retry and preserve rate-limit context when a retry succeeds', async () => {
  const rateLimitError = loadRateLimitFixture().secondary_limit_error;
  let attempts = 0;
  const delays = [];

  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7207,
          created_at: '2026-05-21T12:13:45Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/7207/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
      maxRetries: 2,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            status: rateLimitError.status,
            headers: createHeaders(rateLimitError.headers),
          };
        }

        return {
          ok: true,
          headers: createHeaders(rateLimitError.headers),
          arrayBuffer: async () => new TextEncoder().encode('username\noctocat\n').buffer,
        };
      },
    })
  );

  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.is_valid, true);
  assert.equal(validation.request.accepted_attachment_submission.comment_id, 7207);
  assert.equal(validation.attachment_rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
});

test('attachment downloads that exhaust bounded retry remain blocked and report rate-limit context', async () => {
  const rateLimitError = loadRateLimitFixture().secondary_limit_error;
  const delays = [];

  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7208,
          created_at: '2026-05-21T12:14:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/7208/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
      maxRetries: 2,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      fetchImpl: async () => ({
        ok: false,
        status: rateLimitError.status,
        headers: createHeaders(rateLimitError.headers),
      }),
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.request.accepted_attachment_submission.rejection_reason, 'download_failed');
  assert.equal(validation.attachment_rate_limit_snapshot.retry_after_seconds, 2);
  assert.deepEqual(delays, [2000]);
  assert.match(validation.errors.join('\n'), /failed to download csv attachment/i);
});

test('download failures keep the request blocked with provenance of the rejected attachment comment', async () => {
  const validation = await validateTeamMembershipRequest(
    createAttachmentRequest(),
    createValidationOptions({
      issueComments: [
        {
          id: 7205,
          created_at: '2026-05-21T12:14:00Z',
          body: '[team-members.csv](https://github.com/user-attachments/files/7206/team-members.csv)',
          user: { login: 'requester' },
        },
      ],
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        headers: createHeaders(),
      }),
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.request.accepted_attachment_submission.comment_id, 7205);
  assert.equal(validation.request.accepted_attachment_submission.rejection_reason, 'download_failed');
});