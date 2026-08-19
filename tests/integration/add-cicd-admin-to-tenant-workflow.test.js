'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { runRequestValidation } = require('../../src/scripts/run-request-validation');

test('add-cicd-admin-to-tenant workflow includes validation and approval gates', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'add-cicd-admin-to-tenant.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /name:\s+add-cicd-admin-to-tenant/i);
  assert.match(workflow, /issue-ops\/parser@v5/i);
  assert.match(workflow, /run-request-validation\.js/i);
  assert.match(workflow, /run-approval-gate\.js/i);
  assert.match(workflow, /run-approved-execution\.js/i);
  assert.match(workflow, /PARSED_CICD_ADMIN_OPERATION/);
  assert.match(workflow, /PARSED_REQUESTED_PEOPLE/);
  assert.match(workflow, /contents:\s+write/i);
  assert.match(workflow, /steps\.approval_gate\.outputs\['approval-status'\]\s*==\s*'approved'/i);
});

test('add-cicd-admin-to-tenant issue form exposes the routing anchor and people intake', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'add-cicd-admin-to-tenant.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+cicd_admin_operation/);
  assert.match(form, /id:\s+intake_mode/);
  assert.match(form, /id:\s+requested_people/);
  assert.doesNotMatch(form, /id:\s+designated_approver/);
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
    ISSUE_NUMBER: '430',
    REQUESTER_LOGIN: 'tenant-root-maintainer',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_CICD_ADMIN_OPERATION: 'add',
    PARSED_INTAKE_MODE: 'manual',
    PARSED_REQUESTED_PEOPLE: 'octocat\nhubot',
    PARSED_DRY_RUN: 'false',
    PARSED_BUSINESS_JUSTIFICATION: 'These engineers manage the tenant runner fleet.',
    ISSUEOPS_GITHUB_TOKEN: 'pat-token',
    GITHUB_TOKEN: 'pat-token',
    TENANT_REGISTRY_DIR: registryDir,
    TENANT_REGISTRY_REF: 'main',
    AUDIT_ARTIFACT_PATH: artifactPath,
    GITHUB_RUN_ID: '26670000001',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides,
  };
}

function buildTeamApi(options = {}) {
  const rootMembershipRole = options.rootMembershipRole || 'maintainer';
  const cicdTeamExists = options.cicdTeamExists === true;
  const teamStore = {
    created: [],
    parentLinks: [],
    memberships: [],
    cicdMembers: options.cicdMembers || [],
  };

  return {
    teamStore,
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    getTeamBySlug: async ({ teamSlug }) => {
      if (teamSlug === 'contosouk-root') {
        return { exists: true, team: { id: 101, slug: 'contosouk-root' } };
      }
      if (teamSlug === 'contosouk-cicd-admin' && (cicdTeamExists || teamStore.created.includes('contosouk-cicd-admin'))) {
        return { exists: true, team: { id: 202, slug: 'contosouk-cicd-admin' } };
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
      if (teamSlug === 'contosouk-cicd-admin') {
        return teamStore.cicdMembers;
      }
      return [];
    },
    createTeam: async ({ name }) => {
      teamStore.created.push(name);
      return { id: 202, name, slug: name, privacy: 'closed', parent: null };
    },
    updateTeamParent: async ({ teamSlug, parentTeamId }) => {
      teamStore.parentLinks.push(`${teamSlug}->${parentTeamId}`);
      return { id: 202, slug: teamSlug, parent: { id: parentTeamId, slug: 'contosouk-root' } };
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

async function runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi }) {
  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
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
      // No approval comment exists: self-serve ops auto-approve at the gate.
      listIssueComments: async () => [],
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

test('US1 validation routes the request to the cicd_admin_membership operation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-us1-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir),
    api: buildTeamApi(),
    setProcessExitCode: false,
  });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.metadata.operation, 'cicd_admin_membership');
  assert.equal(artifact.request.request_status, 'awaiting_approval');
  assert.equal(artifact.request.cicd_admin_team_slug, 'contosouk-cicd-admin');
  assert.equal(artifact.reconciliation.team_action, 'create_team');
});

