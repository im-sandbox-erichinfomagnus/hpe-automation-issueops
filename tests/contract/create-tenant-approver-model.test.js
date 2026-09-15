'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');
const { validateTenantCreationRequest } = require('../../src/workflow-support/validate-tenant-creation-request');
const {
  evaluateApprovalGate,
  buildPendingApprovalNote,
  buildPendingAttachmentApprovalNote,
  APPROVAL_COMMAND,
} = require('../../src/workflow-support/approval-gate');
const {
  TENANT_SELF_SERVE_OPERATIONS,
  isTenantSelfServeOperation,
  assertTenantSelfServeMutationAllowed,
} = require('../../src/actions/tenant-self-serve-policy');

// Tenant creation approval model:
//   any active organization member may request a tenant; the person named as tenant
//   admin on the request approves it, unless the requester named themselves, in which
//   case an organization owner must approve; an organization owner may approve in any
//   case. Expected logins are literals rather than values read back from the module, so
//   these assert the rule rather than asserting the implementation against itself.
const OWNER_LOGIN = 'org-owner-user';
const MEMBER_LOGIN = 'plain-member-user';
const TENANT_ADMIN_LOGIN = 'tenant-admin-user';
const UNRELATED_LOGIN = 'unrelated-member-user';
const NON_MEMBER_LOGIN = 'non-member-user';
const PENDING_MEMBER_LOGIN = 'pending-invite-user';

function organizationOptions() {
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => {
      if (username === OWNER_LOGIN) {
        return { exists: true, membership: { role: 'admin', state: 'active' } };
      }
      if (username === NON_MEMBER_LOGIN) {
        return { exists: false, membership: null };
      }
      if (username === PENDING_MEMBER_LOGIN) {
        return { exists: true, membership: { role: 'member', state: 'pending' } };
      }
      return { exists: true, membership: { role: 'member', state: 'active' } };
    },
    listTeams: async () => [],
  };
}

function buildRequest(requesterLogin, tenantAdminLogin) {
  return parseTenantCreationRequest({
    parsedRequest: {
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
      tenant_admin_login: tenantAdminLogin,
      dry_run: 'false',
      justification: 'Bootstrap tenant',
    },
    issue: { number: 901, user: { login: requesterLogin } },
    repository: 'octo-org/issueops-speckit',
  });
}

async function approvalBy(request, approverLogin) {
  return evaluateApprovalGate(
    {
      organization: 'octo-org',
      approvalMode: 'tenant_creation',
      tenantAdminLogin: request.tenant_admin_login,
      requesterLogin: request.requester_login,
      issueComments: [
        {
          id: 1,
          body: 'approved',
          created_at: '2026-09-13T10:00:00Z',
          user: { login: approverLogin },
        },
      ],
    },
    organizationOptions()
  );
}

test('a plain organization member may request a tenant', async () => {
  const validation = await validateTenantCreationRequest(
    buildRequest(MEMBER_LOGIN, TENANT_ADMIN_LOGIN),
    organizationOptions()
  );

  assert.equal(validation.is_valid, true, JSON.stringify(validation.errors));
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.validation_findings.requester_membership_gate, 'authorized');
  // The requester is not an owner, and the artifact still records that accurately.
  assert.equal(validation.validation_findings.requester_owner_gate, 'unauthorized');
  assert.ok(
    !validation.errors.some((error) => /must be an active owner/i.test(error)),
    'org ownership must no longer be required to raise a tenant request'
  );
});

test('the tenant admin named on the request approves it', async () => {
  const request = buildRequest(MEMBER_LOGIN, TENANT_ADMIN_LOGIN);
  const decision = await approvalBy(request, TENANT_ADMIN_LOGIN);

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_role, 'tenant_admin');
  assert.equal(decision.approver_authorization_state, 'authorized');
  assert.equal(decision.approver_login, TENANT_ADMIN_LOGIN);
});

test('an organization owner approves a tenant request they did not raise themselves', async () => {
  // Every configuration where the approving owner is not also the requester, including the one
  // where the requester nominated themselves as tenant admin.
  const configurations = [
    [MEMBER_LOGIN, TENANT_ADMIN_LOGIN, 'member requests, names another'],
    [MEMBER_LOGIN, MEMBER_LOGIN, 'member requests, names themselves'],
  ];

  for (const [requester, tenantAdmin, label] of configurations) {
    const decision = await approvalBy(buildRequest(requester, tenantAdmin), OWNER_LOGIN);
    assert.equal(decision.approval_status, 'approved', label);
    assert.equal(decision.approver_role, 'target_org_owner', label);
  }
});

