'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');
const { validateTenantCreationRequest } = require('../../src/workflow-support/validate-tenant-creation-request');
const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { evaluateCicdCapabilityPath } = require('../../src/workflow-support/reconcile-tenant-creation');
const { assertTeamHierarchyAllowed } = require('../../src/actions/team-hierarchy-policy');

function buildValidParsedRequest(overrides = {}) {
  return {
    organization: 'octo-org',
    tenant_name: 'Acme Platform',
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

test('validateTenantCreationRequest passes valid dry-run request and emits no-mutation finding', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 901, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.validation_findings.dry_run_no_mutation, true);
  assert.match(validation.warnings.join('\n'), /Dry-run is enabled/i);
});

test('validateTenantCreationRequest rejects a requester who is not an active organization owner', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 910, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(
    request,
    baseValidationOptions({
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: username === 'org-owner-user' ? 'admin' : 'member',
          state: 'active',
        },
      }),
    })
  );

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Requester must be an active owner/i);
  assert.equal(validation.validation_findings.requester_owner_gate, 'unauthorized');
});

test('validateTenantCreationRequest rejects derived team slug collision', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({
      tenant_name: 'a'.repeat(140),
    }),
    issue: { number: 902, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Derived tenant team slugs conflict/i);
});

test('validateTenantCreationRequest rejects missing organization and tenant name', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({
      organization: '',
      tenant_name: '',
    }),
    issue: { number: 903, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Target organization is required/i);
  assert.match(validation.errors.join('\n'), /Tenant name is required/i);
});

test('validateTenantCreationRequest rejects unsafe tenant key for registry path use', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 904, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.tenant_key = '../unsafe-path';

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /unsafe for tenant-registry path usage/i);
});

test('validateTenantCreationRequest rejects re-parent precondition conflicts', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 905, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTenantCreationRequest(
    request,
    baseValidationOptions({
      listTeams: async () => [
        {
          id: 1,
          slug: request.tenant_team_slug,
        },
        {
          id: 2,
          slug: request.repo_admin_team_slug,
          parent: {
            id: 7,
            slug: 'different-parent-team',
          },
        },
      ],
    })
  );

  assert.equal(validation.is_valid, false);
  assert.equal(validation.validation_findings.hierarchy_precondition, 'reparent_blocked');
  assert.match(validation.errors.join('\n'), /re-parenting is blocked/i);
});

test('parseTenantCreationRequest normalizes tenant topology enhancement fields', () => {
  const parsed = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({
      tenant_type: 'PLATFORM',
      governance_code_scanning_enabled: 'false',
      governance_secret_scanning_enabled: 'true',
      governance_dependabot_enabled: '0',
      environment: 'PROD',
      primary_contact: 'primary@example.com',
      secondary_contact: '',
    }),
    issue: { number: 906, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(parsed.tenant_type, 'platform');
  assert.equal(parsed.external_mappings.environment, 'prod');
  assert.equal(parsed.governance.code_scanning.enabled, false);
  assert.equal(parsed.governance.secret_scanning.enabled, true);
  assert.equal(parsed.governance.dependabot.enabled, false);
  assert.equal(parsed.secondary_contact, null);
  assert.equal(parsed.topology.teams.tenantRootTeam, 'acme-platform-root');
  assert.equal(parsed.topology.teams.structure.length, 4);
});

test('validateTenantCreationRequest rejects CICD slug collision with existing derived slug', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 9092, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.cicd_admin_team_slug = request.repo_admin_team_slug;

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /slugs conflict and must be unique/i);
});

test('validateTenantCreationRequest blocks CICD topology parent-child conflict', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 9093, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.topology.teams.structure = request.topology.teams.structure.map((entry) => {
    if (entry && entry.type === 'cicd-admin') {
      return {
        ...entry,
        parent: 'unexpected-parent',
      };
    }
    return entry;
  });

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /Canonical topology cicd-admin node is invalid/i);
});

test('validateTenantCreationRequest rejects invalid tenant topology enhancement fields', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest({
      primary_contact: 'not-an-email',
      secondary_contact: 'invalid',
    }),
    issue: { number: 907, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.tenant_type = 'unknown';
  request.external_mappings.environment = 'qa';

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /tenant_type must be one of/i);
  assert.match(validation.errors.join('\n'), /environment must be one of/i);
  assert.match(validation.errors.join('\n'), /primary_contact is required/i);
  assert.match(validation.errors.join('\n'), /secondary_contact is optional/i);
  assert.equal(validation.validation_findings.tenant_type_validation, 'invalid');
  assert.equal(validation.validation_findings.environment_validation, 'invalid');
});

