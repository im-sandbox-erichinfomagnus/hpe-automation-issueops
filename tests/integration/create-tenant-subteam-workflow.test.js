'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('create-tenant-subteam workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'create-tenant-subteam.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+create-tenant-subteam/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_SUBTEAM_OPERATION/);
  assert.match(workflow, /PARSED_REQUESTED_SUBTEAMS/);
  assert.match(workflow, /PARSED_PARENT_TEAM/);
  assert.match(workflow, /contents:\s+write/i);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
});

test('create-tenant-subteam issue form exposes the routing anchor and subteam intake', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-tenant-subteam.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+subteam_operation/);
  assert.match(form, /id:\s+parent_team/);
  assert.match(form, /id:\s+intake_mode/);
  assert.match(form, /id:\s+requested_subteams/);
  assert.match(form, /id:\s+designated_approver/);
  assert.match(form, /id:\s+dry_run/);
});

function buildRegistry(workspace) {
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify({
      tenantId: 'contosouk',
      tenantName: 'ContosoUK',
      tenantType: 'application',
      organization: 'octo-org',
      topology: {
        organization: { orgName: 'octo-org' },
        teams: {
          tenantRootTeam: 'contosouk-root',
          structure: [
            { team: 'contosouk-root', parent: null, type: 'root' },
            { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
            { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
          ],
        },
      },
    }, null, 2),
    'utf8'
  );
  return registryDir;
}

function buildValidationEnv(artifactPath, registryDir, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '450',
    REQUESTER_LOGIN: 'tenant-root-maintainer',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_SUBTEAM_OPERATION: 'create',
    PARSED_INTAKE_MODE: 'manual',
    PARSED_REQUESTED_SUBTEAMS: 'Payments\nPortal Web',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'false',
    PARSED_BUSINESS_JUSTIFICATION: 'Split the tenant delivery group.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26690000001',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildTeamApi(options = {}) {
  const rootMembershipRole = options.rootMembershipRole || 'maintainer';
  const existingSubteams = new Set(options.existingSubteams || []);
  const teamStore = {
    created: [],
    parentLinks: [],
    memberships: [],
  };

  return {
    teamStore,
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' || username === 'org-admin-requester' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    getTeamBySlug: async ({ teamSlug }) => {
      if (teamSlug === 'contosouk-root') {
        return { exists: true, team: { id: 101, slug: 'contosouk-root' } };
      }
      if (existingSubteams.has(teamSlug) || teamStore.created.includes(teamSlug)) {
        return { exists: true, team: { id: 600 + teamStore.created.indexOf(teamSlug), slug: teamSlug } };
      }
      return { exists: false, team: null };
    },
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk-root') {
        if (username === 'tenant-root-maintainer') {
          return { state: 'active', membership: { role: rootMembershipRole } };
        }
        if (username === 'tenant-admin-two') {
          return { state: 'active', membership: { role: 'maintainer' } };
        }
        if (username === 'regular-root-member') {
          return { state: 'active', membership: { role: 'member' } };
        }
      }
      return { state: 'absent', membership: null };
    },
    listTeamMembers: async ({ teamSlug }) => {
      if (teamSlug === 'contosouk-root') {
        return [
          { username: 'tenant-root-maintainer', role: 'maintainer', state: 'active' },
          { username: 'tenant-admin-two', role: 'maintainer', state: 'active' },
          { username: 'regular-root-member', role: 'member', state: 'active' },
        ];
      }
      return [];
    },
    createTeam: async ({ name }) => {
      teamStore.created.push(name);
      return { id: 700 + teamStore.created.length, name, slug: name, privacy: 'closed', parent: null };
    },
    updateTeamParent: async ({ teamSlug, parentTeamId }) => {
      teamStore.parentLinks.push(`${teamSlug}->${parentTeamId}`);
      return { slug: teamSlug, parent: { id: parentTeamId, slug: 'contosouk-root' } };
    },
    addOrUpdateTeamMembership: async ({ teamSlug, username, role = 'member' }) => {
      teamStore.memberships.push(`${teamSlug}:${username}:${role}`);
      return { username, state: 'active', role, membership: { role, state: 'active' } };
    },
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    addIssueLabels: async () => ([]),
    listIssueLabels: async () => ([]),
    removeIssueLabel: async () => ({}),
    listIssueComments: async () => [],
  };
}

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi, envOverrides = {} }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, envOverrides),
    api: teamApi,
    setProcessExitCode: false,
  });

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 2701,
          body: 'approved',
          created_at: '2026-08-18T15:00:00Z',
          user: { login: 'org-owner-user' },
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

