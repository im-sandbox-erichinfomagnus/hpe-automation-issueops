'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  persistRepoAdminTeamTopology,
  reconcileRepoAdminMembership,
} = require('../../src/workflow-support/reconcile-repo-admin-membership');

function validatedPerson(username, overrides = {}) {
  return {
    username,
    resolution_status: 'resolved',
    current_membership_state: 'unknown',
    desired_action: 'add_member',
    execution_result: 'not_started',
    failure_reason: null,
    ...overrides,
  };
}

test('a missing team plans create_team with root-team maintainers assigned', () => {
  const plan = reconcileRepoAdminMembership({
    request: { intake_mode: 'manual', dry_run: false },
    validatedPeople: [validatedPerson('octocat')],
    repo_admin_team_exists: false,
    currentMembers: [],
    rootTeamMaintainers: ['Tenant-Admin-One', 'tenant-admin-two', 'tenant-admin-one'],
    repo_admin_team_slug: 'contosouk-repo-admin',
    tenant_root_team_slug: 'contosouk-root',
    tenant_root_team_id: 101,
    dry_run: false,
  });

  assert.equal(plan.team_action, 'create_team');
  assert.deepEqual(plan.maintainers_to_assign, ['tenant-admin-one', 'tenant-admin-two']);
  assert.equal(plan.people_to_add.length, 1);
  assert.equal(plan.state, 'approved_for_execution');
});

test('an existing team plans noop team action and deduplicates present members', () => {
  const plan = reconcileRepoAdminMembership({
    request: { intake_mode: 'manual', dry_run: false },
    validatedPeople: [validatedPerson('octocat'), validatedPerson('hubot')],
    repo_admin_team_exists: true,
    currentMembers: [{ username: 'octocat', state: 'active' }],
    rootTeamMaintainers: ['tenant-admin-one'],
    repo_admin_team_slug: 'contosouk-repo-admin',
    tenant_root_team_slug: 'contosouk-root',
    dry_run: false,
  });

  assert.equal(plan.team_action, 'noop');
  assert.deepEqual(plan.maintainers_to_assign, []);
  assert.equal(plan.people_to_add.length, 1);
  assert.equal(plan.people_to_add[0].username, 'hubot');
  assert.equal(plan.people_already_present.length, 1);
  assert.equal(plan.people_already_present[0].desired_action, 'noop');
});

test('unresolved people are rejected and dry-run keeps the plan in validated state', () => {
  const plan = reconcileRepoAdminMembership({
    request: { intake_mode: 'manual', dry_run: true },
    validatedPeople: [
      validatedPerson('octocat'),
      validatedPerson('ghost-user', { resolution_status: 'unresolved', desired_action: 'reject', failure_reason: 'user_not_found' }),
    ],
    repo_admin_team_exists: false,
    currentMembers: [],
    rootTeamMaintainers: ['tenant-admin-one'],
    repo_admin_team_slug: 'contosouk-repo-admin',
    tenant_root_team_slug: 'contosouk-root',
    dry_run: true,
  });

  assert.equal(plan.people_rejected.length, 1);
  assert.equal(plan.people_rejected[0].username, 'ghost-user');
  assert.equal(plan.state, 'validated');
});

test('a fully converged request is a validated no-op plan', () => {
  const plan = reconcileRepoAdminMembership({
    request: { intake_mode: 'manual', dry_run: false },
    validatedPeople: [validatedPerson('octocat')],
    repo_admin_team_exists: true,
    currentMembers: [{ username: 'octocat', state: 'active' }],
    rootTeamMaintainers: [],
    repo_admin_team_slug: 'contosouk-repo-admin',
    tenant_root_team_slug: 'contosouk-root',
    dry_run: false,
  });

  assert.equal(plan.team_action, 'noop');
  assert.equal(plan.people_to_add.length, 0);
  assert.equal(plan.state, 'validated');
});

function buildRegistryRecord(overrides = {}) {
  return {
    tenantId: 'contosouk',
    tenantName: 'ContosoUK',
    organization: 'octo-org',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'contosouk-root',
        structure: overrides.structure || [
          { team: 'contosouk-root', parent: null, type: 'root' },
          { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
          { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
        ],
      },
    },
  };
}

test('persistRepoAdminTeamTopology is a noop when the repo-admin node already exists (bootstrap case)', () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-admin-topology-noop-'));
  const recordPath = path.join(registryDir, 'contosouk.json');
  fs.writeFileSync(recordPath, JSON.stringify(buildRegistryRecord(), null, 2), 'utf8');

  const result = persistRepoAdminTeamTopology({
    tenantKey: 'contosouk',
    teamSlug: 'contosouk-repo-admin',
    parentTeamSlug: 'contosouk-root',
    registryDirectory: registryDir,
  });
  assert.equal(result.status, 'noop');
  assert.equal(result.registry_path, recordPath);
});

test('persistRepoAdminTeamTopology appends the repo-admin node when missing', () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-admin-topology-append-'));
  const recordPath = path.join(registryDir, 'contosouk.json');
  fs.writeFileSync(recordPath, JSON.stringify(buildRegistryRecord({
    structure: [
      { team: 'contosouk-root', parent: null, type: 'root' },
      { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
    ],
  }), null, 2), 'utf8');

  const result = persistRepoAdminTeamTopology({
    tenantKey: 'contosouk',
    teamSlug: 'contosouk-repo-admin',
    parentTeamSlug: 'contosouk-root',
    registryDirectory: registryDir,
  });
  assert.equal(result.status, 'appended');

  const updated = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const repoAdminNode = updated.topology.teams.structure.find((node) => node.type === 'repo-admin');
  assert.deepEqual(repoAdminNode, {
    team: 'contosouk-repo-admin',
    parent: 'contosouk-root',
    type: 'repo-admin',
  });
});

test('persistRepoAdminTeamTopology fails cleanly for an unknown tenant', () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-admin-topology-missing-'));
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify(buildRegistryRecord(), null, 2),
    'utf8'
  );

  const result = persistRepoAdminTeamTopology({
    tenantKey: 'unknown-tenant',
    teamSlug: 'unknown-tenant-repo-admin',
    parentTeamSlug: 'unknown-tenant-root',
    registryDirectory: registryDir,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_reason, 'tenant_record_not_found');
});
