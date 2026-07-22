'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  extractCommentLinks,
  isTrustedGitHubAttachmentUrl,
} = require('../../src/workflow-support/resolve-csv-attachment-comment');
const { validateTenantRepoRequest } = require('../../src/workflow-support/validate-tenant-repo-request');

const REPOSITORIES_CSV = [
  'repository_name,repository_visibility,primary_contact,secondary_contact',
  'acme-platform-service,private,octocat,hubot',
  'acme-web,internal,octocat,',
  'acme-docs,public,alice@example.com,',
].join('\n');

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function makeRegistry(prefix) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'tenant-a.json'),
    JSON.stringify({
      tenant_key: 'tenant-a',
      tenant_display_name: 'Tenant A',
      organization: 'octo-org',
      tenant_team_name: 'TenantA_Tenant',
      tenant_team_slug: 'tenanta-tenant',
      repo_admin_team_name: 'TenantA_RepoAdmin',
      repo_admin_team_slug: 'tenanta-repoadmin',
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildParsedCsvAttachmentRequest(overrides = {}) {
  return {
    organization: 'octo-org',
    tenant_name: 'Tenant A',
    intake_mode: 'csv_attachment',
    repositories_csv: '',
    repository_name: '',
    designated_approver: 'org-owner-user',
    dry_run: 'true',
    justification: 'Attachment-driven tenant repositories',
    ...overrides,
  };
}

function buildValidationDependencies({ registryDir, issueComments = [], fetchImpl, existingRepos = new Set() } = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'tenanta-tenant') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'active', membership: { role: 'member' } };
    },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    getRepository: async ({ repo }) => (existingRepos.has(repo)
      ? { exists: true, repository: { full_name: `octo-org/${repo}`, visibility: 'internal' } }
      : { exists: false, repository: null }),
    getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    issueComments,
    fetchImpl,
    token: 'test-token',
  };
}

function createFetchResponse(text) {
  const payload = Buffer.from(text, 'utf8');
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-length' ? String(payload.byteLength) : null;
      },
    },
    arrayBuffer: async () => payload,
  };
}

test('csv_attachment fixture exposes trusted github .csv attachment links', () => {
  const links = loadAttachmentCommentsFixture().flatMap((comment) => extractCommentLinks(comment.body));
  assert.ok(links.some((link) => isTrustedGitHubAttachmentUrl(link.url)));
  assert.ok(links.some((link) => String(link.url || '').toLowerCase().endsWith('.csv')));
});

test('waits for a requester CSV attachment when no qualifying comment exists yet', async () => {
  const registryDir = makeRegistry('ctr-csv-waiting-');
  const comments = loadAttachmentCommentsFixture();

  const validation = await validateTenantRepoRequest(
    { parsedRequest: buildParsedCsvAttachmentRequest(), issue: { number: 940, user: { login: 'tenant-admin-user' } }, repository: 'octo-org/issueops-speckit' },
    buildValidationDependencies({
      registryDir,
      issueComments: comments.filter((comment) => comment.id <= 9101),
      fetchImpl: async () => createFetchResponse(REPOSITORIES_CSV),
    })
  );

  assert.equal(validation.request_status, 'waiting_for_attachment');
  assert.equal(validation.is_valid, false);
  assert.equal(validation.request.repository_entries.length, 0);
  assert.match(validation.warnings.join('\n'), /waiting for a requester-authored CSV attachment comment/i);
});

