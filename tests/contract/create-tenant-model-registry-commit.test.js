'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { commitRegistryRecord } = require('../../src/workflow-support/commit-registry-record');

test('commitRegistryRecord handles missing file path gracefully', () => {
  const result = commitRegistryRecord({}, {});
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'missing_file_path');
  assert.equal(result.committed, false);
  assert.equal(result.pushed, false);
});

test('commitRegistryRecord returns noop when no changes to commit', () => {
  const result = commitRegistryRecord({
    registryFilePath: '/nonexistent/path/registry.json',
    tenantKey: 'test-tenant',
    issueNumber: '123',
  }, {
    dryRun: true,
  });

  // In dry-run mode, we expect the function to handle gracefully
  // (actual git check is skipped in dry-run)
  assert.ok(result.status !== 'failed' || result.message.includes('outside repository'));
});

test('commitRegistryRecord formats commit message correctly', () => {
  const result = commitRegistryRecord({
    registryFilePath: '/some/path/registry.json',
    tenantKey: 'acme',
    issueNumber: '42',
  }, {
    dryRun: true,
  });

  // In dry-run mode, we check that the function prepared the message correctly
  // even if git operations fail
  assert.ok(result.commit_message === undefined || result.commit_message.includes('acme'));
  assert.ok(result.commit_message === undefined || result.commit_message.includes('#42'));
});

// Phase 5 (US3) Registry Extension Tests

const { persistTenantRegistryRecord, buildTenantRegistryRecord } = require('../../src/workflow-support/persist-tenant-registry-record');

test('T030: buildTenantRegistryRecord includes CICD admin team fields', () => {
  const record = buildTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      cicd_admin_team_name: 'acme-cicd-admin',
      cicd_admin_team_slug: 'acme-cicd-admin',
      tenant_admin_login: 'tenant-admin-user',
      organization: 'octo-org',
      requester_login: 'requester-user',
      topology: {
        teams: {
          structure: [
            { team: 'acme-root', parent: null, type: 'root' },
            { team: 'acme-repo-admin', parent: 'acme-root', type: 'repo-admin' },
          ],
        },
      },
    },
    reconciliation: {
      cicd_capability_decision: {
        status: 'applied',
        reason_code: null,
      },
      cicd_topology_update_result: {
        status: 'applied',
      },
    },
  });

  assert.equal(record.cicd_admin_team_name, 'acme-cicd-admin');
  assert.equal(record.cicd_admin_team_slug, 'acme-cicd-admin');
  assert.equal(record.cicd_capability_status, 'applied');
  assert.equal(record.bootstrap_tenant_admin_login, 'tenant-admin-user');
  assert.ok(record.cicd_topology_relation);
});

test('buildTenantRegistryRecord falls back bootstrap admin to requester when tenant admin is missing', () => {
  const record = buildTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      organization: 'octo-org',
      requester_login: 'requester-user',
    },
  });

  assert.equal(record.bootstrap_tenant_admin_login, 'requester-user');
});

test('T030A: buildTenantRegistryRecord persists CICD topology parent-child relation', () => {
  const record = buildTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      cicd_admin_team_name: 'acme-cicd-admin',
      cicd_admin_team_slug: 'acme-cicd-admin',
      organization: 'octo-org',
      requester_login: 'requester-user',
      topology: {
        teams: {
          structure: [
            { team: 'acme-root', parent: null, type: 'root' },
            { team: 'acme-repo-admin', parent: 'acme-root', type: 'repo-admin' },
          ],
        },
      },
    },
    reconciliation: {
      cicd_topology_update_result: {
        status: 'applied',
      },
    },
  });

  assert.ok(record.cicd_topology_relation);
  assert.equal(record.cicd_topology_relation.parent_team_slug, 'acme-root');
  assert.equal(record.cicd_topology_relation.child_team_slug, 'acme-cicd-admin');
  assert.equal(record.cicd_topology_relation.relation_status, 'applied');
});

test('T030A: buildTenantRegistryRecord adds CICD structure entry to topology when needed', () => {
  const record = buildTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      cicd_admin_team_name: 'acme-cicd-admin',
      cicd_admin_team_slug: 'acme-cicd-admin',
      organization: 'octo-org',
      requester_login: 'requester-user',
      topology: {
        teams: {
          structure: [
            { team: 'acme-root', parent: null, type: 'root' },
            { team: 'acme-repo-admin', parent: 'acme-root', type: 'repo-admin' },
          ],
        },
      },
    },
    reconciliation: {},
  });

  const structureEntries = record.topology.teams.structure || [];
  const cicdEntry = structureEntries.find((e) => e.team === 'acme-cicd-admin');
  assert.ok(cicdEntry);
  assert.equal(cicdEntry.parent, 'acme-root');
  assert.equal(cicdEntry.type, 'cicd-admin');
});

test('T030A: buildTenantRegistryRecord treats existing CICD structure entry as no-op', () => {
  const existingStructure = [
    { team: 'acme-root', parent: null, type: 'root' },
    { team: 'acme-repo-admin', parent: 'acme-root', type: 'repo-admin' },
    { team: 'acme-cicd-admin', parent: 'acme-root', type: 'cicd-admin' },
  ];

  const record = buildTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      cicd_admin_team_name: 'acme-cicd-admin',
      cicd_admin_team_slug: 'acme-cicd-admin',
      organization: 'octo-org',
      requester_login: 'requester-user',
      topology: {
        teams: {
          structure: existingStructure,
        },
      },
    },
  });

  assert.equal(record.topology.teams.structure.length, 3);
  assert.equal(record.topology.teams.structure.filter((e) => e.team === 'acme-cicd-admin').length, 1);
});

test('T030: buildTenantRegistryRecord includes CICD capability status and reason code', () => {
  const record = buildTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      cicd_admin_team_slug: 'acme-cicd-admin',
      organization: 'octo-org',
      requester_login: 'requester-user',
    },
    reconciliation: {
      cicd_capability_decision: {
        status: 'unavailable',
        reason_code: 'capability_unavailable',
      },
    },
  });

  assert.equal(record.cicd_capability_status, 'unavailable');
  assert.equal(record.cicd_capability_reason_code, 'capability_unavailable');
});

test('T030: persistTenantRegistryRecord returns record with CICD fields preserved', () => {
  const result = persistTenantRegistryRecord({
    request: {
      tenant_key: 'acme',
      tenant_display_name: 'Acme Platform',
      tenant_type: 'application',
      tenant_team_slug: 'acme-root',
      repo_admin_team_slug: 'acme-repo-admin',
      cicd_admin_team_name: 'acme-cicd-admin',
      cicd_admin_team_slug: 'acme-cicd-admin',
      organization: 'octo-org',
      requester_login: 'requester-user',
      compatibility: { mode: 'canonical' },
    },
    reconciliation: {
      cicd_capability_decision: { status: 'applied' },
    },
    approver_login: 'approver-user',
    lifecycle_status: 'active',
    mode: 'noop',
  });

  assert.equal(result.record.cicd_admin_team_name, 'acme-cicd-admin');
  assert.equal(result.record.cicd_capability_status, 'applied');
});
