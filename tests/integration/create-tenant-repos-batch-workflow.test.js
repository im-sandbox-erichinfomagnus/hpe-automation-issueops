'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

const REPOSITORIES_CSV = [
  'repository_name,repository_visibility,primary_contact,secondary_contact',
  'acme-platform-service,private,octocat,hubot',
  'acme-web,internal,octocat,',
  'acme-docs,public,alice@example.com,',
].join('\n');

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
        organization: { orgName: 'im-sandbox-himanshu' },
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
        repositories: { owned: [] },
      },
      externalMappings: {},
      metadata: {},
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildValidationEnv(artifactPath, registryDir, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'im-sandbox-himanshu/issueops-speckit',
    ISSUE_NUMBER: '900',
    REQUESTER_LOGIN: 'himanshu-im',
    PARSED_ORGANIZATION: 'im-sandbox-himanshu',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_REPOSITORIES_CSV: REPOSITORIES_CSV,
    PARSED_DESIGNATED_APPROVER: 'himanshu-im',
    PARSED_DRY_RUN: 'false',
    PARSED_JUSTIFICATION: 'Need a batch of tenant repositories',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '900900',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildValidationApi() {
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'himanshu-im' ? 'admin' : 'member', state: 'active' },
    }),
    listOrgTeams: async () => ([
      { slug: 'contosouk_tenant', parent: null },
      { slug: 'contosouk_repoadmins', parent: { slug: 'contosouk_tenant' } },
    ]),
    getMembershipForUser: async ({ teamSlug }) => (teamSlug === 'contosouk_tenant'
      ? { state: 'active', membership: { role: 'maintainer' } }
      : { state: 'active', membership: { role: 'member' } }),
  };
}

test('batch workflow: three-repo CSV validates, approves, and executes per row', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-repos-batch-e2e-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildCanonicalTenantRepoRegistry(workspace);

  const { validation } = await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildValidationApi(),
    tenantRepoApi: {
      getRepository: async () => ({ exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
    },
    setProcessExitCode: false,
  });

  assert.equal(validation.is_valid, true);
  assert.equal(validation.entries.length, 3);
  assert.equal(validation.request.repository_entries.length, 3);

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['himanshu-im'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        { id: 301, body: 'approved', created_at: '2026-05-29T10:00:00Z', user: { login: 'himanshu-im' } },
      ],
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
    },
    setProcessExitCode: false,
  });

  const createCalls = [];
  const collaboratorCalls = [];
  const existingRepos = new Set(['acme-web']);

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '900900',
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
    teamApi: buildValidationApi(),
    createApi: () => ({
      getRepository: async ({ repo }) => (existingRepos.has(repo)
        ? { exists: true, repository: { full_name: `im-sandbox-himanshu/${repo}`, visibility: 'internal' } }
        : { exists: false, repository: null }),
      getTeamRepositoryPermission: async () => ({ current_permission_api_value: 'none' }),
      createOrganizationRepository: async ({ organization, name, visibility }) => {
        createCalls.push(`${organization}/${name}:${visibility}`);
        return { exists: true, repository: { full_name: `${organization}/${name}`, visibility } };
      },
      addOrUpdateTeamRepositoryPermission: async ({ owner, repo, permission }) => ({
        repository_full_name: `${owner}/${repo}`,
        permission,
      }),
      addRepositoryCollaborator: async ({ repo, username, permission }) => {
        collaboratorCalls.push(`${repo}:${username}:${permission}`);
        return {};
      },
      setRepositoryCustomProperties: async ({ owner, repo, properties }) => ({
        repository_full_name: `${owner}/${repo}`,
        updated_count: properties.length,
      }),
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 2);
  assert.equal(result.execution.noop_count, 1);
  assert.equal(result.execution.failure_count, 0);
  assert.deepEqual(createCalls, [
    'im-sandbox-himanshu/acme-platform-service:private',
    'im-sandbox-himanshu/acme-docs:public',
  ]);
  assert.deepEqual(collaboratorCalls, [
    'acme-platform-service:himanshu-im:admin',
    'acme-docs:himanshu-im:admin',
  ]);

  const registryRecord = JSON.parse(fs.readFileSync(path.join(registryDir, 'contosouk.json'), 'utf8'));
  assert.deepEqual(
    registryRecord.topology.repositories.owned.map((entry) => entry.repoName),
    ['acme-platform-service', 'acme-docs']
  );
});