test('rejects a requester non-CSV attachment comment', async () => {
  const registryDir = makeRegistry('ctr-csv-noncsv-');
  const comments = loadAttachmentCommentsFixture();

  const validation = await validateTenantRepoRequest(
    { parsedRequest: buildParsedCsvAttachmentRequest(), issue: { number: 941, user: { login: 'tenant-admin-user' } }, repository: 'octo-org/issueops-speckit' },
    buildValidationDependencies({
      registryDir,
      issueComments: comments.filter((comment) => comment.id <= 9102),
      fetchImpl: async () => createFetchResponse(REPOSITORIES_CSV),
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /missing_csv_extension/i);
  assert.equal(validation.accepted_attachment_submission.rejection_reason, 'missing_csv_extension');
});

test('fails closed on an ambiguous multi-CSV requester upload', async () => {
  const registryDir = makeRegistry('ctr-csv-ambiguous-');
  const comments = loadAttachmentCommentsFixture();

  const validation = await validateTenantRepoRequest(
    { parsedRequest: buildParsedCsvAttachmentRequest(), issue: { number: 942, user: { login: 'tenant-admin-user' } }, repository: 'octo-org/issueops-speckit' },
    buildValidationDependencies({
      registryDir,
      issueComments: comments.filter((comment) => comment.id <= 9103),
      fetchImpl: async () => createFetchResponse(REPOSITORIES_CSV),
    })
  );

  assert.equal(validation.request_status, 'validation_failed');
  assert.match(validation.errors.join('\n'), /ambiguous_attachment_set/i);
  assert.equal(validation.accepted_attachment_submission.rejection_reason, 'ambiguous_attachment_set');
});

test('downloads and parses an accepted CSV attachment into repository_entries', async () => {
  const registryDir = makeRegistry('ctr-csv-accepted-');
  const comments = loadAttachmentCommentsFixture();
  const selectedCandidateUrl = 'https://github.com/user-attachments/files/9105/create-tenant-repos.csv';
  let requestedUrl = null;

  const validation = await validateTenantRepoRequest(
    { parsedRequest: buildParsedCsvAttachmentRequest(), issue: { number: 943, user: { login: 'tenant-admin-user' } }, repository: 'octo-org/issueops-speckit' },
    buildValidationDependencies({
      registryDir,
      issueComments: comments.filter((comment) => comment.id <= 9104),
      fetchImpl: async (url) => {
        requestedUrl = url;
        return createFetchResponse(REPOSITORIES_CSV);
      },
    })
  );

  assert.equal(requestedUrl, selectedCandidateUrl);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.is_valid, true);
  assert.equal(validation.accepted_attachment_submission.comment_id, 9104);
  assert.equal(validation.accepted_attachment_submission.acceptance_status, 'accepted');
  assert.equal(validation.attachment_validation_attempt.attempt_status, 'csv_valid');
  assert.equal(validation.entries.length, 3);
  assert.deepEqual(
    validation.entries.map((entry) => entry.repository_name_normalized),
    ['acme-platform-service', 'acme-web', 'acme-docs']
  );
  assert.ok(validation.entries.every((entry) => entry.action === 'create'));
  assert.ok(validation.entries.every((entry) => entry.source === 'csv'));
});

test('revalidation reuses a persisted accepted attachment without re-downloading', async () => {
  const registryDir = makeRegistry('ctr-csv-reuse-');
  let downloadAttempted = false;

  const persistedRequest = {
    request_id: 'octo-org/issueops-speckit#943/9100.1',
    issue_number: 943,
    repository: 'octo-org/issueops-speckit',
    requester_login: 'tenant-admin-user',
    organization: 'octo-org',
    tenant_name_input: 'Tenant A',
    tenant_name_normalized: 'tenant a',
    repository_name_input: 'acme-platform-service',
    repository_name_normalized: 'acme-platform-service',
    repository_visibility: 'private',
    repository_visibility_source: 'user_selected',
    primary_contact: 'octocat',
    primary_contact_type: 'handle',
    secondary_contact: 'hubot',
    secondary_contact_type: 'handle',
    designated_approver_login: 'org-owner-user',
    dry_run: false,
    intake_mode: 'csv_attachment',
    repository_entries: [
      { repository_name_input: 'acme-platform-service', repository_name_normalized: 'acme-platform-service', repository_visibility: 'private', repository_visibility_source: 'user_selected', primary_contact: 'octocat', primary_contact_type: 'handle', secondary_contact: 'hubot', secondary_contact_type: 'handle', source: 'csv' },
      { repository_name_input: 'acme-web', repository_name_normalized: 'acme-web', repository_visibility: 'internal', repository_visibility_source: 'user_selected', primary_contact: 'octocat', primary_contact_type: 'handle', secondary_contact: '', secondary_contact_type: 'absent', source: 'csv' },
    ],
    accepted_attachment_submission: {
      comment_id: 9104,
      comment_created_at: '2026-05-25T10:06:00Z',
      uploader_login: 'tenant-admin-user',
      attachment_url: 'https://github.com/user-attachments/files/9105/create-tenant-repos.csv',
      filename: 'create-tenant-repos.csv',
      extension: '.csv',
      content_hash: 'abc123',
      acceptance_status: 'accepted',
      rejection_reason: null,
    },
    attachment_validation_attempt: { request_id: 'octo-org/issueops-speckit#943/9100.1', attempt_status: 'csv_valid', evaluated_at: '2026-05-25T10:06:00Z', errors: [] },
    request_status: 'approved',
  };

  const validation = await validateTenantRepoRequest(persistedRequest, buildValidationDependencies({
    registryDir,
    issueComments: [],
    fetchImpl: async () => {
      downloadAttempted = true;
      return createFetchResponse(REPOSITORIES_CSV);
    },
  }));

  assert.equal(downloadAttempted, false);
  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.entries.length, 2);
  assert.deepEqual(
    validation.entries.map((entry) => entry.repository_name_normalized),
    ['acme-platform-service', 'acme-web']
  );
});

test('a non-requester CSV comment alone does not satisfy the attachment gate', async () => {
  const registryDir = makeRegistry('ctr-csv-nonrequester-');
  const nonRequesterOnly = [
    {
      id: 8000,
      created_at: '2026-05-25T09:00:00Z',
      body: 'Uploading on their behalf: [create-tenant-repos.csv](https://github.com/user-attachments/files/8000/create-tenant-repos.csv)',
      user: { login: 'other-user' },
    },
  ];

  const validation = await validateTenantRepoRequest(
    { parsedRequest: buildParsedCsvAttachmentRequest(), issue: { number: 944, user: { login: 'tenant-admin-user' } }, repository: 'octo-org/issueops-speckit' },
    buildValidationDependencies({
      registryDir,
      issueComments: nonRequesterOnly,
      fetchImpl: async () => createFetchResponse(REPOSITORIES_CSV),
    })
  );

  assert.equal(validation.request_status, 'waiting_for_attachment');
  assert.equal(validation.is_valid, false);
});
