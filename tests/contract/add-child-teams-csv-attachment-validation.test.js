'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyAttachmentComment,
  extractCommentLinks,
  resolveCsvAttachmentComment,
} = require('../../src/workflow-support/resolve-csv-attachment-comment');
const {
  CSV_ROW_NUMBERING_CONVENTION,
  normalizeBulkCsvRequestedChildTeams,
} = require('../../src/workflow-support/normalize-bulk-csv-requested-child-teams');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');
const { DEFAULT_ATTACHMENT_MAX_BYTES } = require('../../src/actions/team-hierarchy-policy');

function loadCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-child-teams-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function loadJsonFixture(name) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createHierarchyApi(validationFixture, issueComments) {
  return {
    getOrganization: async () => validationFixture.organization,
    listOrgTeams: async () => validationFixture.teams || [],
    getMembershipForUser: async ({ teamSlug, username }) => {
      const teamMemberships = validationFixture.memberships || {};
      return teamMemberships[teamSlug] && teamMemberships[teamSlug][username]
        ? teamMemberships[teamSlug][username]
        : { membership: null };
    },
    listIssueComments: async () => issueComments,
  };
}

test('attachment comment fixture scaffolding includes requester, non-requester, correction, and approval events', () => {
  const comments = loadCommentsFixture();

  assert.equal(comments.length, 7);
  assert.ok(comments.some((comment) => comment.user.login === 'other-user'));
  assert.ok(comments.some((comment) => comment.id === 6102));
  assert.ok(comments.some((comment) => comment.id === 6103));
  assert.equal(comments.at(-1).body, 'approved');
});

test('attachment discovery keeps CSV links found in markdown and HTML comments', () => {
  const markdownLinks = extractCommentLinks(
    '[child-teams.csv](https://github.com/user-attachments/files/33333333/opaque-id)'
  );
  const htmlLinks = extractCommentLinks(
    '<a href="https://github.com/user-attachments/files/33333333/opaque-id">child-teams.csv</a>'
  );

  assert.equal(markdownLinks.length, 1);
  assert.equal(htmlLinks.length, 1);
  assert.equal(markdownLinks[0].filename, 'child-teams.csv');
  assert.equal(htmlLinks[0].filename, 'child-teams.csv');
});

test('non-requester attachment comments are ignored for progression', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: [
      {
        id: 7101,
        created_at: '2026-05-25T10:10:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/7101/child-teams.csv)',
        user: { login: 'other-user' },
      },
    ],
  });

  assert.equal(resolution.resolution_status, 'waiting_for_attachment');
  assert.equal(resolution.candidate, null);
  assert.equal(resolution.findings[0].status, 'non_requester');
});

test('requester comments with multiple CSV attachments fail closed as ambiguous', () => {
  const classification = classifyAttachmentComment(
    {
      id: 7102,
      created_at: '2026-05-25T10:12:00Z',
      body: [
        '[child-teams-a.csv](https://github.com/user-attachments/files/7102/child-teams-a.csv)',
        '[child-teams-b.csv](https://github.com/user-attachments/files/7103/child-teams-b.csv)',
      ].join('\n'),
      user: { login: 'requester' },
    },
    { requesterLogin: 'requester' }
  );

  assert.equal(classification.status, 'ambiguous');
  assert.equal(classification.rejection_reason, 'ambiguous_attachment_set');
});

test('CSV normalization findings use 1-based data-row numbering excluding header row', () => {
  const normalization = normalizeBulkCsvRequestedChildTeams([
    'child_team',
    '',
    'Application Platform',
    'Application Platform',
  ].join('\n'));

  assert.equal(normalization.csv_row_numbering_convention, CSV_ROW_NUMBERING_CONVENTION);
  const blankFinding = normalization.csv_row_findings.find((finding) => finding.validation_status === 'blank');
  const duplicateFinding = normalization.csv_row_findings.find(
    (finding) => finding.validation_status === 'duplicate'
  );

  assert.ok(blankFinding);
  assert.ok(duplicateFinding);
  assert.equal(blankFinding.row_number, 1);
  assert.equal(duplicateFinding.row_number, 3);
});

test('attachment size-cap enforcement reads repository policy attachment_max_bytes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-cap-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7201',
      REQUESTER_LOGIN: 'requester',
      TEAM_HIERARCHY_POLICY_JSON: JSON.stringify({ attachment_max_bytes: 20 }),
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 72011,
        created_at: '2026-05-25T10:05:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/72011/child-teams.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? '25' : null) },
      arrayBuffer: async () => new TextEncoder().encode('child_team\nalpha-team\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.attachment_max_bytes, 20);
  assert.match(result.validation.errors.join('\n'), /configured size cap of 20 bytes/i);
});

test('attachment size-cap enforcement uses default fallback when repository policy value is absent', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-cap-default-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7202',
      REQUESTER_LOGIN: 'requester',
      TEAM_HIERARCHY_POLICY_JSON: JSON.stringify({}),
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 72021,
        created_at: '2026-05-25T10:06:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/72021/child-teams.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('child_team\napplication-platform\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.attachment_max_bytes, DEFAULT_ATTACHMENT_MAX_BYTES);
});

test('non-decodable attachment content fails validation with decode guidance', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-decode-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7203',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 72031,
        created_at: '2026-05-25T10:07:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/72031/child-teams.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => Uint8Array.from([0x80, 0x80, 0x80]).buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /could not be decoded as UTF-8/i);
});

test('malformed attachment CSV blocks approval readiness until corrected attachment is provided', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-malformed-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7204',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 72041,
        created_at: '2026-05-25T10:08:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/72041/child-teams.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode('team\napplication-platform\n').buffer,
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.attachment_validation_attempt.attempt_status, 'csv_invalid');
  assert.match(result.validation.errors.join('\n'), /must include the required `child_team` header/i);
});

test('dry-run attachment validation preserves approval readiness and captures bounded-retry rate-limit evidence', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-attachment-dry-run-rate-limit-'));
  const auditPath = path.join(workspace, 'audit.json');
  const validationFixture = loadJsonFixture('team-hierarchy-validation.json').visible_org;
  const delays = [];
  let attempts = 0;

  const result = await runRequestValidation({
    env: {
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '7205',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parent_team: 'Platform Engineering',
        designated_hierarchy_approver: 'octocat',
        intake_mode: 'csv_attachment',
        requested_child_teams: '',
        business_justification: 'Need hierarchy updates',
        dry_run: true,
      }),
      AUDIT_ARTIFACT_PATH: auditPath,
    },
    api: createHierarchyApi(validationFixture, [
      {
        id: 72051,
        created_at: '2026-05-25T10:09:00Z',
        body: '[child-teams.csv](https://github.com/user-attachments/files/72051/child-teams.csv)',
        user: { login: 'requester' },
      },
    ]),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: {
            get: (name) => {
              const key = String(name || '').toLowerCase();
              if (key === 'retry-after') {
                return '1';
              }
              if (key === 'x-ratelimit-remaining') {
                return '0';
              }
              return null;
            },
          },
        };
      }

      return {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new TextEncoder().encode('child_team\napplication-platform\n').buffer,
      };
    },
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.request.dry_run, true);
  assert.equal(result.validation.attachment_rate_limit_snapshot.retry_after_seconds, 1);
  assert.deepEqual(delays, [1000]);
});
