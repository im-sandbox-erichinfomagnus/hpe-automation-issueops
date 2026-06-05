'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('create-tenant-repos workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-tenant-repos.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+create-tenant-repos/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_REPOSITORY_VISIBILITY/i);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
});

function buildTenantRepoRegistry(workspace) {
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify({
      tenant_key: 'contosouk',
      tenant_display_name: 'ContosoUK',
      organization: 'im-sandbox-himanshu',
      tenant_team_name: 'ContosoUK_Tenant',
      tenant_team_slug: 'contosouk_tenant',
      repo_admin_team_name: 'ContosoUK_RepoAdmins',
      repo_admin_team_slug: 'contosouk_repoadmins',
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildValidationEnv(artifactPath, registryDir, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
    ISSUE_NUMBER: '226',
    REQUESTER_LOGIN: 'himanshu-im',
    PARSED_ORGANIZATION: 'im-sandbox-himanshu',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_REPOSITORY_NAME: 'acme-platform-service',
    PARSED_REPOSITORY_VISIBILITY: 'private',
    PARSED_DESIGNATED_APPROVER: 'himanshu-im',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Need a tenant repository',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26627740733',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildValidationApi(options = {}) {
  const approverRole = options.approverRole || 'admin';
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'himanshu-im' ? approverRole : 'member',
        state: 'active',
      },
    }),
    listOrgTeams: async () => ([
      { slug: 'contosouk_tenant', parent: null },
      { slug: 'contosouk_repoadmins', parent: { slug: 'contosouk_tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'contosouk_tenant') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }

      return { state: 'active', membership: { role: 'member' } };
    },
  };
}

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, validationTenantRepoApi, approvalComments }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildValidationApi(),
    tenantRepoApi: validationTenantRepoApi,
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => approvalComments || [
        {
          id: 301,
          body: 'approved',
          created_at: '2026-05-29T10:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });
}

test('US3 happy path creates repository and grants admin to X_RepoAdmin', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-happy-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const calls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '2',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
      AUDIT_ARTIFACT_RETENTION_DAYS: '30',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      createOrganizationRepository: async ({ organization, name }) => {
        calls.push(`create:${organization}/${name}`);
        return { exists: true, repository: { full_name: `${organization}/${name}` } };
      },
      addOrUpdateTeamRepositoryPermission: async ({ organization, teamSlug, owner, repo, permission }) => {
        calls.push(`grant:${organization}/${teamSlug}:${owner}/${repo}:${permission}`);
        return { repository_full_name: `${owner}/${repo}`, permission };
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.repository_creation_result, 'created');
  assert.equal(result.execution.repo_admin_grant_result, 'granted');
  assert.equal(result.execution.failure_count, 0);
  assert.equal(result.execution.audit_persistence_result, 'persisted');
  assert.deepEqual(calls, [
    'create:im-sandbox-himanshu/acme-platform-service',
    'grant:im-sandbox-himanshu/contosouk_repoadmins:im-sandbox-himanshu/acme-platform-service:admin',
  ]);
});

test('US3 creates repositories with requested private, internal, and public visibility', async () => {
  for (const visibility of ['private', 'internal', 'public']) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `create-tenant-repos-${visibility}-`));
    const artifactPath = path.join(workspace, 'audit.json');
    const registryDir = buildTenantRepoRegistry(workspace);
    const createCalls = [];

    await runRequestValidation({
      env: buildValidationEnv(artifactPath, registryDir, {
        PARSED_REPOSITORY_VISIBILITY: visibility,
      }),
      api: buildValidationApi(),
      tenantRepoApi: {
        getRepository: async () => ({ exists: false, repository: null }),
        getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      },
      setProcessExitCode: false,
    });

    await runApprovalGate({
      env: {
        AUDIT_ARTIFACT_PATH: artifactPath,
        ISSUEOPS_GITHUB_TOKEN: 'pat-token',
        GITHUB_TOKEN: 'pat-token',
      },
      api: {
        getAssignableOwners: async () => ['aeruvakalpanaa'],
        addIssueAssignees: async () => ({ status: 'assigned' }),
        listIssueComments: async () => [
          {
            id: 301,
            body: 'approved',
            created_at: '2026-05-29T10:00:00Z',
            user: { login: 'himanshu-im' },
          },
        ],
        getOrganizationMembership: async () => ({
          exists: true,
          membership: { role: 'admin', state: 'active' },
        }),
      },
      setProcessExitCode: false,
    });

    const result = await runApprovedExecution({
      env: {
        AUDIT_ARTIFACT_PATH: artifactPath,
        ISSUEOPS_GITHUB_TOKEN: 'pat-token',
        GITHUB_RUN_ID: '26627740733',
        GITHUB_RUN_ATTEMPT: '2',
        TENANT_REGISTRY_DIR: registryDir,
        TENANT_REGISTRY_REF: 'main',
      },
      tokenInfo: {
        token: 'pat-token',
        source: 'ISSUEOPS_GITHUB_TOKEN',
        token_kind: 'pat',
        is_pat_backed: true,
        supports_team_repo_access_mutation: true,
      },
      createApi: () => ({
        getRepository: async () => ({ exists: false, repository: null }),
        getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
        createOrganizationRepository: async ({ organization, name, visibility: requestedVisibility }) => {
          createCalls.push(`${organization}/${name}:${requestedVisibility}`);
          return {
            exists: true,
            repository: { full_name: `${organization}/${name}`, visibility: requestedVisibility },
          };
        },
        addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
          repository_full_name: `${owner}/${repo}`,
          permission,
        }),
      }),
      teamApi: buildValidationApi(),
      setProcessExitCode: false,
    });

    assert.deepEqual(createCalls, [`im-sandbox-himanshu/acme-platform-service:${visibility}`]);
    assert.equal(result.reconciliation.requested_visibility, visibility);
    assert.equal(result.reconciliation.actual_visibility, visibility);
  }
});

