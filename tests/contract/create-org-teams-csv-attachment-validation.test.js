'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamCreationRequest } = require('../../src/workflow-support/parse-team-creation-request');
const { validateTeamCreationRequest } = require('../../src/workflow-support/validate-team-creation-request');

function loadCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-org-teams-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createAttachmentRequest() {
  return parseTeamCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      intended_owner: 'platform-owner',
      intake_mode: 'csv_attachment',
      requested_team_names: '',
      business_justification: 'Create the requested teams to support the platform rollout.',
      dry_run: 'true',
    },
    issue: { number: 611, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });
}

test('attachment comment fixture scaffolding includes requester, non-requester, correction, and approval events', () => {
  const comments = loadCommentsFixture();

  assert.equal(comments.length, 4);
  assert.deepEqual(
    comments.map((comment) => comment.user.login),
    ['requester', 'other-user', 'requester', 'platform-owner']
  );
  assert.equal(comments.at(-1).body, 'approved');
});

test('attachment comment fixture scaffolding exposes exactly one attachment link per attachment comment', () => {
  const comments = loadCommentsFixture().filter((comment) => /files\//.test(comment.body));

  assert.equal(comments.length, 3);
  assert.ok(
    comments.every((comment) => (comment.body.match(/https:\/\/github\.com\/[^\s)]+/g) || []).length === 1)
  );
  assert.ok(comments.every((comment) => /team-creation.*\.csv\)/i.test(comment.body)));
});

test('attachment comment fixture scaffolding preserves chronological correction boundaries', () => {
  const comments = loadCommentsFixture();

  assert.deepEqual(
    comments.map((comment) => comment.id),
    [6101, 6102, 6103, 6104]
  );
  assert.match(comments[0].body, /team-creation\.csv/i);
  assert.match(comments[2].body, /team-creation-corrected\.csv/i);
});

test('csv attachment create-team requests wait for a requester-authored attachment comment before approval readiness', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: [],
  });

  assert.equal(validation.request_status, 'waiting_for_attachment');
  assert.equal(validation.is_valid, false);
  assert.deepEqual(validation.errors, []);
  assert.match(validation.warnings.join('\n'), /waiting for a requester-authored CSV attachment comment/i);
});

test('csv attachment create-team requests accept a requester CSV attachment and normalize it into requested teams', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('team_name\nPlatform Engineering\nRelease Managers\n').buffer,
    }),
  });

  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.is_valid, true);
  assert.equal(validation.accepted_attachment_submission.comment_id, 6101);
  assert.equal(validation.request.requested_teams.length, 2);
  assert.deepEqual(
    validation.request.requested_teams.map((team) => team.normalized_slug),
    ['platform-engineering', 'release-managers']
  );
  assert.equal(validation.csv_row_findings.length, 2);
});

test('csv attachment rejects non-requester attachment comments', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6102),
  });

  assert.equal(validation.request_status, 'waiting_for_attachment');
  assert.equal(validation.is_valid, false);
  assert.deepEqual(validation.errors, []);
});

test('csv attachment rejects ambiguous comments with multiple CSV links', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: [
      {
        id: 7001,
        created_at: '2026-05-22T10:00:00Z',
        body: 'Two files: [a.csv](https://example.com/a.csv) [b.csv](https://example.com/b.csv)',
        user: { login: 'requester' },
      },
    ],
  });

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /ambiguous_attachment_set/);
});

test('csv attachment rejects comments with non-CSV file extensions', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: [
      {
        id: 7002,
        created_at: '2026-05-22T10:01:00Z',
        body: '[teams.xlsx](https://example.com/teams.xlsx)',
        user: { login: 'requester' },
      },
    ],
  });

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /missing_csv_extension/);
});

test('csv attachment rejects oversized downloads', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    maxAttachmentBytes: 10,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => '50000' },
      arrayBuffer: async () => new TextEncoder().encode('team_name\n' + 'x'.repeat(50000)).buffer,
    }),
    sleep: async () => {},
  });

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /size cap/i);
  assert.equal(validation.accepted_attachment_submission.acceptance_status, 'rejected');
  assert.match(validation.accepted_attachment_submission.rejection_reason, /oversized/);
});

test('csv attachment rejects when download fails', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => null } }),
    sleep: async () => {},
  });

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.length > 0);
  assert.equal(validation.accepted_attachment_submission.acceptance_status, 'rejected');
  assert.match(validation.accepted_attachment_submission.rejection_reason, /download_failed/);
});

test('csv attachment rejects UTF-8 decode failures', async () => {
  const invalidUtf8 = new Uint8Array([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x81]);
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => invalidUtf8.buffer,
    }),
    sleep: async () => {},
  });

  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /UTF-8/i);
  assert.equal(validation.accepted_attachment_submission.acceptance_status, 'rejected');
});

test('csv attachment records provenance including content hash and byte size', async () => {
  const csvContent = 'team_name\nPlatform Engineering\n';
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(csvContent).buffer,
    }),
  });

  assert.equal(validation.is_valid, true);
  assert.ok(validation.accepted_attachment_submission.content_hash);
  assert.equal(typeof validation.accepted_attachment_submission.content_hash, 'string');
  assert.ok(validation.accepted_attachment_submission.content_hash.length > 0);
  assert.ok(validation.accepted_attachment_submission.byte_size > 0);
  assert.ok(validation.accepted_attachment_submission.downloaded_at);
  assert.equal(validation.accepted_attachment_submission.acceptance_status, 'accepted');
  assert.equal(validation.accepted_attachment_submission.comment_id, 6101);
  assert.equal(validation.accepted_attachment_submission.uploader_login, 'requester');
  assert.match(validation.accepted_attachment_submission.attachment_url, /team-creation\.csv/);
});

test('csv attachment captures rate-limit snapshot when download encounters retryable failure', async () => {
  let attempts = 0;
  const csvContent = 'team_name\nPlatform Engineering\n';
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => name === 'retry-after' ? '2' : null },
        };
      }
      return {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new TextEncoder().encode(csvContent).buffer,
      };
    },
    sleep: async () => {},
    maxRetries: 2,
  });

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.ok(validation.attachment_rate_limit_snapshot);
  assert.equal(validation.attachment_rate_limit_snapshot.retry_after_seconds, 2);
});

test('csv attachment download failure after retry exhaustion surfaces rate-limit context', async () => {
  const validation = await validateTeamCreationRequest(createAttachmentRequest(), {
    getOrganization: async () => ({ exists: true }),
    resolveMembership: async () => ({ exists: true, membership: { state: 'active', role: 'member' } }),
    listTeams: async () => [],
    issueComments: loadCommentsFixture().filter((comment) => comment.id === 6101),
    token: 'test-token',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => name === 'retry-after' ? '5' : null },
    }),
    sleep: async () => {},
    maxRetries: 1,
  });

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request_status, 'validation_failed');
  assert.equal(validation.accepted_attachment_submission.acceptance_status, 'rejected');
  assert.match(validation.accepted_attachment_submission.rejection_reason, /download_failed/);
});