'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateCicdAdminMembershipRequest } = require('../../src/workflow-support/validate-cicd-admin-membership-request');
const { validateRepoAdminMembershipRequest } = require('../../src/workflow-support/validate-repo-admin-membership-request');
const { resolveTenantRoleTeamApprover } = require('../../src/workflow-support/resolve-tenant-role-team-approver');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { assertTenantSelfServeMutationAllowed } = require('../../src/actions/tenant-self-serve-policy');

// Every fixture below is a 1.0.7 audit artifact captured from a real run on the sandbox,
// not a hand-built shape. #225 is the one that matters: a requester holding no tenant role,
// rejected at validation before any approval was ever requested. It is the exact case the
// customer reported and the exact case 1.0.8 has to route instead of reject.
const LIVE_DIRECTORY = path.join(__dirname, '..', 'fixtures', 'live-artifacts');
const LIVE_224 = 'add-cicd-admin-to-tenant-validation-224.json';
const LIVE_225 = 'add-cicd-admin-to-tenant-validation-225.json';
const LIVE_226 = 'add-repo-admin-to-tenant-validation-226.json';
const LIVE_227 = 'add-cicd-admin-to-tenant-validation-227.json';

function liveArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(LIVE_DIRECTORY, name), 'utf8'));
}

function membership(state, role) {
  return { state, membership: role ? { role } : null };
}

// The registry is the one input the audit artifact does not carry, so it is rebuilt from
// the tenant context the live run recorded rather than invented alongside it.
function registryFromLiveArtifact(artifact, prefix) {
  const context = artifact.validation.canonical_tenant_context;
  const tenantKey = context.tenant_key;
  const rootTeam = context.tenant_team_slug;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(directory, `${tenantKey}.json`), JSON.stringify({
    tenantId: tenantKey,
    tenantName: context.tenant_display_name,
    tenantType: 'application',
    organization: context.organization,
    topology: {
      organization: { orgName: context.organization },
      teams: {
        tenantRootTeam: rootTeam,
        structure: [
          { team: rootTeam, parent: null, type: 'root' },
          { team: `${tenantKey}-admin`, parent: rootTeam, type: 'admin' },
          { team: `${tenantKey}-repo-admin`, parent: rootTeam, type: 'repo-admin' },
          { team: `${tenantKey}-cicd-admin`, parent: rootTeam, type: 'cicd-admin' },
        ],
      },
    },
  }, null, 2), 'utf8');
  return directory;
}

function validationOptions(artifact, prefix, teamMemberships, organizationRoles) {
  return {
    registryDirectory: registryFromLiveArtifact(artifact, prefix),
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async ({ teamSlug }) => ({ exists: true, team: { id: 101, slug: teamSlug } }),
    getMembershipForUser: async ({ teamSlug, username }) =>
      (teamMemberships || {})[`${username}@${teamSlug}`] || { state: 'absent', membership: null },
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: (organizationRoles || {})[username] || 'member', state: 'active' },
    }),
  };
}

// Replays the live request payload through the current validator. The parsed-request fields
// are read off the artifact so the replay cannot drift from what was actually submitted.
async function revalidateCicd(artifact, options = {}) {
  const request = artifact.request;
  return validateCicdAdminMembershipRequest({
    parsedRequest: {
      organization: request.organization,
      tenant_name: request.tenant_name_input,
      cicd_admin_operation: request.cicd_admin_operation,
      intake_mode: request.intake_mode,
      requested_people: request.requested_people_input,
      dry_run: String(request.dry_run),
      business_justification: 'Live-captured request replayed for approval-routing coverage.',
    },
    issue: { number: request.issue_number, user: { login: options.requesterLogin || request.requester_login } },
  }, validationOptions(artifact, 'routed-cicd-', options.teamMemberships, options.organizationRoles));
}

async function revalidateRepo(artifact, options = {}) {
  const request = artifact.request;
  return validateRepoAdminMembershipRequest({
    parsedRequest: {
      organization: request.organization,
      tenant_name: request.tenant_name_input,
      repo_admin_operation: request.repo_admin_operation,
      intake_mode: request.intake_mode,
      requested_people: request.requested_people_input,
      dry_run: String(request.dry_run),
      business_justification: 'Live-captured request replayed for approval-routing coverage.',
    },
    issue: { number: request.issue_number, user: { login: options.requesterLogin || request.requester_login } },
  }, validationOptions(artifact, 'routed-repo-', options.teamMemberships, options.organizationRoles));
}