test('validateTenantCreationRequest rejects non-mandatory governance policy flags', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 908, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.governance.code_scanning.mandatory = false;

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /must remain true/i);
  assert.equal(validation.validation_findings.governance_mandatory_validation, 'invalid');
});

test('validateTenantCreationRequest rejects non-canonical accessModel enforcement', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 909, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.topology.accessModel.enforcement = 'org-wide';

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /accessModel must enforce tenant-boundary/i);
  assert.equal(validation.validation_findings.access_model_validation, 'invalid');
});

test('validateTenantCreationRequest rejects missing organization role specifications', async () => {
  const request = parseTenantCreationRequest({
    parsedRequest: buildValidParsedRequest(),
    issue: { number: 9091, user: { login: 'requester-user' } },
    repository: 'octo-org/issueops-speckit',
  });
  request.topology.accessModel.organizationRoleSpecifications = [];

  const validation = await validateTenantCreationRequest(request, baseValidationOptions());

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /organizationRoleSpecifications/i);
  assert.equal(validation.validation_findings.organization_role_spec_validation, 'invalid');
});

test('evaluateApprovalGate approves tenant creation only for designated active target-org owner', async () => {
  const decision = await evaluateApprovalGate(
    {
      organization: 'octo-org',
      designatedApproverLogin: 'org-owner-user',
      approvalMode: 'tenant_creation',
      issueComments: [
        {
          id: 1,
          body: 'approved',
          created_at: '2026-05-26T10:00:00Z',
          user: { login: 'org-owner-user' },
        },
      ],
    },
    {
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          state: 'active',
          role: username === 'org-owner-user' ? 'admin' : 'member',
        },
      }),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_role, 'target_org_owner');
  assert.equal(decision.approver_authorization_state, 'authorized');
});

test('tenant bootstrap guard fails closed when workflow token is missing', () => {
  assert.throws(
    () =>
      assertTeamHierarchyAllowed({
        approval_status: 'approved',
        approver_login: 'org-owner-user',
        designated_approver_login: 'org-owner-user',
        approver_authorization_state: 'authorized',
        dry_run: false,
        tokenInfo: {
          token: '',
          source: 'GITHUB_TOKEN',
          is_pat_backed: false,
          token_kind: 'github_token',
          supports_team_hierarchy_mutation: false,
        },
      }),
    /no workflow token is available/i
  );
});

test('tenant bootstrap guard fails closed when token is not PAT-backed for hierarchy mutation', () => {
  assert.throws(
    () =>
      assertTeamHierarchyAllowed({
        approval_status: 'approved',
        approver_login: 'org-owner-user',
        designated_approver_login: 'org-owner-user',
        approver_authorization_state: 'authorized',
        dry_run: false,
        tokenInfo: {
          token: 'github-token',
          source: 'GITHUB_TOKEN',
          is_pat_backed: false,
          token_kind: 'github_token',
          supports_team_hierarchy_mutation: false,
        },
      }),
    /not PAT-backed for org mutation/i
  );
});

test('evaluateCicdCapabilityPath selects primary path when prerequisites are satisfied', () => {
  const decision = evaluateCicdCapabilityPath({
    requested: true,
    primary_path_available: true,
    primary_policy_approved: true,
    fallback_path_available: true,
    fallback_policy_approved: true,
    tenant_scope_resolvable: true,
  });

  assert.equal(decision.selected_path, 'primary');
  assert.equal(decision.status, 'applied');
  assert.equal(decision.reason_code, null);
});

test('evaluateCicdCapabilityPath selects fallback when primary is unavailable', () => {
  const decision = evaluateCicdCapabilityPath({
    requested: true,
    primary_path_available: false,
    primary_policy_approved: false,
    fallback_path_available: true,
    fallback_policy_approved: true,
    tenant_scope_resolvable: true,
  });

  assert.equal(decision.selected_path, 'fallback');
  assert.equal(decision.status, 'applied');
  assert.equal(decision.reason_code, null);
});

test('evaluateCicdCapabilityPath selects none when no safe path exists', () => {
  const decision = evaluateCicdCapabilityPath({
    requested: true,
    primary_path_available: false,
    primary_policy_approved: false,
    fallback_path_available: false,
    fallback_policy_approved: false,
    tenant_scope_resolvable: false,
  });

  assert.equal(decision.selected_path, 'none');
  assert.equal(decision.status, 'unavailable');
  assert.equal(decision.reason_code, 'capability_unavailable');
});