test('US3 existing repository follows no-op or missing-grant reconciliation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: true, repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'private' } }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'admin' }),
    },
  });

  const noopResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '3',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: true, repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'private' } }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'admin' }),
      createOrganizationRepository: async () => {
        throw new Error('create should not run for existing repository noop path');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        throw new Error('permission grant should not run for admin noop path');
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(noopResult.request.request_status, 'executed');
  assert.equal(noopResult.execution.repository_creation_result, 'noop');
  assert.equal(noopResult.execution.repo_admin_grant_result, 'noop');
  assert.equal(noopResult.reconciliation.actual_visibility, 'private');
  assert.equal(noopResult.reconciliation.visibility_conflict, false);
  assert.equal(noopResult.execution.noop_count >= 2, true);

  const grantCalls = [];
  const missingGrantResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '4',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: true, repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'private' } }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'maintain' }),
      createOrganizationRepository: async () => {
        throw new Error('create should not run when repository already exists');
      },
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => {
        grantCalls.push(`${owner}/${repo}:${permission}`);
        return { repository_full_name: `${owner}/${repo}`, permission };
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(missingGrantResult.request.request_status, 'executed');
  assert.equal(missingGrantResult.execution.repository_creation_result, 'noop');
  assert.equal(missingGrantResult.execution.repo_admin_grant_result, 'granted');
  assert.equal(missingGrantResult.reconciliation.actual_visibility, 'private');
  assert.deepEqual(grantCalls, ['im-sandbox-himanshu/acme-platform-service:admin']);
});

test('US3 existing repository with mismatched visibility is blocked as a conflict with no mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-visibility-conflict-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  let mutationAttempted = false;

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, {
      PARSED_REPOSITORY_VISIBILITY: 'private',
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: true, repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'public' } }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'admin' }),
    },
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['aeruvakalpanaa'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 301,
          body: 'approved',
          created_at: '2026-05-29T10:00:00Z',
          user: { login: 'himanshu-im' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '6',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: true, repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'public' } }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'admin' }),
      createOrganizationRepository: async () => {
        mutationAttempted = true;
        throw new Error('create should not run for visibility conflict');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        mutationAttempted = true;
        throw new Error('grant should not run for visibility conflict');
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(mutationAttempted, false);
  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.visibility_conflict, true);
  assert.equal(result.reconciliation.blocked_reason, 'visibility_conflict');
  assert.equal(result.reconciliation.requested_visibility, 'private');
  assert.equal(result.reconciliation.actual_visibility, 'public');
  assert.equal(result.execution.repository_creation_result, 'failed');
});