function writeArtifact(artifact) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'routed-gate-'));
  const artifactPath = path.join(directory, 'validation.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
  return artifactPath;
}

async function gate(artifact, options = {}) {
  return runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact(artifact),
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => options.issueComments || [],
      getMembershipForUser: async ({ teamSlug, username }) =>
        (options.teamMemberships || {})[`${username}@${teamSlug}`] || { state: 'absent', membership: null },
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: { role: (options.organizationRoles || {})[username] || 'member', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });
}

// Composes the artifact the 1.0.8 validator now produces for a live request, the way
// run-request-validation composes it, so the gate is fed a real validator result rather
// than an artifact edited by hand into the shape the gate is hoped to accept.
function artifactFromValidation(artifact, validation) {
  return {
    ...artifact,
    request: validation.request,
    validation,
    approval: {
      approval_status: validation.is_valid ? 'pending' : 'not_requested',
      approver_role: 'other',
    },
  };
}

function approvalComment(login, body) {
  return {
    id: 9001,
    body: body || 'approved',
    created_at: '2026-09-15T10:00:00.000Z',
    user: { login },
  };
}

// ------------------------------------------------------------------ fixture provenance

test('the captured live artifacts still record the 1.0.7 behaviour this work is built on', () => {
  const rejected = liveArtifact(LIVE_225);
  assert.equal(rejected.metadata.operation, 'cicd_admin_membership');
  assert.equal(rejected.validation.is_valid, false);
  assert.equal(rejected.validation.validation_findings.requester_authorization_path, 'none');
  assert.equal(rejected.approval.approval_status, 'not_requested');
  assert.match(rejected.validation.errors[0], /cannot manage CI\/CD admin membership/);

  for (const name of [LIVE_224, LIVE_227]) {
    const holder = liveArtifact(name);
    assert.equal(holder.validation.validation_findings.requester_authorization_path, 'tenant_cicd_admin_team', name);
    assert.equal(holder.approval.approval_status, 'approved', name);
    assert.equal(holder.approval.approver_role, 'tenant_self_serve', name);
  }

  const owner = liveArtifact(LIVE_226);
  assert.equal(owner.metadata.operation, 'repo_admin_membership');
  assert.equal(owner.validation.validation_findings.requester_authorization_path, 'org_owner');
  assert.equal(owner.approval.approval_status, 'approved');
});

// ------------------------------------------------- step 1: the validator routes, not rejects

test('a CI/CD requester holding no tenant role is routed to approval instead of failing validation', async () => {
  const artifact = liveArtifact(LIVE_225);
  const result = await revalidateCicd(artifact);

  assert.equal(result.is_valid, true);
  assert.equal(result.validation_findings.requester_authorization_path, 'none');
  assert.equal(result.validation_findings.requires_approval_routing, true);
  assert.deepEqual(
    result.validation_findings.eligible_approver_team_slugs,
    [
      artifact.validation.validation_findings.cicd_admin_team_slug,
      artifact.validation.canonical_tenant_context.tenant_team_slug,
    ]
  );
  assert.deepEqual(result.errors.filter((error) => /cannot manage CI\/CD admin membership/.test(error)), []);
  assert.equal(result.request.request_status, 'awaiting_approval');
});

test('a repo-admin requester holding no tenant role is routed to approval instead of failing validation', async () => {
  const artifact = liveArtifact(LIVE_226);
  const result = await revalidateRepo(artifact, { requesterLogin: 'no-role-user' });

  assert.equal(result.is_valid, true);
  assert.equal(result.validation_findings.requester_authorization_path, 'none');
  assert.equal(result.validation_findings.requires_approval_routing, true);
  assert.deepEqual(
    result.validation_findings.eligible_approver_team_slugs,
    [
      artifact.validation.validation_findings.repo_admin_team_slug,
      artifact.validation.canonical_tenant_context.tenant_team_slug,
    ]
  );
  assert.deepEqual(result.errors.filter((error) => /cannot manage repo admin membership/.test(error)), []);
});

