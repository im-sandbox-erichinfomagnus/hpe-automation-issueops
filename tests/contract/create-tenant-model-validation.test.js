'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');
const { validateTenantCreationRequest } = require('../../src/workflow-support/validate-tenant-creation-request');
const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { assertTeamHierarchyAllowed } = require('../../src/actions/team-hierarchy-policy');

function buildValidParsedRequest(overrides = {}) {
  return {
    organization: 'octo-org',
    tenant_name: 'Acme Platform',
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
        membership: { role: 'member', state: 'active' },
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