const PAT_TOKEN_INFO = {
  token: 'pat-token',
  source: 'ISSUEOPS_GITHUB_TOKEN',
  token_kind: 'pat',
  is_pat_backed: true,
  supports_org_mutation: true,
};

test('US1 validation routes the request to the tenant_subteam_creation operation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'tenant_subteam_creation');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.parent_team_slug, 'contosouk-root');
  assert.equal(artifact.reconciliation.teams_to_create.length, 2);
});

test('US2 approval gate approves only via the designated org-owner approver', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-us2-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi() });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'approved');
  assert.equal(artifact.approval.approver_role, 'target_org_owner');
  assert.equal(artifact.request.request_status, 'approved');
});

test('US3 happy path creates prefixed subteams under the root with maintainers assigned', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const teamApi = buildTeamApi();

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26690000002',
      GITHUB_RUN_ATTEMPT: '2',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi,
    commitRegistryTopology: false,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.failure_count, 0);
  assert.deepEqual(teamApi.teamStore.created, ['contosouk-payments', 'contosouk-portal-web']);
  assert.deepEqual(teamApi.teamStore.parentLinks, [
    'contosouk-payments->101',
    'contosouk-portal-web->101',
  ]);
  assert.deepEqual(
    [...teamApi.teamStore.memberships].sort(),
    [
      'contosouk-payments:tenant-admin-two:maintainer',
      'contosouk-payments:tenant-root-maintainer:maintainer',
      'contosouk-portal-web:tenant-admin-two:maintainer',
      'contosouk-portal-web:tenant-root-maintainer:maintainer',
    ]
  );

  const registryRecord = JSON.parse(fs.readFileSync(path.join(registryDir, 'contosouk.json'), 'utf8'));
  const subteamNodes = registryRecord.topology.teams.structure.filter((node) => node.type === 'subteam');
  assert.deepEqual(subteamNodes, [
    { team: 'contosouk-payments', parent: 'contosouk-root', type: 'subteam' },
    { team: 'contosouk-portal-web', parent: 'contosouk-root', type: 'subteam' },
  ]);
});

test('US3 existing subteams converge as noop without mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const teamApi = buildTeamApi({ existingSubteams: ['contosouk-payments', 'contosouk-portal-web'] });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26690000003',
      GITHUB_RUN_ATTEMPT: '3',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi,
    commitRegistryTopology: false,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.mutation_count, 0);
  assert.deepEqual(teamApi.teamStore.created, []);
  assert.deepEqual(teamApi.teamStore.memberships, []);
});

test('US3 org-owner requester passes the wider gate end-to-end', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-orgadmin-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const teamApi = buildTeamApi();

  await runValidatedAndApprovedFlow({
    artifactPath,
    registryDir,
    teamApi,
    envOverrides: { REQUESTER_LOGIN: 'org-admin-requester' },
  });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26690000004',
      GITHUB_RUN_ATTEMPT: '4',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi,
    commitRegistryTopology: false,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'executed');
  assert.equal(result.execution.failure_count, 0);
});

test('US3 fails closed when the requester loses both org ownership and root maintainership', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi() });

  const demotedTeamApi = buildTeamApi({ rootMembershipRole: 'member' });
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26690000005',
      GITHUB_RUN_ATTEMPT: '5',
      TENANT_REGISTRY_DIR: registryDir,
      TENANT_REGISTRY_REF: 'main',
    },
    tokenInfo: PAT_TOKEN_INFO,
    teamApi: demotedTeamApi,
    commitRegistryTopology: false,
    setProcessExitCode: false,
  });

  assert.equal(result.request.request_status, 'failed');
  assert.equal(result.reconciliation.boundary_revalidation_status, 'mismatched');
  assert.deepEqual(demotedTeamApi.teamStore.created, []);
});
