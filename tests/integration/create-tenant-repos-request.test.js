'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runRequestValidation } = require('../../src/scripts/run-request-validation');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function buildTenantRepoValidationEnv(artifactPath, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '555',
    REQUESTER_LOGIN: 'tenant-admin-user',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'Tenant A',
    PARSED_REPOSITORY_NAME: 'acme-platform-service',
    PARSED_PRIMARY_CONTACT: 'octocat',
    PARSED_SECONDARY_CONTACT: '',
    PARSED_REPOSITORY_VISIBILITY: 'private',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Need a tenant repository for service deployment.',
    GITHUB_RUN_ID: '9001',
    GITHUB_RUN_ATTEMPT: '1',
    TENANT_REGISTRY_REF: 'main',
    ISSUEOPS_GITHUB_TOKEN: 'test-token',
    GITHUB_TOKEN: 'test-token',
    AUDIT_ARTIFACT_PATH: artifactPath,
    AUDIT_ARTIFACT_RETENTION_DAYS: '30',
    ...overrides,
  };
}

function buildTenantRepoRegistry(workspace) {
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

function buildValidationApi() {
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
  };
}

test('create-tenant-repos request integration scaffold reads comment fixture', () => {
  const commentsPath = path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-comments.json');
  const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));

  assert.ok(Array.isArray(comments));
  assert.equal(comments.length > 0, true);
  assert.equal(comments[0].body, 'approved');
});

test('tenant repo request validation normalizes repository visibility and defaults to private', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-visibility-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  const artifactPath = path.join(tempRoot, 'create-tenant-repos-validation.json');

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

  const env = {
    GITHUB_REPOSITORY: 'owner/repo',
    ISSUE_NUMBER: '555',
    REQUESTER_LOGIN: 'tenant-admin-user',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'Tenant A',
    PARSED_REPOSITORY_NAME: 'acme-platform-service',
    PARSED_PRIMARY_CONTACT: 'octocat',
    PARSED_SECONDARY_CONTACT: '',
    PARSED_REPOSITORY_VISIBILITY: 'public',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'true',
    PARSED_JUSTIFICATION: 'Need a tenant repository for service deployment.',
    GITHUB_RUN_ID: '9002',
    GITHUB_RUN_ATTEMPT: '1',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    ISSUEOPS_GITHUB_TOKEN: 'test-token',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_STEP_SUMMARY: path.join(tempRoot, 'summary.md'),
    GITHUB_OUTPUT: path.join(tempRoot, 'github-output.txt'),
    AUDIT_ARTIFACT_RETENTION_DAYS: '30',
  };

  const api = {
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
  };

  const tenantRepoApi = {
    getRepository: async () => ({ exists: false, repository: null }),
    getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
  };

  const result = await runRequestValidation({
    env,
    api,
    tenantRepoApi,
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request.repository_visibility, 'public');
  assert.equal(result.validation.request.repository_visibility_source, 'user_selected');
  assert.equal(result.auditArtifact.reconciliation.requested_visibility, 'public');
  assert.equal(result.auditArtifact.reconciliation.existing_visibility, null);
  assert.equal(fs.existsSync(artifactPath), true);
});