test('a requester who holds the tenant role is not marked as needing approval routing', async () => {
  const artifact = liveArtifact(LIVE_225);
  const result = await revalidateCicd(artifact, {
    teamMemberships: { 'harism-infomagnus@grishitha-cicd-admin': membership('active', 'member') },
  });

  assert.equal(result.validation_findings.requester_authorization_path, 'tenant_cicd_admin_team');
  assert.equal(result.validation_findings.requires_approval_routing, false);
  assert.deepEqual(result.validation_findings.eligible_approver_team_slugs, []);
});

test('routing the unauthorized requester does not stop malformed requests from failing closed', async () => {
  const artifact = liveArtifact(LIVE_225);
  const malformed = {
    ...artifact,
    request: { ...artifact.request, tenant_name_input: 'no-such-tenant' },
  };
  const result = await revalidateCicd(malformed);

  assert.equal(result.is_valid, false);
  assert.ok(result.errors.length > 0);
});

// --------------------------------------------- step 2: the gate is requester-aware

test('a validated request from a requester with no tenant role waits for an approval comment', async () => {
  const artifact = liveArtifact(LIVE_225);
  const validation = await revalidateCicd(artifact);
  const result = await gate(artifactFromValidation(artifact, validation));

  assert.equal(result.approval.approval_status, 'pending');
  assert.equal(result.request.request_status, 'awaiting_approval');
  assert.match(result.approval.decision_note, /grishitha-cicd-admin/);
  assert.match(result.approval.decision_note, /grishitha-root/);
});

for (const name of [LIVE_224, LIVE_226, LIVE_227]) {
  test(`the live role-holder artifact ${name} still auto-approves exactly as it did on 1.0.7`, async () => {
    const artifact = liveArtifact(name);
    const recorded = artifact.approval;
    const result = await gate(artifact);

    assert.equal(result.approval.approval_status, recorded.approval_status);
    assert.equal(result.approval.approver_login, recorded.approver_login);
    assert.equal(result.approval.approver_role, recorded.approver_role);
    assert.equal(result.approval.approver_authorization_state, recorded.approver_authorization_state);
    assert.equal(result.approval.decision_source, recorded.decision_source);
    assert.equal(result.approval.decision_note, recorded.decision_note);
    assert.equal(result.approval.approved_context_marker, recorded.approved_context_marker);
  });
}

// ------------------------------- step 3: the approver is resolved from tenant-team membership

test('an active member of the tenant role team is an authorized approver', async () => {
  const approver = await resolveTenantRoleTeamApprover({
    organization: 'im-sandbox-erichinfomagnus',
    approverLogin: 'role-team-user',
    requesterLogin: 'no-role-user',
    eligibleApproverTeamSlugs: ['grishitha-cicd-admin', 'grishitha-root'],
  }, {
    getMembershipForUser: async ({ teamSlug, username }) =>
      (teamSlug === 'grishitha-cicd-admin' && username === 'role-team-user'
        ? membership('active', 'member')
        : { state: 'absent', membership: null }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'member', state: 'active' } }),
  });

  assert.equal(approver.approver_role, 'tenant_role_team');
  assert.equal(approver.approver_authorization_state, 'authorized');
  assert.equal(approver.approver_team_slug, 'grishitha-cicd-admin');
});

test('an active maintainer of the tenant top team is an authorized approver', async () => {
  const approver = await resolveTenantRoleTeamApprover({
    organization: 'im-sandbox-erichinfomagnus',
    approverLogin: 'tenant-admin-user',
    requesterLogin: 'no-role-user',
    eligibleApproverTeamSlugs: ['grishitha-cicd-admin', 'grishitha-root'],
  }, {
    getMembershipForUser: async ({ teamSlug, username }) =>
      (teamSlug === 'grishitha-root' && username === 'tenant-admin-user'
        ? membership('active', 'maintainer')
        : { state: 'absent', membership: null }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'member', state: 'active' } }),
  });

  assert.equal(approver.approver_role, 'tenant_admin_maintainer');
  assert.equal(approver.approver_authorization_state, 'authorized');
});

