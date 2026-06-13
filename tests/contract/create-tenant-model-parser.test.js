'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');

test('parseTenantCreationRequest derives canonical tenant type and topology structure for US1', () => {
  const request = parseTenantCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      tenant_type: 'platform',
      governance_code_scanning_enabled: 'true',
      governance_secret_scanning_enabled: 'true',
      governance_dependabot_enabled: 'false',
      cmdb_id: 'CMDB-900',
      cost_center: 'CC-900',
      business_unit: 'platform',
      environment: 'prod',
      primary_contact: 'owner@example.com',
      secondary_contact: 'secondary@example.com',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Need canonical topology',
    },
    issue: { number: 1201, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.tenant_type, 'platform');
  assert.equal(request.topology.organization.orgName, 'octo-org');
  assert.equal(request.topology.teams.tenantRootTeam, 'acme-platform-root');
  assert.equal(request.topology.teams.structure.length, 3);
  assert.deepEqual(
    request.topology.accessModel.roles,
    ['tenant-admin', 'repo-admin', 'developer', 'viewer']
  );
  assert.equal(request.topology.accessModel.organizationRoleSpecifications.length, 4);
  assert.equal(
    request.topology.accessModel.organizationRoleSpecifications[0].role_name,
    'acme-platform-tenant-admin'
  );
  assert.equal(request.external_mappings.environment, 'prod');
  assert.equal(request.primary_contact, 'owner@example.com');
  assert.equal(request.secondary_contact, 'secondary@example.com');
});

test('parseTenantCreationRequest sanitizes markdown spillover values and mailto links', () => {
  const request = parseTenantCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Makme\n\n### Tenant type\nplatform',
      tenant_type: 'platform',
      governance_code_scanning_enabled: 'true',
      governance_secret_scanning_enabled: 'true',
      governance_dependabot_enabled: 'true',
      cmdb_id: 'CMDB-001',
      cost_center: 'CC-0001',
      business_unit: 'HR',
      environment: 'prod',
      primary_contact: '[himanshu.kumar@infomagnus.com](mailto:himanshu.kumar@infomagnus.com)',
      secondary_contact: '[himanshu.kumar@infomagnus.com](mailto:himanshu.kumar@infomagnus.com) (makme-tenant-type-platform-enable-code-scanning-true-enable-secret-scanning-true-enable-dependabot-t)',
      designated_approver: 'himanshu-im',
      dry_run: 'false',
      justification: 'Bootstrap tenant',
    },
    issue: { number: 1301, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.tenant_display_name, 'Makme');
  assert.equal(request.tenant_key, 'makme');
  assert.equal(request.tenant_team_slug, 'makme-root');
  assert.equal(request.primary_contact, 'himanshu.kumar@infomagnus.com');
  assert.equal(request.secondary_contact, 'himanshu.kumar@infomagnus.com');
});