test('US2 approval gate auto-approves self-serve requests without an approver comment', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-us2-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi() });

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.approval.approval_status, 'approved');
  assert.equal(artifact.approval.approver_role, 'tenant_self_serve');
  assert.equal(artifact.approval.decision_source, 'policy');
  assert.equal(artifact.request.request_status, 'approved');
});

test('US3 happy path creates the team, links the parent, assigns maintainers, and adds members', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-us3-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const teamApi = buildTeamApi();

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000002',
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
  assert.deepEqual(teamApi.teamStore.created, ['contosouk-cicd-admin']);
  assert.deepEqual(teamApi.teamStore.parentLinks, ['contosouk-cicd-admin->101']);
  assert.deepEqual(
    [...teamApi.teamStore.memberships].sort(),
    [
      'contosouk-cicd-admin:hubot:member',
      'contosouk-cicd-admin:octocat:member',
      'contosouk-cicd-admin:tenant-admin-two:maintainer',
      'contosouk-cicd-admin:tenant-root-maintainer:maintainer',
    ]
  );

  const registryRecord = JSON.parse(fs.readFileSync(path.join(registryDir, 'contosouk.json'), 'utf8'));
  const cicdNode = registryRecord.topology.teams.structure.find((node) => node.type === 'cicd-admin');
  assert.deepEqual(cicdNode, {
    team: 'contosouk-cicd-admin',
    parent: 'contosouk-root',
    type: 'cicd-admin',
  });
});

test('US3 with an existing team skips creation and converges membership as noop', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-noop-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const teamApi = buildTeamApi({
    cicdTeamExists: true,
    cicdMembers: [
      { username: 'octocat', role: 'member', state: 'active' },
      { username: 'hubot', role: 'member', state: 'active' },
    ],
  });

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi });

  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000003',
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

test('US3 fails closed when the requester loses root-team maintainership', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-boundary-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);

  await runValidatedAndApprovedFlow({ artifactPath, registryDir, teamApi: buildTeamApi() });

  const demotedTeamApi = buildTeamApi({ rootMembershipRole: 'member' });
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000004',
      GITHUB_RUN_ATTEMPT: '4',
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
  assert.deepEqual(demotedTeamApi.teamStore.memberships, []);
});

test('US3 csv_attachment intake resolves the attachment, executes, and revalidates via the accepted submission', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-csv-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = buildRegistry(workspace);
  const teamApi = buildTeamApi();
  teamApi.listIssueComments = async () => [
    {
      id: 3101,
      created_at: '2026-08-18T10:00:00Z',
      user: { login: 'tenant-root-maintainer' },
      body: 'CSV attached: [people.csv](https://github.com/user-attachments/files/1234/people.csv)',
    },
  ];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from('username\noctocat\nhubot\n', 'utf8'),
  });

  await runRequestValidation({
    env: buildValidationEnv(artifactPath, registryDir, {
      PARSED_INTAKE_MODE: 'csv_attachment',
      PARSED_REQUESTED_PEOPLE: '',
    }),
    api: teamApi,
    fetchImpl,
    setProcessExitCode: false,
  });

  const validated = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(validated.request.request_status, 'awaiting_approval');
  assert.equal(validated.request.accepted_attachment_submission.acceptance_status, 'accepted');
  assert.deepEqual(validated.request.requested_people.map((p) => p.username ?? p), ['octocat', 'hubot']);

  await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: teamApi,
    setProcessExitCode: false,
  });

  // Executor revalidation deliberately receives no issue comments or fetch:
  // it must reuse the already-accepted attachment submission.
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_RUN_ID: '26670000005',
      GITHUB_RUN_ATTEMPT: '5',
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
  assert.deepEqual(
    teamApi.teamStore.memberships.filter((entry) => entry.endsWith(':member')).sort(),
    [
      'contosouk-cicd-admin:hubot:member',
      'contosouk-cicd-admin:octocat:member',
    ]
  );
});