// 1.0.8: an owner who raises the request no longer approves it with their own comment. This is
// NOT a change to the org-owner fast lane - that is policy-driven, fires before any comment is
// read, and still auto-approves a self-nominating owner (376a3bf, Eric's 1.0.6-continuity
// ruling). It only closes the COMMENT route, which an owner reaches solely when the owner gate
// was not established at intake - and in that state we do not have intake evidence that they are
// an owner, so failing closed is the safer reading.
test('an organization owner who raised the request cannot approve it by comment', async () => {
  const configurations = [
    [OWNER_LOGIN, TENANT_ADMIN_LOGIN, 'owner requests, names another'],
    [OWNER_LOGIN, OWNER_LOGIN, 'owner requests, names themselves'],
  ];

  for (const [requester, tenantAdmin, label] of configurations) {
    const decision = await approvalBy(buildRequest(requester, tenantAdmin), OWNER_LOGIN);
    assert.equal(decision.approval_status, 'denied', label);
    assert.equal(decision.requester_self_approval_blocked, true, label);
  }
});

test('a requester who named someone else as tenant admin cannot approve their own request', async () => {
  const request = buildRequest(MEMBER_LOGIN, TENANT_ADMIN_LOGIN);
  const decision = await approvalBy(request, MEMBER_LOGIN);

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_role, 'other');
});

test('self-nomination withholds the tenant admin role so only an owner can approve', async () => {
  const request = buildRequest(MEMBER_LOGIN, MEMBER_LOGIN);
  const validation = await validateTenantCreationRequest(request, organizationOptions());
  assert.equal(validation.validation_findings.requester_self_nominated_tenant_admin, true);

  // The requester is the named tenant admin, and is still refused - now by the self-approval
  // exclusion, which is reached before the tenant-admin role is resolved at all.
  const selfDecision = await approvalBy(request, MEMBER_LOGIN);
  assert.equal(selfDecision.approval_status, 'denied');
  assert.equal(selfDecision.approver_role, 'other');
  assert.equal(selfDecision.requester_self_approval_blocked, true);

  // The self-nomination rule itself still holds: the named tenant admin carries no authority
  // when they are the requester, so a DIFFERENT member cannot be waved through as tenant_admin
  // either. Without this the previous assertion would be the only thing keeping the rule honest.
  const otherMemberDecision = await approvalBy(request, UNRELATED_LOGIN);
  assert.equal(otherMemberDecision.approval_status, 'denied');
  assert.equal(otherMemberDecision.approver_role, 'other');

  // An owner remains able to approve it.
  const ownerDecision = await approvalBy(request, OWNER_LOGIN);
  assert.equal(ownerDecision.approval_status, 'approved');
  assert.equal(ownerDecision.approver_role, 'target_org_owner');
});

test('an unrelated organization member cannot approve in any configuration', async () => {
  const configurations = [
    [MEMBER_LOGIN, TENANT_ADMIN_LOGIN, 'member requests, names another'],
    [MEMBER_LOGIN, MEMBER_LOGIN, 'member requests, names themselves'],
    [OWNER_LOGIN, TENANT_ADMIN_LOGIN, 'owner requests, names another'],
    [OWNER_LOGIN, OWNER_LOGIN, 'owner requests, names themselves'],
  ];

  for (const [requester, tenantAdmin, label] of configurations) {
    const decision = await approvalBy(buildRequest(requester, tenantAdmin), UNRELATED_LOGIN);
    assert.equal(decision.approval_status, 'denied', label);
    assert.equal(decision.approver_role, 'other', label);
  }
});

test('a requester who is not an active organization member is still rejected', async () => {
  for (const requester of [NON_MEMBER_LOGIN, PENDING_MEMBER_LOGIN]) {
    const validation = await validateTenantCreationRequest(
      buildRequest(requester, TENANT_ADMIN_LOGIN),
      organizationOptions()
    );

    assert.equal(validation.is_valid, false, requester);
    assert.equal(validation.validation_findings.requester_membership_gate, 'unauthorized', requester);
    assert.match(validation.errors.join('\n'), /must be an active member/i);
  }
});

