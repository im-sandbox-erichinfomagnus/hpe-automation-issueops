'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { readTopologyView } = require('../../src/workflow-support/resolve-tenant-cicd-context-from-registry');

// acme.json ships with a structure array that carries only the cicd-admin node while
// the root/repo-admin/cicd slugs live in the record's flat fields.
const SPARSE_STRUCTURE_RECORD = {
  tenantId: 'acme',
  tenantName: 'Acme Platform',
  organization: 'octo-org',
  tenant_team_slug: 'acme-root',
  repo_admin_team_slug: 'acme-repo-admin',
  cicd_admin_team_slug: 'acme-cicd-admin',
  topology: {
    organization: { orgName: 'octo-org' },
    teams: {
      structure: [
        { team: 'acme-cicd-admin', parent: 'acme-root', type: 'cicd-admin' },
      ],
    },
  },
};

const COMPLETE_STRUCTURE_RECORD = {
  tenantId: 'contosouk',
  tenantName: 'ContosoUK',
  organization: 'octo-org',
  // Flat fields deliberately disagree with the structure; the structure must win.
  tenant_team_slug: 'stale-root',
  admin_team_slug: 'stale-admin',
  repo_admin_team_slug: 'stale-repo-admin',
  cicd_admin_team_slug: 'stale-cicd-admin',
  topology: {
    organization: { orgName: 'octo-org' },
    teams: {
      tenantRootTeam: 'contosouk-root',
      structure: [
        { team: 'contosouk-root', parent: null, type: 'root' },
        { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
        { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
        { team: 'contosouk-cicd-admin', parent: 'contosouk-root', type: 'cicd-admin' },
      ],
    },
  },
};

test('a sparse topology structure falls back to the record flat team fields', () => {
  const view = readTopologyView(SPARSE_STRUCTURE_RECORD);

  assert.equal(view.schema, 'canonical');
  assert.equal(view.tenant_root_team_slug, 'acme-root');
  assert.equal(view.repo_admin_team_slug, 'acme-repo-admin');
  assert.equal(view.cicd_admin_team_slug, 'acme-cicd-admin');
});

test('a complete topology structure ignores stale flat team fields', () => {
  const view = readTopologyView(COMPLETE_STRUCTURE_RECORD);

  assert.equal(view.tenant_root_team_slug, 'contosouk-root');
  assert.equal(view.admin_team_slug, 'contosouk-admin');
  assert.equal(view.repo_admin_team_slug, 'contosouk-repo-admin');
  assert.equal(view.cicd_admin_team_slug, 'contosouk-cicd-admin');
});

test('the shipped tenant-registry/acme.json record resolves to real team slugs', () => {
  const recordPath = path.join(__dirname, '..', '..', 'tenant-registry', 'acme.json');
  const view = readTopologyView(JSON.parse(fs.readFileSync(recordPath, 'utf8')));

  assert.notEqual(view.tenant_root_team_slug, '', 'root team must resolve');
  assert.notEqual(view.cicd_admin_team_slug, '', 'cicd-admin team must resolve');
  assert.equal(view.tenant_root_team_slug, 'acme-root');
  assert.equal(view.cicd_admin_team_slug, 'acme-cicd-admin');
});
