'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runRequestValidation } = require('../../src/scripts/run-request-validation');

const REPOSITORIES_CSV = [
  'repository_name,repository_visibility,primary_contact,secondary_contact',
  'acme-platform-service,private,octocat,hubot',
  'acme-web,internal,octocat,',
  'acme-docs,public,alice@example.com,',
].join('\n');

function loadAttachmentIssueFixture() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-csv-attachment-issue.md'),
    'utf8'
  );
}

function loadAttachmentCommentsFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-csv-attachment-comments.json'),
      'utf8'
    )
  );
}

function buildRegistry(workspace) {
  const registryDir = path.join(workspace, 'tenant-registry');
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

function buildTeamApi(comments = []) {
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    listOrgTeams: async () => ([
      { slug: 'tenanta-tenant', parent: null },
      { slug: 'tenanta-repoadmin', parent: { slug: 'tenanta-tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'tenanta-tenant') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'active', membership: { role: 'member' } };
    },
    listIssueComments: async () => comments,
  };
}

const TENANT_REPO_API = {
  getRepository: async () => ({ exists: false, repository: null }),
  getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
};

function buildAttachmentEnv(overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '950',
    REQUESTER_LOGIN: 'tenant-admin-user',
    PARSED_REQUEST_JSON: JSON.stringify({
      organization: 'octo-org',
      tenant_name: 'Tenant A',
      intake_mode: 'csv_attachment',
      repositories_csv: '',
      repository_name: '',
      designated_approver: 'org-owner-user',
      dry_run: true,
      justification: 'Attachment-driven tenant repositories',
    }),
    PARSED_INTAKE_MODE: 'csv_attachment',
    GITHUB_RUN_ID: '9100',
    GITHUB_RUN_ATTEMPT: '1',
    TENANT_REGISTRY_REF: 'main',
    ISSUEOPS_GITHUB_TOKEN: 'test-token',
    GITHUB_TOKEN: 'test-token',
    AUDIT_ARTIFACT_RETENTION_DAYS: '30',
    ...overrides,
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

test('integration scaffold keeps csv_attachment issue fixture aligned with expected request metadata', () => {
  const markdown = loadAttachmentIssueFixture();

  assert.match(markdown, /### Target organization\s+octo-org/i);
  assert.match(markdown, /### Tenant name\s+Tenant A/i);
  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Designated approver\s+org-owner-user/i);
  assert.match(markdown, /### Dry-run mode\s+true/i);
});

test('workflow assumptions keep create-tenant-repos issue_comment trigger and intake_mode applicability in place', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-tenant-repos.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /issues:\s*[\s\S]*- opened/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- created/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- edited/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*- deleted/);
  assert.match(workflow, /name:\s+Check request applicability/);
  assert.match(workflow, /PARSED_INTAKE_MODE: \$\{\{ steps\.parse_request\.outputs\.parsed_intake_mode \}\}/);
  assert.match(workflow, /\$\{PARSED_INTAKE_MODE:-\}" = "csv_attachment"/);
  assert.match(workflow, /COMMENT_ID: \$\{\{ github\.event\.comment\.id \|\| '' \}\}/);
  assert.match(workflow, /COMMENT_AUTHOR_LOGIN: \$\{\{ github\.event\.comment\.user\.login \|\| '' \}\}/);
  assert.match(workflow, /COMMENT_BODY: \$\{\{ github\.event\.comment\.body \|\| '' \}\}/);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/);
});

test('validate emits waiting_for_attachment and an upload request when no requester CSV comment exists yet', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-csv-waiting-int-'));
  const auditPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const registryDir = buildRegistry(workspace);
  const comments = loadAttachmentCommentsFixture();

  const result = await runRequestValidation({
    env: buildAttachmentEnv({
      ISSUE_NUMBER: '950',
      TENANT_REGISTRY_DIR: registryDir,
      AUDIT_ARTIFACT_PATH: auditPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      COMMENT_ID: '9101',
      COMMENT_AUTHOR_LOGIN: 'other-user',
      COMMENT_BODY: 'trigger',
    }),
    api: buildTeamApi(comments.filter((comment) => comment.id <= 9101)),
    tenantRepoApi: TENANT_REPO_API,
    fetchImpl: async () => createFetchResponse(REPOSITORIES_CSV),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(result.validation.is_valid, false);
  assert.equal(result.auditArtifact.request.request_status, 'waiting_for_attachment');
  assert.equal(result.auditArtifact.request.intake_mode, 'csv_attachment');
  const summary = fs.readFileSync(summaryPath, 'utf8');
  assert.match(summary, /Request is waiting for a requester-authored CSV attachment comment/i);
  assert.match(summary, /Please upload the repositories spreadsheet as a \.csv file attachment/i);
});

test('validate downloads and parses a requester CSV attachment into repository entries', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-csv-accepted-int-'));
  const auditPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const comments = loadAttachmentCommentsFixture();
  let requestedUrl = null;

  const result = await runRequestValidation({
    env: buildAttachmentEnv({
      ISSUE_NUMBER: '951',
      TENANT_REGISTRY_DIR: registryDir,
      AUDIT_ARTIFACT_PATH: auditPath,
      COMMENT_ID: '9104',
      COMMENT_AUTHOR_LOGIN: 'tenant-admin-user',
      COMMENT_BODY: comments.find((comment) => comment.id === 9104).body,
    }),
    api: buildTeamApi(comments.filter((comment) => comment.id <= 9104)),
    tenantRepoApi: TENANT_REPO_API,
    fetchImpl: async (url) => {
      requestedUrl = url;
      assert.match(url, /create-tenant-repos\.csv/i);
      return createFetchResponse(REPOSITORIES_CSV);
    },
    setProcessExitCode: false,
  });

  assert.match(requestedUrl, /user-attachments\/files\/9105\/create-tenant-repos\.csv/);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.accepted_attachment_submission.comment_id, 9104);
  assert.equal(result.validation.attachment_validation_attempt.attempt_status, 'csv_valid');
  assert.equal(result.validation.entries.length, 3);
  assert.deepEqual(
    result.auditArtifact.request.repository_entries.map((entry) => entry.repository_name_normalized),
    ['acme-platform-service', 'acme-web', 'acme-docs']
  );
  assert.ok(result.auditArtifact.request.repository_entries.every((entry) => entry.action === 'create'));
});

test('validate ignores a non-requester CSV comment and keeps waiting', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-csv-ignored-int-'));
  const auditPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const nonRequesterComment = [
    {
      id: 8100,
      created_at: '2026-05-25T09:00:00Z',
      body: 'Uploading on their behalf: [create-tenant-repos.csv](https://github.com/user-attachments/files/8100/create-tenant-repos.csv)',
      user: { login: 'other-user' },
    },
  ];

  const result = await runRequestValidation({
    env: buildAttachmentEnv({
      ISSUE_NUMBER: '952',
      TENANT_REGISTRY_DIR: registryDir,
      AUDIT_ARTIFACT_PATH: auditPath,
      COMMENT_ID: '8100',
      COMMENT_AUTHOR_LOGIN: 'other-user',
      COMMENT_BODY: nonRequesterComment[0].body,
    }),
    api: buildTeamApi(nonRequesterComment),
    tenantRepoApi: TENANT_REPO_API,
    fetchImpl: async () => {
      throw new Error('download should not run for a non-requester comment');
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.request_status, 'waiting_for_attachment');
  assert.equal(result.validation.is_valid, false);
  assert.equal(result.auditArtifact.request.repository_entries.length, 0);
});
