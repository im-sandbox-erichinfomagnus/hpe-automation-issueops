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

// Phase 5 (US3) Non-Regression Tests

const { validateTenantCreationRequest } = require('../../src/workflow-support/validate-tenant-creation-request');

function buildValidParsedRequest(overrides = {}) {
  return {
    organization: 'octo-org',
    tenant_name: 'Acme Platform',
    tenant_admin_login: 'tenant-admin-user',
    tenant_type: 'application',
    governance_code_scanning_enabled: 'true',
    governance_secret_scanning_enabled: 'true',
    governance_dependabot_enabled: 'true',
    cmdb_id: 'CMDB-001',
    cost_center: 'CC-001',
    business_unit: 'platform',
    environment: 'nonprod',
    primary_contact: 'owner@example.com',
    secondary_contact: 'secondary@example.com',
    designated_approver: 'org-owner-user',
    dry_run: 'true',
    justification: 'Bootstrap tenant',
    ...overrides,
  };
}

function baseValidationOptions(overrides = {}) {
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => {
      if (username === 'org-owner-user') {
        return {
          exists: true,
          membership: { role: 'admin', state: 'active' },
        };
      }

      return {
        exists: true,
        membership: { role: 'admin', state: 'active' },
      };
    },
    listTeams: async () => [],
    ...overrides,
  };
}

test('T029: validateTenantCreationRequest preserves approval-gate semantics with CICD enhancement', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5002, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.designated_approver_authorization.state, 'not_applicable');
  assert.equal(validation.designated_approver_authorization.role, 'not_applicable');
});

// Renamed: this never exercised CICD team addition. It passed because the requester was
// not an organization owner, which is no longer a reason to reject. What it usefully
// covers now is that the legacy designated_approver value has no influence: the form does
// not collect one, and approval is routed by tenant_admin_login.
test('T029: validateTenantCreationRequest ignores a legacy designated approver value', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({ designated_approver: 'non-admin-user' }),
    issue: { number: 5003, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, {
    ...baseValidationOptions(),
    getOrganizationMembership: async ({ username }) => {
      if (username === 'org-owner-user') {
        return { exists: true, membership: { role: 'admin', state: 'active' } };
      }
      if (username === 'non-admin-user') {
        return { exists: true, membership: { role: 'member', state: 'active' } };
      }
      return { exists: true, membership: { role: 'member', state: 'active' } };
    },
  });

  assert.equal(validation.is_valid, true, JSON.stringify(validation.errors));
  assert.equal(validation.request_status, 'awaiting_approval');
  // A stale designated approver neither authorizes nor blocks anything.
  assert.equal(validation.designated_approver_authorization.state, 'not_applicable');
  assert.ok(
    !validation.errors.some((error) => /designated approver/i.test(error)),
    'the legacy designated approver value must not produce a validation error'
  );
});

test('T031: validateTenantCreationRequest preserves dry-run semantics with CICD capability intent', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({ dry_run: 'true' }),
    issue: { number: 5004, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.validation_findings.dry_run_no_mutation, true);
  assert.match(validation.warnings.join('\n'), /Dry-run is enabled/i);
});

test('T029: validateTenantCreationRequest rejects unsafe org-wide CICD privilege expansion', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5005, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  request.cicd_capability_intent = {
    requested: true,
    requires_broad_org_scope: true,
    requires_org_owner_grant: true,
  };

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /broad org-wide privilege expansion/i);
});

test('T031C: parseTenantCreationRequest preserves baseline request_id field unchanged', () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5006, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
    runContext: { run_id: '1000', run_attempt: '1' },
  });

  assert.ok(request.request_id);
  assert.match(request.request_id, /octo-org\/issueops-speckit#5006/);
});

test('T031C: validateTenantCreationRequest requires the requester to be an active organization member', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5007, user: { login: 'non-member-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, {
    ...baseValidationOptions(),
    getOrganizationMembership: async ({ username }) => {
      if (username === 'org-owner-user') {
        return {
          exists: true,
          membership: { role: 'admin', state: 'active' },
        };
      }
      if (username === 'non-member-user') {
        return {
          exists: false,
          membership: null,
        };
      }

      return {
        exists: true,
        membership: { role: 'member', state: 'active' },
      };
    },
  });

  // Widening the gate to any active member did not widen it to anyone: a login that is
  // not an organization member at all is still refused.
  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /must be an active member/i);
  assert.equal(validation.validation_findings.requester_membership_gate, 'unauthorized');
});

test('T031C: validateTenantCreationRequest does not break governance flag validation with CICD team', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({
      governance_code_scanning_enabled: 'true',
      governance_secret_scanning_enabled: 'true',
      governance_dependabot_enabled: 'true',
    }),
    issue: { number: 5008, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.ok(validation.request);
});

test('T031B: validateTenantCreationRequest confirms no repository creation mutation paths invoked by this feature', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5009, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.ok(!validation.request.requested_repositories || validation.request.requested_repositories.length === 0);
  assert.ok(!validation.request.repository_visibility);
});

test('T031A: validateTenantCreationRequest confirms no branch/tag/push ruleset mutation paths invoked', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5010, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.ok(!validation.request.branch_protection_rules);
  assert.ok(!validation.request.tag_protection_rules);
  assert.ok(!validation.request.push_rulesets);
});

test('T031B: validateTenantCreationRequest confirms no tenant-boundary hardening mutations outside scoped CICD enhancement', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 5011, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.ok(!validation.request.boundary_enforcement_policies);
  assert.ok(!validation.request.security_policies);
  assert.ok(!validation.request.audit_log_settings);
});