test('tenant creation is not a self-serve operation and the others are unchanged', async () => {
  assert.equal(
    isTenantSelfServeOperation('tenant_creation'),
    false,
    'tenant creation is approved by the tenant admin or an owner, so it is not self-serve'
  );

  for (const operation of [
    'cicd_admin_membership',
    'repo_admin_membership',
    'tenant_subteam_creation',
    'org_variable_management',
    'tenant_repo_creation',
  ]) {
    assert.equal(isTenantSelfServeOperation(operation), true, operation);
  }

  assert.equal(TENANT_SELF_SERVE_OPERATIONS.length, 5);
});

test('tenant creation execution still requires approval and an organization-mutating token', async () => {
  const adequateToken = { token: 'pat', is_pat_backed: true, supports_org_mutation: true };

  // The only combination that may mutate.
  assert.equal(
    assertTenantSelfServeMutationAllowed({
      approval_status: 'approved',
      dry_run: false,
      tokenInfo: adequateToken,
    }).allowed,
    true
  );

  // Removing tenant creation from the self-serve list must not have opened a path around
  // the token and approval guards, which execution selects by operation, not by the list.
  for (const tokenInfo of [
    { token: 'pat', is_pat_backed: false, supports_org_mutation: true },
    { token: 'pat', is_pat_backed: true, supports_org_mutation: false },
    { token: '', is_pat_backed: true, supports_org_mutation: true },
  ]) {
    assert.throws(
      () => assertTenantSelfServeMutationAllowed({ approval_status: 'approved', dry_run: false, tokenInfo }),
      /blocked/i
    );
  }

  for (const approvalStatus of ['pending', 'denied', 'awaiting_approval']) {
    assert.throws(
      () =>
        assertTenantSelfServeMutationAllowed({
          approval_status: approvalStatus,
          dry_run: false,
          tokenInfo: adequateToken,
        }),
      /blocked because request status is/i
    );
  }

  assert.equal(
    assertTenantSelfServeMutationAllowed({
      approval_status: 'approved',
      dry_run: true,
      tokenInfo: adequateToken,
    }).allowed,
    false
  );
});

// The note a waiting approver actually reads. Piece 4 rewrote the approved and denied
// notes for the new model and left both pending notes saying only an organization owner
// could authorize - which tells the named tenant admin, the very person the request is
// waiting on, that they are the wrong person. Asserted against the rule, not against the
// module's own string.
function assertNamesBothAuthorities(note, label) {
  assert.match(note, /tenant admin/i, `${label} must name the tenant admin as an authority`);
  assert.match(note, /organization owner/i, `${label} must still name the organization owner`);
  assert.doesNotMatch(
    note,
    /from the designated active target organization owner to authorize/i,
    `${label} must not name the organization owner as the only authority`
  );
}

test('the pending approval note tells a tenant creation requester who can actually approve', () => {
  const note = buildPendingApprovalNote('tenant_creation', APPROVAL_COMMAND);
  assertNamesBothAuthorities(note, 'the manual-intake pending note');
  assert.match(
    note,
    /named themselves|names themselves/i,
    'the manual-intake pending note should say what happens when the requester self-nominates'
  );
});

test('the attachment pending approval note names the same authorities', () => {
  const note = buildPendingAttachmentApprovalNote('tenant_creation', APPROVAL_COMMAND);
  assertNamesBothAuthorities(note, 'the csv_attachment pending note');
});

test('the pending note for other operations is unchanged by the tenant creation wording', () => {
  // Only tenant_creation routes to a named tenant admin. Every other mode must keep its
  // own authority wording, so this fails if the fix is applied too widely.
  assert.match(
    buildPendingApprovalNote('team_hierarchy', APPROVAL_COMMAND),
    /designated hierarchy approver/i
  );
  assert.match(
    buildPendingApprovalNote('team_creation', APPROVAL_COMMAND),
    /active intended owner/i
  );
  assert.match(
    buildPendingApprovalNote('tenant_repo_creation', APPROVAL_COMMAND),
    /designated active target organization owner/i
  );
  assert.doesNotMatch(
    buildPendingApprovalNote('tenant_repo_creation', APPROVAL_COMMAND),
    /tenant admin/i
  );
});