test('an active member of the tenant top team who is not a maintainer is not an authorized approver', async () => {
  const approver = await resolveTenantRoleTeamApprover({
    organization: 'im-sandbox-erichinfomagnus',
    approverLogin: 'plain-member',
    requesterLogin: 'no-role-user',
    eligibleApproverTeamSlugs: ['grishitha-cicd-admin', 'grishitha-root'],
  }, {
    getMembershipForUser: async ({ teamSlug, username }) =>
      (teamSlug === 'grishitha-root' && username === 'plain-member'
        ? membership('active', 'member')
        : { state: 'absent', membership: null }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'member', state: 'active' } }),
  });

  assert.equal(approver.approver_role, 'other');
  assert.equal(approver.approver_authorization_state, 'unauthorized');
});

test('an organization owner outside every tenant team is an authorized approver', async () => {
  const approver = await resolveTenantRoleTeamApprover({
    organization: 'im-sandbox-erichinfomagnus',
    approverLogin: 'org-owner-user',
    requesterLogin: 'no-role-user',
    eligibleApproverTeamSlugs: ['grishitha-cicd-admin', 'grishitha-root'],
  }, {
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'org-owner-user' ? 'admin' : 'member', state: 'active' },
    }),
  });

  assert.equal(approver.approver_role, 'target_org_owner');
  assert.equal(approver.approver_authorization_state, 'authorized');
});

test('the requester cannot approve their own request through the organization owner fallback', async () => {
  const approver = await resolveTenantRoleTeamApprover({
    organization: 'im-sandbox-erichinfomagnus',
    approverLogin: 'org-owner-user',
    requesterLogin: 'org-owner-user',
    eligibleApproverTeamSlugs: ['grishitha-cicd-admin', 'grishitha-root'],
  }, {
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
  });

  assert.equal(approver.approver_role, 'other');
  assert.equal(approver.approver_authorization_state, 'unauthorized');
  assert.equal(approver.requester_self_approval_blocked, true);
});

// ------------------------------------------- the routed request end to end through the gate

test('an eligible tenant role-team member approving by comment authorizes the routed request', async () => {
  const artifact = liveArtifact(LIVE_225);
  const validation = await revalidateCicd(artifact);
  const result = await gate(artifactFromValidation(artifact, validation), {
    issueComments: [approvalComment('role-team-user')],
    teamMemberships: { 'role-team-user@grishitha-cicd-admin': membership('active', 'member') },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, 'role-team-user');
  assert.equal(result.approval.approver_role, 'tenant_role_team');
  assert.equal(result.request.request_status, 'approved');
});

test('an ordinary organization member approving by comment does not authorize the routed request', async () => {
  const artifact = liveArtifact(LIVE_225);
  const validation = await revalidateCicd(artifact);
  const result = await gate(artifactFromValidation(artifact, validation), {
    issueComments: [approvalComment('bystander-user')],
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.approver_role, 'other');
  assert.equal(result.request.request_status, 'awaiting_approval');
});

test('the requester approving their own routed request is denied even when they are an organization owner', async () => {
  const artifact = liveArtifact(LIVE_225);
  const validation = await revalidateCicd(artifact);
  const result = await gate(artifactFromValidation(artifact, validation), {
    issueComments: [approvalComment(artifact.request.requester_login)],
    organizationRoles: { [artifact.request.requester_login]: 'admin' },
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.approver_role, 'other');
});

// ------------------------- step 4: the execution stage does not re-decide the approver

test('the execution-stage policy assert admits an approved routed request without re-checking the approver', () => {
  const tokenInfo = { token: 'pat-token', is_pat_backed: true, supports_org_mutation: true };

  // No approver_role, no approver login: the gate already settled who was allowed to
  // approve, and this assert deliberately only enforces that a decision was reached.
  const allowed = assertTenantSelfServeMutationAllowed({
    approval_status: 'approved',
    dry_run: false,
    tokenInfo,
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'approved');
});

test('the execution-stage policy assert still blocks a routed request that was never approved', () => {
  const tokenInfo = { token: 'pat-token', is_pat_backed: true, supports_org_mutation: true };

  assert.throws(
    () => assertTenantSelfServeMutationAllowed({ approval_status: 'pending', dry_run: false, tokenInfo }),
    /Tenant self-serve mutation blocked because request status is pending/
  );
  assert.throws(
    () => assertTenantSelfServeMutationAllowed({ approval_status: 'denied', dry_run: false, tokenInfo }),
    /Tenant self-serve mutation blocked because request status is denied/
  );
});
