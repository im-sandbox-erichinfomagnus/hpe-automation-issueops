'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  persistTenantSubteamTopology,
  reconcileTenantSubteamCreation,
} = require('../../src/workflow-support/reconcile-tenant-subteam-creation');

function validatedTeam(name, slug, overrides = {}) {
  return {
    requested_name: name,
    base_slug: slug.replace(/^contosouk-/, ''),
    normalized_slug: slug,
    source_row_number: null,
    validation_status: 'valid',
    current_state: 'absent',
    desired_action: 'create_team',
    execution_result: 'not_started',
    failure_reason: null,
    ...overrides,
  };
}

test('missing subteams are planned for creation with root maintainers assigned', () => {
  const plan = reconcileTenantSubteamCreation({
    request: { intake_mode: 'manual', dry_run: false },
    validatedTeams: [
      validatedTeam('Payments', 'contosouk-payments'),
      validatedTeam('Portal Web', 'contosouk-portal-web'),
    ],
    rootTeamMaintainers: ['Tenant-Admin-One', 'tenant-admin-two', 'tenant-admin-one'],
    parent_team_slug: 'contosouk-root',
    parent_team_id: 101,
    tenant_root_team_slug: 'contosouk-root',
    tenant_root_team_id: 101,
    dry_run: false,
  });

  assert.equal(plan.teams_to_create.length, 2);
  assert.deepEqual(plan.maintainers_to_assign, ['tenant-admin-one', 'tenant-admin-two']);
  assert.equal(plan.parent_team_slug, 'contosouk-root');
  assert.equal(plan.state, 'approved_for_execution');
});

test('existing subteams converge as noop and skip maintainer assignment', () => {
  const plan = reconcileTenantSubteamCreation({
    request: { intake_mode: 'manual', dry_run: false },
    validatedTeams: [
      validatedTeam('Payments', 'contosouk-payments', { current_state: 'present', desired_action: 'noop' }),
    ],
    rootTeamMaintainers: ['tenant-admin-one'],
    parent_team_slug: 'contosouk-root',
    parent_team_id: 101,
    dry_run: false,
  });

  assert.equal(plan.teams_to_create.length, 0);
  assert.equal(plan.teams_already_present.length, 1);
  assert.deepEqual(plan.maintainers_to_assign, []);
  assert.equal(plan.state, 'validated');
});

test('invalid entries are rejected and dry-run keeps the plan in validated state', () => {
  const plan = reconcileTenantSubteamCreation({
    request: { intake_mode: 'manual', dry_run: true },
    validatedTeams: [
      validatedTeam('Payments', 'contosouk-payments'),
      validatedTeam('???', '', { validation_status: 'invalid', failure_reason: 'invalid_team_name' }),
    ],
    rootTeamMaintainers: ['tenant-admin-one'],
    parent_team_slug: 'contosouk-root',
    parent_team_id: 101,
    dry_run: true,
  });

  assert.equal(plan.teams_rejected.length, 1);
  assert.equal(plan.teams_to_create.length, 1);
  assert.equal(plan.state, 'validated');
});

function buildRegistryRecord() {
  return {
    tenantId: 'contosouk',
    tenantName: 'ContosoUK',
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
  };
}

test('persistTenantSubteamTopology appends new subteam nodes and skips existing ones', () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-topology-'));
  const recordPath = path.join(registryDir, 'contosouk.json');
  fs.writeFileSync(recordPath, JSON.stringify(buildRegistryRecord(), null, 2), 'utf8');

  const firstResult = persistTenantSubteamTopology({
    tenantKey: 'contosouk',
    parentTeamSlug: 'contosouk-root',
    subteamSlugs: ['contosouk-payments', 'contosouk-portal-web'],
    registryDirectory: registryDir,
  });
  assert.equal(firstResult.status, 'appended');
  assert.equal(firstResult.appended_count, 2);

  const updated = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const subteamNodes = updated.topology.teams.structure.filter((node) => node.type === 'subteam');
  assert.deepEqual(subteamNodes, [
    { team: 'contosouk-payments', parent: 'contosouk-root', type: 'subteam' },
    { team: 'contosouk-portal-web', parent: 'contosouk-root', type: 'subteam' },
  ]);

  const secondResult = persistTenantSubteamTopology({
    tenantKey: 'contosouk',
    parentTeamSlug: 'contosouk-root',
    subteamSlugs: ['contosouk-payments'],
    registryDirectory: registryDir,
  });
  assert.equal(secondResult.status, 'noop');
});

test('persistTenantSubteamTopology fails cleanly for an unknown tenant', () => {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-topology-missing-'));
  fs.writeFileSync(
    path.join(registryDir, 'contosouk.json'),
    JSON.stringify(buildRegistryRecord(), null, 2),
    'utf8'
  );

  const result = persistTenantSubteamTopology({
    tenantKey: 'unknown-tenant',
    parentTeamSlug: 'unknown-tenant-root',
    subteamSlugs: ['unknown-tenant-payments'],
    registryDirectory: registryDir,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_reason, 'tenant_record_not_found');
});