test('tenant repo request validation integrates canonical tenant context without mutation', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-integration-'));
  const registryDir = path.join(tempRoot, 'tenant-registry');
  const artifactPath = path.join(tempRoot, 'create-tenant-repos-validation.json');
  const summaryPath = path.join(tempRoot, 'summary.md');
  const outputPath = path.join(tempRoot, 'github-output.txt');

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

  const env = {
    GITHUB_REPOSITORY: 'owner/repo',
    ISSUE_NUMBER: '555',
    REQUESTER_LOGIN: 'tenant-admin-user',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'Tenant A',
    PARSED_REPOSITORY_NAME: 'acme-platform-service',
    PARSED_PRIMARY_CONTACT: 'octocat',
    PARSED_SECONDARY_CONTACT: '',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'true',
    PARSED_JUSTIFICATION: 'Need a tenant repository for service deployment.',
    GITHUB_RUN_ID: '9001',
    GITHUB_RUN_ATTEMPT: '1',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    ISSUEOPS_GITHUB_TOKEN: 'test-token',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    GITHUB_OUTPUT: outputPath,
    AUDIT_ARTIFACT_RETENTION_DAYS: '30',
  };

  const api = {
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
  };

  const tenantRepoApi = {
    getRepository: async () => ({ exists: false, repository: null }),
    getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
  };

  const result = await runRequestValidation({
    env,
    api,
    tenantRepoApi,
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(result.auditArtifact.request.request_status, 'awaiting_approval');
  assert.equal(result.auditArtifact.validation.no_mutation_planned, true);
  assert.equal(result.auditArtifact.execution.mutation_count, 0);
  assert.match(result.auditArtifact.request.context_marker, /^tenant-repo-context:/);
  assert.equal(result.auditArtifact.reconciliation.creation_action, 'create_repository');
  assert.equal(result.auditArtifact.reconciliation.permission_action, 'grant_admin');
  assert.equal(fs.existsSync(artifactPath), true);
});

test('tenant repo request validation rejects invalid repository visibility and writes summary details', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-tenant-repo-invalid-visibility-'));
  const registryDir = buildTenantRepoRegistry(tempRoot);
  const artifactPath = path.join(tempRoot, 'create-tenant-repos-validation.json');
  const summaryPath = path.join(tempRoot, 'summary.md');

  const result = await runRequestValidation({
    env: buildTenantRepoValidationEnv(artifactPath, {
      PARSED_REPOSITORY_VISIBILITY: 'secret',
      PARSED_DRY_RUN: 'true',
      TENANT_REGISTRY_DIR: registryDir,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: path.join(tempRoot, 'github-output.txt'),
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  const summary = fs.readFileSync(summaryPath, 'utf8');

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(result.validation.validation_findings.visibility_validation_status, 'invalid_visibility');
  assert.match(result.validation.validation_findings.visibility_validation_reason, /Allowed values are: private, internal, public/i);
  assert.match(summary, /Visibility validation status: invalid_visibility/i);
  assert.match(summary, /Visibility validation reason: Repository visibility 'secret' is invalid/i);
  assert.match(summary, /Allowed repository visibilities: private, internal, public/i);
});

test('runApprovalGate approves tenant repo request when designated active owner comments approved', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-approval-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);

  await runRequestValidation({
    env: buildTenantRepoValidationEnv(artifactPath, {
      TENANT_REGISTRY_DIR: registryDir,
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 100,
          body: 'approved',
          created_at: '2026-05-29T11:00:00Z',
          user: { login: 'org-owner-user' },
        },
      ],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: username === 'org-owner-user' ? 'admin' : 'member',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });

  assert.equal(approvalResult.approval.approval_status, 'approved');
  assert.equal(approvalResult.approval.approver_role, 'target_org_owner');
  assert.equal(approvalResult.request.request_status, 'approved');
  assert.equal(approvalResult.approval.approved_context_marker, approvalResult.request.context_marker);
  assert.equal(approvalResult.approval.latest_context_marker, approvalResult.request.context_marker);
});

test('runApprovalGate invalidates stale tenant repo approval when context marker changes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-stale-context-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);

  await runRequestValidation({
    env: buildTenantRepoValidationEnv(artifactPath, {
      TENANT_REGISTRY_DIR: registryDir,
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  persisted.request.context_marker = 'tenant-repo-context:new';
  persisted.approval = {
    approval_status: 'approved',
    approver_login: 'org-owner-user',
    approver_role: 'target_org_owner',
    approver_authorization_state: 'authorized',
    approved_context_marker: 'tenant-repo-context:old',
    latest_context_marker: 'tenant-repo-context:old',
    decision_note: 'Previously approved context',
  };
  fs.writeFileSync(artifactPath, JSON.stringify(persisted, null, 2), 'utf8');

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  assert.equal(approvalResult.approval.approval_status, 'invalidated');
  assert.equal(approvalResult.request.request_status, 'awaiting_approval');
  assert.match(approvalResult.approval.decision_note, /latest validated context marker changed/i);
});

test('runApprovalGate denies tenant repo approval from a non-designated assignee comment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-central-assignment-denied-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);

  await runRequestValidation({
    env: buildTenantRepoValidationEnv(artifactPath, {
      TENANT_REGISTRY_DIR: registryDir,
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 200,
          body: 'approved',
          created_at: '2026-05-29T11:05:00Z',
          user: { login: 'queue-owner' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  assert.equal(approvalResult.assignment.assignment_status, 'assigned');
  assert.equal(approvalResult.approval.approval_status, 'denied');
  assert.equal(approvalResult.approval.approver_role, 'other');
  assert.match(approvalResult.approval.decision_note, /does not authorize tenant repository creation mutation/i);
});