test('US3 blocks approved execution when boundary revalidation mismatches', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  let mutationAttempted = false;

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
  });

  const boundaryMismatchTeamApi = {
    ...buildValidationApi(),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'contosouk_tenant') {
        return { state: 'absent', membership: null };
      }

      return { state: 'active', membership: { role: 'member' } };
    },
  };

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '5',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      createOrganizationRepository: async () => {
        mutationAttempted = true;
        throw new Error('create should not run on boundary mismatch');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        mutationAttempted = true;
        throw new Error('grant should not run on boundary mismatch');
      },
    }),
    teamApi: boundaryMismatchTeamApi,
    setProcessExitCode: false,
  });

  assert.equal(mutationAttempted, false);
  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
  assert.equal(result.execution.failure_count > 0, true);
});

test('US3 handles permission-grant failures, retry context, and audit persistence failure signals', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-partial-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const delays = [];
  let grantAttempts = 0;

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
  });

  const originalWriteFileSync = fs.writeFileSync;
  let writeFailInjected = false;
  fs.writeFileSync = (filePath, content, encoding) => {
    if (!writeFailInjected && String(filePath) === artifactPath) {
      writeFailInjected = true;
      throw new Error('simulated artifact persistence failure');
    }

    return originalWriteFileSync(filePath, content, encoding);
  };

  try {
    const result = await runApprovedExecution({
      env: {
        AUDIT_ARTIFACT_PATH: artifactPath,
        ISSUEOPS_GITHUB_TOKEN: 'pat-token',
        GITHUB_RUN_ID: '26627740733',
        GITHUB_RUN_ATTEMPT: '6',
        TENANT_REGISTRY_DIR: registryDir,
        TENANT_REGISTRY_REF: 'main',
      },
      tokenInfo: {
        token: 'pat-token',
        source: 'ISSUEOPS_GITHUB_TOKEN',
        token_kind: 'pat',
        is_pat_backed: true,
        supports_team_repo_access_mutation: true,
      },
      createApi: () => ({
        getRepository: async () => ({ exists: false, repository: null }),
        getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
        createOrganizationRepository: async ({ organization, name }) => ({
          exists: true,
          repository: { full_name: `${organization}/${name}` },
        }),
        addOrUpdateTeamRepositoryPermission: async () => {
          grantAttempts += 1;
          if (grantAttempts === 1) {
            const error = new Error('secondary rate limit');
            error.status = 429;
            error.headers = {
              'retry-after': '2',
              'x-ratelimit-remaining': '0',
            };
            error.payload = { message: 'secondary rate limit' };
            throw error;
          }

          const error = new Error('validation failed');
          error.status = 422;
          error.headers = {};
          error.payload = { message: 'validation failed' };
          throw error;
        },
      }),
      teamApi: buildValidationApi(),
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      setProcessExitCode: false,
    });

    assert.equal(result.request.request_status, 'failed');
    assert.equal(result.execution.repository_creation_result, 'created');
    assert.equal(result.execution.repo_admin_grant_result, 'failed');
    assert.equal(result.execution.audit_persistence_result, 'failed');
    assert.equal(result.execution.failure_count > 0, true);
    assert.equal(result.execution.rollback_status, 'manual_remediation_required');
    assert.match(result.execution.summary, /Audit artifact persistence failed/i);
    assert.deepEqual(delays, [2000]);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});

// ─── Cross-cutting regression tests ──────────────────────────────────────────

test('dry-run approved execution emits intent with no repository or permission mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-dryrun-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const mutationCalls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    approvalComments: [
      {
        id: 401,
        body: 'approved',
        created_at: '2026-05-29T11:00:00Z',
        user: { login: 'himanshu-im' },
      },
    ],
  });

  // Patch the artifact to mark dry_run = true before execution
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  artifact.request.dry_run = true;
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '10',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      createOrganizationRepository: async ({ organization, name }) => {
        mutationCalls.push(`create:${organization}/${name}`);
        return { exists: true, repository: { full_name: `${organization}/${name}` } };
      },
      addOrUpdateTeamRepositoryPermission: async ({ organization, teamSlug, owner, repo }) => {
        mutationCalls.push(`grant:${organization}/${teamSlug}:${owner}/${repo}`);
        return { repository_full_name: `${owner}/${repo}`, permission: 'admin' };
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  // Dry-run must not call any mutation APIs
  assert.deepEqual(mutationCalls, [], 'expected no mutation calls for dry_run=true');
  // Dry-run produces executed/no-op status, not created/granted
  assert.ok(
    result.execution.mutation_count === 0,
    `expected mutation_count=0, got ${result.execution.mutation_count}`
  );
  assert.match(
    result.execution.summary || '',
    /dry.run|no.*mutation/i,
    'expected dry-run summary to mention dry-run or no mutation'
  );
});

