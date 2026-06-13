'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTenantCreationRequest, projectLegacyTenantRecord } = require('../../src/workflow-support/parse-tenant-creation-request');
const { mapLegacyLifecycleStatus } = require('../../src/scripts/run-request-validation');

const legacyFixturePath = path.resolve(__dirname, '../fixtures/create-tenant-model/legacy-tenant-record.json');
const legacyRecord = JSON.parse(fs.readFileSync(legacyFixturePath, 'utf8'));

test('projectLegacyTenantRecord projects flat legacy fields into canonical topology context', () => {
  const projected = projectLegacyTenantRecord(legacyRecord);

  assert.equal(projected.tenant_id, 'legacy-corp');
  assert.equal(projected.tenant_name, 'Legacy Corp');
  assert.equal(projected.topology.organization.orgName, 'im-sandbox-himanshu');
  assert.equal(projected.topology.teams.tenantRootTeam, 'legacy-corp-root');
  assert.equal(projected.lifecycle_status_equivalent, 'active');
  assert.equal(projected.compatibility_mode, 'legacy_projection');
});

test('parseTenantCreationRequest supports dual-read compatibility by falling back to legacy record fields', () => {
  const request = parseTenantCreationRequest({
    parsedRequest: {
      organization: '',
      tenant_name: '',
      designated_approver: 'legacy-approver',
      primary_contact: 'owner@example.com',
      dry_run: 'false',
    },
    legacyTenantRecord: legacyRecord,
    issue: {
      number: 219,
      user: { login: 'legacy-requester' },
    },
    repository: 'im-sandbox-himanshu/issueops-speckit',
  });

  assert.equal(request.organization, 'im-sandbox-himanshu');
  assert.equal(request.tenant_display_name, 'Legacy Corp');
  assert.equal(request.tenant_key, 'legacy-corp');
  assert.equal(request.compatibility.mode, 'legacy_projection');
  assert.equal(request.compatibility.lifecycle_status_equivalent, 'active');
  assert.equal(request.compatibility.provenance.source_run_id, 'run-199');
});

test('mapLegacyLifecycleStatus preserves active semantics as active lifecycleStatus', () => {
  assert.equal(mapLegacyLifecycleStatus('active'), 'active');
  assert.equal(mapLegacyLifecycleStatus('ACTIVE'), 'active');
});
