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
  assert.match(workflow, /Check request applicability/i);
  assert.match(workflow, /terminal-label-event/i);
  assert.match(workflow, /issueops:create-tenant-repos:executed/i);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
  assert.match(workflow, /steps\.request_scope\.outputs\.matches-request\s*==\s*'true'/i);
});

function buildCanonicalTenantRepoRegistry(workspace) {
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify({
      tenantId: 'contosouk',
      tenantName: 'ContosoUK',
      tenantType: 'application',
      topology: {
        organization: {
          orgName: 'im-sandbox-himanshu',
        },
        teams: {
          tenantRootTeam: 'contosouk_tenant',
          structure: [
            { team: 'contosouk_tenant', parent: null, type: 'root' },
            { team: 'contosouk_repoadmins', parent: 'contosouk_tenant', type: 'repo-admin' },
          ],
        },
        accessModel: {
          enforcement: 'tenant-boundary',
          roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
        },
        repositories: {
          owned: [],
        },
      },
      externalMappings: {},
      metadata: {},
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

test('US1 canonical topology validation path is approval-ready without mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us1-canonical-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildCanonicalTenantRepoRegistry(workspace);

  const { validation, auditArtifact } = await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, {
      PARSED_DRY_RUN: 'true',
      PARSED_REPOSITORY_VISIBILITY: 'internal',
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.canonical_tenant_context.topology_mode, 'canonical');
  assert.equal(validation.validation_findings.topology_mode, 'canonical');
  assert.equal(auditArtifact.validation.no_mutation_planned, true);
  assert.equal(auditArtifact.reconciliation.boundary_revalidation_status, 'matched');
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
    PARSED_PRIMARY_CONTACT: 'octocat',
    PARSED_SECONDARY_CONTACT: '',
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

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, validationTenantRepoApi, approvalComments, validationEnvOverrides, validationApi }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, validationEnvOverrides || {}),
    api: validationApi || buildValidationApi(),
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
  assert.equal(result.execution.context_binding_status, 'matched');
  assert.equal(result.execution.approved_context_marker, result.approval.approved_context_marker);
  assert.equal(result.execution.latest_context_marker, result.approval.latest_context_marker);
  assert.match(result.execution.execution_context_marker || '', /^tenant-repo-context:/);
  assert.equal(result.execution.tenant_id, 'contosouk');
  assert.equal(result.execution.tenant_team_slug, 'contosouk_tenant');
  assert.equal(result.execution.repo_admin_team_slug, 'contosouk_repoadmins');
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

test('US4 happy path includes contact metadata in audit artifact and step summary', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us4-happy-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const summaryPath = path.join(workspace, 'summary.md');
  const registryDir = buildTenantRepoRegistry(workspace);
  const customPropertyCalls = [];
  const customPropertySchemaCreateCalls = [];

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, {
      PARSED_PRIMARY_CONTACT: 'octocat',
      PARSED_SECONDARY_CONTACT: 'hubot',
      GITHUB_STEP_SUMMARY: summaryPath,
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
      GITHUB_STEP_SUMMARY: summaryPath,
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
      GITHUB_RUN_ATTEMPT: '7',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
      GITHUB_STEP_SUMMARY: summaryPath,
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
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
      getOrganizationCustomPropertiesSchema: async () => ([
        {
          property_name: 'secondary_business_contact',
          value_type: 'string',
        },
      ]),
      createOrUpdateOrganizationCustomProperty: async ({ organization, property_name, value_type }) => {
        customPropertySchemaCreateCalls.push({ organization, property_name, value_type });
        return {
          property_name,
          value_type,
          source_type: 'organization',
        };
      },
      setRepositoryCustomProperties: async ({ owner, repo, properties }) => {
        customPropertyCalls.push({ owner, repo, properties });
        return {
          repository_full_name: `${owner}/${repo}`,
          updated_count: properties.length,
        };
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  const persistedArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = fs.readFileSync(summaryPath, 'utf8');

  assert.equal(result.request.primary_contact, 'octocat');
  assert.equal(result.request.primary_contact_type, 'handle');
  assert.equal(result.request.secondary_contact, 'hubot');
  assert.equal(result.request.secondary_contact_type, 'handle');
  assert.equal(result.execution.repository_custom_properties_result, 'mutated');

  assert.equal(persistedArtifact.request.primary_contact, 'octocat');
  assert.equal(persistedArtifact.request.primary_contact_type, 'handle');
  assert.equal(persistedArtifact.request.secondary_contact, 'hubot');
  assert.equal(persistedArtifact.request.secondary_contact_type, 'handle');

  assert.equal(customPropertyCalls.length, 1);
  assert.deepEqual(customPropertySchemaCreateCalls, [
    {
      organization: 'im-sandbox-himanshu',
      property_name: 'primary_business_contact',
      value_type: 'string',
    },
  ]);
  assert.deepEqual(customPropertyCalls[0], {
    owner: 'im-sandbox-himanshu',
    repo: 'acme-platform-service',
    properties: [
      { property_name: 'primary_business_contact', value: 'octocat' },
      { property_name: 'secondary_business_contact', value: 'hubot' },
    ],
  });

  assert.match(summary, /Primary contact: octocat \(handle\)/i);
  assert.match(summary, /Secondary contact: hubot \(handle\)/i);
});

test('US4 no-op execution preserves contact metadata from current request', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us4-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildTenantRepoRegistry(workspace);
  const customPropertyCalls = [];
  const customPropertySchemaCreateCalls = [];

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, {
      PARSED_PRIMARY_CONTACT: 'octocat',
      PARSED_SECONDARY_CONTACT: 'ops-owner@example.com',
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({
        exists: true,
        repository: { full_name: 'im-sandbox-himanshu/acme-platform-service', visibility: 'private' },
      }),
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
        throw new Error('create should not run for existing repository noop path');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        throw new Error('permission grant should not run for admin noop path');
      },
      getOrganizationCustomPropertiesSchema: async () => ([]),
      createOrUpdateOrganizationCustomProperty: async ({ organization, property_name, value_type }) => {
        customPropertySchemaCreateCalls.push({ organization, property_name, value_type });
        return {
          property_name,
          value_type,
          source_type: 'organization',
        };
      },
      setRepositoryCustomProperties: async ({ owner, repo, properties }) => {
        customPropertyCalls.push({ owner, repo, properties });
        return {
          repository_full_name: `${owner}/${repo}`,
          updated_count: properties.length,
        };
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  const persistedArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.execution.repository_creation_result, 'noop');
  assert.equal(result.execution.repo_admin_grant_result, 'noop');
  assert.equal(result.request.primary_contact, 'octocat');
  assert.equal(result.request.primary_contact_type, 'handle');
  assert.equal(result.request.secondary_contact, 'ops-owner@example.com');
  assert.equal(result.request.secondary_contact_type, 'email');
  assert.equal(result.execution.repository_custom_properties_result, 'mutated');

  assert.equal(persistedArtifact.request.primary_contact, 'octocat');
  assert.equal(persistedArtifact.request.primary_contact_type, 'handle');
  assert.equal(persistedArtifact.request.secondary_contact, 'ops-owner@example.com');
  assert.equal(persistedArtifact.request.secondary_contact_type, 'email');

  assert.equal(customPropertyCalls.length, 1);
  assert.deepEqual(customPropertySchemaCreateCalls, [
    {
      organization: 'im-sandbox-himanshu',
      property_name: 'primary_business_contact',
      value_type: 'string',
    },
    {
      organization: 'im-sandbox-himanshu',
      property_name: 'secondary_business_contact',
      value_type: 'string',
    },
  ]);
  assert.deepEqual(customPropertyCalls[0], {
    owner: 'im-sandbox-himanshu',
    repo: 'acme-platform-service',
    properties: [
      { property_name: 'primary_business_contact', value: 'octocat' },
      { property_name: 'secondary_business_contact', value: 'ops-owner@example.com' },
    ],
  });
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

  // Force a genuine boundary mismatch under the V2.2.1 OR authorization rule:
  // the requester must be neither an active tenant top-team maintainer nor an
  // active repo-admin member during re-validation, so the tenant no longer
  // resolves and execution fails closed.
  const boundaryMismatchTeamApi = {
    ...buildValidationApi(),
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
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
  assert.equal(result.execution.context_binding_status, 'matched');
  assert.equal(result.execution.approved_context_marker, result.approval.approved_context_marker);
  assert.equal(result.execution.latest_context_marker, result.approval.latest_context_marker);
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

test('US4 appends owned topology entry after successful repository provisioning', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us4-append-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildCanonicalTenantRepoRegistry(workspace);

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
      createOrganizationRepository: async ({ organization, name, visibility }) => ({
        exists: true,
        repository: { full_name: `${organization}/${name}`, visibility },
      }),
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.repository_creation_result, 'created');
  assert.equal(result.execution.repo_admin_grant_result, 'granted');
  assert.equal(result.execution.owned_topology_action, 'append_owned_entry');
  assert.equal(result.execution.topology_persistence_result.status, 'appended');

  const registryRecord = JSON.parse(
    fs.readFileSync(path.join(registryDir, 'contosouk.json'), 'utf8')
  );
  assert.equal(Array.isArray(registryRecord.topology.repositories.owned), true);
  assert.equal(registryRecord.topology.repositories.owned.length, 1);
  assert.deepEqual(registryRecord.topology.repositories.owned[0], {
    repoName: 'acme-platform-service',
    tenantId: 'contosouk',
    visibility: 'private',
    repoType: 'service',
    lifecycle: 'active',
    migrationWave: 'wave-1',
    source: 'ghec',
    adminTeam: 'contosouk_repoadmins',
  });
});

test('US4 rerun is idempotent with noop_already_owned and no duplicate append', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us4-rerun-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildCanonicalTenantRepoRegistry(workspace);
  let createCalls = 0;
  let grantCalls = 0;

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
      GITHUB_RUN_ATTEMPT: '12',
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
      createOrganizationRepository: async ({ organization, name, visibility }) => {
        createCalls += 1;
        return { exists: true, repository: { full_name: `${organization}/${name}`, visibility } };
      },
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => {
        grantCalls += 1;
        return { repository_full_name: `${owner}/${repo}`, permission };
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  const rerunResult = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26627740733',
      GITHUB_RUN_ATTEMPT: '13',
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
        createCalls += 1;
        throw new Error('create should not run in rerun noop path');
      },
      addOrUpdateTeamRepositoryPermission: async () => {
        grantCalls += 1;
        throw new Error('grant should not run in rerun noop path');
      },
    }),
    teamApi: buildValidationApi(),
    setProcessExitCode: false,
  });

  assert.equal(createCalls, 1);
  assert.equal(grantCalls, 1);
  assert.equal(rerunResult.request.request_status, 'executed');
  assert.equal(rerunResult.execution.repository_creation_result, 'noop');
  assert.equal(rerunResult.execution.repo_admin_grant_result, 'noop');
  assert.equal(rerunResult.execution.owned_topology_action, 'noop_already_owned');
  assert.equal(rerunResult.execution.topology_persistence_result.status, 'noop');

  const registryRecord = JSON.parse(
    fs.readFileSync(path.join(registryDir, 'contosouk.json'), 'utf8')
  );
  assert.equal(registryRecord.topology.repositories.owned.length, 1);
});