test('approved execution grants admin only to repo-admin team, never direct individual admin', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-no-direct-admin-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const permissionCalls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
  });

  await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '11',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      createOrganizationRepository: async ({ organization, name }) => ({
        exists: true,
        repository: { full_name: `${organization}/${name}` },
      }),
      addOrUpdateTeamRepositoryPermission: async ({ organization, teamSlug, owner, repo, permission }) => {
        permissionCalls.push({ organization, teamSlug, owner, repo, permission });
        return { repository_full_name: `${owner}/${repo}`, permission };
      },
      // addCollaborator-style calls must never be made — absence of this method is intentional
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  // All permission grants must be to a team slug, not an individual user login
  assert.equal(permissionCalls.length >= 1, true, 'expected at least one permission call');
  for (const call of permissionCalls) {
    assert.ok(
      call.teamSlug && call.teamSlug.length > 0,
      `permission call must use teamSlug, not individual: ${JSON.stringify(call)}`
    );
    // The teamSlug must be the repo-admin team, not the requester's login
    assert.match(
      call.teamSlug,
      /repoadmin/i,
      `expected teamSlug to be the repo-admin team, got: ${call.teamSlug}`
    );
  }
});

test('approved tenant-repo execution removes stale tenant terminal labels before writing current terminal label', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-label-reconcile-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const removedLabels = [];
  const addedLabels = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({
        exists: true,
        repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'private' },
      }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'admin' }),
    },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '8',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: {
      token: 'pat-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      token_kind: 'pat',
      is_pat_backed: true,
      supports_team_repo_access_mutation: true,
    },
    createApi: () => ({
      getRepository: async () => ({
        exists: true,
        repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'private' },
      }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'admin' }),
      createOrganizationRepository: async () => {
        throw new Error('create should not run for noop path');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        throw new Error('grant should not run for noop path');
      },
      listIssueLabels: async () => [
        'issueops:create-tenant-repos:executed',
        'issueops:create-tenant:executed',
        'issueops:create-tenant:failed',
        'issueops:unrelated:label',
      ],
      removeIssueLabel: async ({ label }) => {
        removedLabels.push(label);
        return { removed: true, label };
      },
      addIssueLabels: async ({ labels }) => {
        addedLabels.push(...labels);
        return labels;
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.deepEqual(removedLabels.sort(), ['issueops:create-tenant:executed', 'issueops:create-tenant:failed']);
  assert.deepEqual(addedLabels, ['issueops:create-tenant-repos:executed']);
});

test('approved execution is fail-closed when ISSUEOPS_GITHUB_TOKEN is absent', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-no-token-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const mutationCalls = [];

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      // ISSUEOPS_GITHUB_TOKEN deliberately absent
      GITHUB_TOKEN: '', // empty fallback
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '12',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    createApi: () => ({
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      createOrganizationRepository: async ({ organization, name }) => {
        mutationCalls.push(`create:${organization}/${name}`);
        return { exists: true, repository: { full_name: `${organization}/${name}` } };
      },
      addOrUpdateTeamRepositoryPermission: async ({ organization, teamSlug }) => {
        mutationCalls.push(`grant:${organization}/${teamSlug}`);
        return {};
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  // No mutation should have been attempted
  assert.deepEqual(mutationCalls, [], 'expected no mutation calls when token is absent');
  // Request must be in a failure or blocked state
  assert.ok(
    ['failed', 'blocked', 'validation_failed'].includes(result.request.request_status),
    `expected failed/blocked status when token absent, got: ${result.request.request_status}`
  );
});