test('US4 duplicate-owned topology is blocked during validation with no mutation evidence', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us4-duplicate-blocked-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildCanonicalTenantRepoRegistry(workspace);
  const registryPath = path.join(registryDir, 'contosouk.json');
  const record = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  record.topology.repositories.owned.push({
    repoName: 'acme-platform-service',
    tenantId: 'contosouk',
    visibility: 'private',
    repoType: 'service',
    lifecycle: 'active',
    migrationWave: 'wave-1',
    source: 'ghec',
    adminTeam: 'contosouk_repoadmins',
  });
  fs.writeFileSync(registryPath, JSON.stringify(record, null, 2), 'utf8');

  const { validation, auditArtifact } = await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, {
      PARSED_REPOSITORY_VISIBILITY: 'private',
    }),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  assert.equal(validation.is_valid, false);
  assert.equal(validation.validation_findings.duplicate_owned_repository_status, 'duplicate_conflict');
  assert.equal(auditArtifact.validation.no_mutation_planned, true);
  assert.match(validation.errors.join('\n'), /already present in tenant topology owned repositories/i);
});

test('US2 mixed canonical and legacy tenant records keep approval and execution stable', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-us2-mixed-'));
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });

  fs.writeFileSync(
    path.join(registryDir, 'canonical-tenant.json'),
    JSON.stringify({
      tenantId: 'contoso-canonical',
      tenantName: 'Contoso Canonical',
      topology: {
        organization: { orgName: 'im-sandbox-himanshu' },
        teams: {
          tenantRootTeam: 'canonical_tenant',
          structure: [
            { team: 'canonical_tenant', parent: null, type: 'root' },
            { team: 'canonical_repoadmins', parent: 'canonical_tenant', type: 'repo-admin' },
          ],
        },
        accessModel: {
          enforcement: 'tenant-boundary',
          roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
        },
        repositories: { owned: [] },
      },
    }, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(registryDir, 'legacy-tenant.json'),
    JSON.stringify({
      tenant_key: 'contoso-legacy',
      tenant_display_name: 'Contoso Legacy',
      organization: 'im-sandbox-himanshu',
      tenant_team_name: 'Contoso Legacy Tenant',
      tenant_team_slug: 'legacy_tenant',
      repo_admin_team_name: 'Contoso Legacy RepoAdmins',
      repo_admin_team_slug: 'legacy_repoadmins',
    }, null, 2),
    'utf8'
  );

  const teamApi = {
    ...buildValidationApi(),
    listOrgTeams: async () => ([
      { slug: 'canonical_tenant', parent: null },
      { slug: 'canonical_repoadmins', parent: { slug: 'canonical_tenant' } },
      { slug: 'legacy_tenant', parent: null },
      { slug: 'legacy_repoadmins', parent: { slug: 'legacy_tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => {
      if (teamSlug === 'canonical_tenant' || teamSlug === 'legacy_tenant') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }

      return { state: 'active', membership: { role: 'member' } };
    },
  };

  const canonicalArtifactPath = path.join(workspace, 'canonical-audit.json');
  await runValidatedAndApprovedFlow({
    artifactPath: canonicalArtifactPath,
    registryDir,
    validationApi: teamApi,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    validationEnvOverrides: {
      PARSED_TENANT_NAME: 'Contoso Canonical',
      PARSED_REPOSITORY_NAME: 'canonical-service-repo',
      PARSED_REPOSITORY_VISIBILITY: 'internal',
    },
  });

  const canonicalResult = await runApprovedExecution({
    env: {
      ...buildValidationEnv(canonicalArtifactPath, registryDir, {
        PARSED_TENANT_NAME: 'Contoso Canonical',
        PARSED_REPOSITORY_NAME: 'canonical-service-repo',
        PARSED_REPOSITORY_VISIBILITY: 'internal',
      }),
      GITHUB_RUN_ATTEMPT: '20',
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
      createOrganizationRepository: async ({ organization, name, visibility }) => ({
        exists: true,
        repository: { full_name: `${organization}/${name}`, visibility },
      }),
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
    }),
    teamApi,
    setProcessExitCode: false,
  });

  const legacyArtifactPath = path.join(workspace, 'legacy-audit.json');
  await runValidatedAndApprovedFlow({
    artifactPath: legacyArtifactPath,
    registryDir,
    validationApi: teamApi,
    validationTenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    validationEnvOverrides: {
      PARSED_TENANT_NAME: 'Contoso Legacy',
      PARSED_REPOSITORY_NAME: 'legacy-service-repo',
      PARSED_REPOSITORY_VISIBILITY: 'private',
    },
  });

  const legacyResult = await runApprovedExecution({
    env: {
      ...buildValidationEnv(legacyArtifactPath, registryDir, {
        PARSED_TENANT_NAME: 'Contoso Legacy',
        PARSED_REPOSITORY_NAME: 'legacy-service-repo',
        PARSED_REPOSITORY_VISIBILITY: 'private',
      }),
      GITHUB_RUN_ATTEMPT: '21',
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
      createOrganizationRepository: async ({ organization, name, visibility }) => ({
        exists: true,
        repository: { full_name: `${organization}/${name}`, visibility },
      }),
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
    }),
    teamApi,
    setProcessExitCode: false,
  });

  assert.equal(canonicalResult.request.request_status, 'executed');
  assert.equal(canonicalResult.execution.repository_creation_result, 'created');
  assert.equal(canonicalResult.execution.repo_admin_grant_result, 'granted');
  assert.equal(canonicalResult.validation.validation_findings.topology_mode, 'canonical');

  assert.equal(legacyResult.request.request_status, 'executed');
  assert.equal(legacyResult.execution.repository_creation_result, 'created');
  assert.equal(legacyResult.execution.repo_admin_grant_result, 'granted');
  assert.equal(legacyResult.validation.validation_findings.topology_mode, 'legacy_projection');
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
