'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');
const { validateTeamMembershipRequest } = require('../../src/workflow-support/validate-team-membership-request');
const { validateRepoAdminMembershipRequest } = require('../../src/workflow-support/validate-repo-admin-membership-request');

// Stephen, 14 Sep: "as an org member (not part of any tenant team), I was able to add myself to
// the tenant admin team."
//
// The half fixed here is the second one: the person who FILES a request can also APPROVE it.
// Nothing compares the approving commenter to the requester on any comment-driven path, so one
// person completes the whole chain alone.
//
// The exclusion belongs on the COMMENT path only. Two approval shapes legitimately record the
// requester as their own approver, and both must keep working:
//   * tenant self-serve  - the intake gate IS the authorization (run-approval-gate.js:212)
//   * fast lanes         - incl. the tenant_creation org-owner lane from 376a3bf, which Eric
//                          ruled in for 1.0.6 continuity          (run-approval-gate.js:267)
// Both return from runApprovalGate BEFORE evaluateApprovalGate is reached (:254 and :309 vs
// :383), so putting the check inside evaluateApprovalGate scopes it to comment approval by
// construction rather than by a list that could drift.
//
// STUB-VS-PRODUCTION API SURFACE (Piece 48 rule, Piece 50 correction - forwarding counts, not
// just invocation). The stub below supplies:
//   getAssignableOwners, addIssueAssignees, listIssueComments, getOrganizationMembership,
//   getMembershipForUser, getOrganization, getTeamBySlug, resolveMembership, resolveUser,
//   listTeams
// Checked mechanically against runApprovalGate, evaluateApprovalGate and both validators plus
// everything they delegate to: nothing required is missing.

const REQUESTER = 'filing-user';
const OTHER_MEMBER = 'another-member';

function approvalComment(login) {
  return { id: 9100, body: 'approved', created_at: '2026-09-15T12:00:00.000Z', user: { login } };
}

// Every function any exercised path calls. Roles are decided per login, not per call site.
function buildApi(overrides = {}) {
  return {
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    listIssueComments: async () => [],
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async () => ({ exists: true, team: { id: 1, slug: 'contosouk-repo-admin' } }),
    resolveMembership: async () => ({ exists: true, membership: { role: 'member', state: 'active' } }),
    resolveUser: async () => ({ exists: true }),
    listTeams: async () => ([{ slug: 'contosouk-root' }, { slug: 'contosouk-repo-admin' }]),
    getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'org-owner-user' ? 'admin' : 'member', state: 'active' },
    }),
    ...overrides,
  };
}

function writeArtifact(artifact) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'self-approval-'));
  const artifactPath = path.join(directory, 'validation.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');
  return artifactPath;
}

function baseArtifact(operation, findings = {}) {
  return {
    metadata: { operation, run_id: '1', run_attempt: '1' },
    request: {
      requester_login: REQUESTER,
      organization: 'octo-org',
      repository: 'octo-org/central',
      issue_number: 700,
      context_marker: 'self-approval-context:1',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      team_slug: 'contosouk-repo-admin',
      intended_owner_login: REQUESTER,
      designated_approver_login: REQUESTER,
      tenant_admin_login: REQUESTER,
      requested_child_links: [],
    },
    validation: { is_valid: true, validation_findings: { tenant_resolution_status: 'resolved', ...findings } },
    approval: { approval_status: 'pending' },
    execution: { summary: '' },
    reconciliation: null,
  };
}

async function gate(operation, { commenter, findings = {}, api = {} } = {}) {
  return runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact(baseArtifact(operation, findings)),
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: buildApi({ listIssueComments: async () => (commenter ? [approvalComment(commenter)] : []), ...api }),
    setProcessExitCode: false,
  });
}

// ============================================================ THE ESCALATION CHAIN, FROM CODE
// Proven by running both validators, not by reproducing it against a live organization.

test('CHAIN 1: add-team-members places no constraint on the target team beyond existence', async () => {
  const result = await validateTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'contosouk-repo-admin',
      intake_mode: 'manual',
      requested_people: REQUESTER,
      business_justification: 'Adding myself.',
      dry_run: 'false',
    },
    issue: { number: 701, user: { login: REQUESTER } },
  }, {
    teamLookup: async () => ({ exists: true, team_sync_blocked: false }),
    resolver: async () => ({ exists: true }),
  });

  // A tenant role team is a legal target, and the requester holding no tenant role is not an error.
  assert.equal(
    (result.errors || []).some((error) => /requester/i.test(error)),
    false,
    JSON.stringify(result.errors)
  );
});

test('CHAIN 2: plain MEMBER of the tenant repo-admin team satisfies add-repo-admin authorization', async () => {
  const registryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-registry-'));
  fs.writeFileSync(path.join(registryDirectory, 'contosouk.json'), JSON.stringify({
    tenantId: 'contosouk',
    tenantName: 'ContosoUK',
    organization: 'octo-org',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'contosouk-root',
        structure: [
          { team: 'contosouk-root', parent: null, type: 'root' },
          { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
        ],
      },
    },
  }, null, 2), 'utf8');

  const result = await validateRepoAdminMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      repo_admin_operation: 'add',
      intake_mode: 'manual',
      requested_people: 'octocat',
      dry_run: 'false',
      business_justification: 'Managing tenant repo admins.',
    },
    issue: { number: 702, user: { login: REQUESTER } },
  }, {
    registryDirectory,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async ({ teamSlug }) => ({ exists: true, team: { id: 1, slug: teamSlug } }),
    // The chain's payload: membership acquired via add-team-members is role 'member'.
    getMembershipForUser: async ({ teamSlug, username }) => (
      teamSlug === 'contosouk-repo-admin' && username === REQUESTER
        ? { state: 'active', membership: { role: 'member' } }
        : { state: 'absent', membership: null }
    ),
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'member', state: 'active' } }),
    resolveUser: async () => ({ exists: true }),
  });

  // ** This is the escalation: plain membership, obtained through a different form, IS authority
  // here. 1.0.6 Phase 1b widened this gate to accept repo-admin team members. **
  assert.equal(result.validation_findings.requester_authorization_path, 'tenant_repo_admin_team');
  assert.equal(result.validation_findings.requires_approval_routing, false);
});

// ===================================================== SELF-APPROVAL ON THE COMMENT PATH

test('team_membership: the requester cannot approve their own request', async () => {
  const result = await gate('team_membership', { commenter: REQUESTER });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.requester_self_approval_blocked, true);
  assert.match(result.approval.decision_note, /cannot authorize their own request/i);
});

test('CONTROL team_membership: a different active org member can still approve', async () => {
  const result = await gate('team_membership', { commenter: OTHER_MEMBER });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, OTHER_MEMBER);
});

test('team_creation: naming yourself as intended owner does not let you approve yourself', async () => {
  const result = await gate('team_creation', { commenter: REQUESTER });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.requester_self_approval_blocked, true);
});

test('team_hierarchy: naming yourself as designated approver does not let you approve yourself', async () => {
  const result = await gate('team_hierarchy', { commenter: REQUESTER });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.requester_self_approval_blocked, true);
});

test('the exclusion is applied by evaluateApprovalGate itself, for every comment mode', async () => {
  for (const approvalMode of ['team_membership', 'team_creation', 'team_hierarchy', 'tenant_creation',
    'team_repo_access', 'tenant_repo_creation', 'runner_group_creation', 'repository_ruleset_creation']) {
    const decision = await evaluateApprovalGate({
      approvalMode,
      organization: 'octo-org',
      requesterLogin: REQUESTER,
      intendedOwnerLogin: REQUESTER,
      designatedApproverLogin: REQUESTER,
      tenantAdminLogin: REQUESTER,
      issueComments: [approvalComment(REQUESTER)],
    }, { api: buildApi() });

    assert.equal(decision.approval_status, 'denied', approvalMode);
    assert.equal(decision.requester_self_approval_blocked, true, approvalMode);
  }
});

// ======================================== THE REGRESSION GUARD FOR ERIC'S RULING - DO NOT EDIT
// 376a3bf made an org owner who nominates themselves as tenant admin auto-approve, for 1.0.6
// continuity. That is POLICY-driven and must survive this change untouched. If this test goes
// red, the fix has reached past the comment path and the change is wrong - not the test.

test('REGRESSION GUARD: the org-owner fast lane still auto-approves a self-nominating owner', async () => {
  const result = await gate('tenant_creation', {
    findings: { requester_owner_gate: 'authorized' },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, REQUESTER, 'the requester IS the approver here, by design');
  assert.equal(result.approval.approver_role, 'target_org_owner');
  assert.equal(result.approval.decision_source, 'policy');
});

test('REGRESSION GUARD: tenant self-serve still auto-approves the requester', async () => {
  const result = await gate('tenant_subteam_creation');

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_login, REQUESTER);
  assert.equal(result.approval.approver_role, 'tenant_self_serve');
  assert.equal(result.approval.decision_source, 'policy');
});

test('CONTROL: a non-owner tenant_creation request still waits for a comment', async () => {
  const result = await gate('tenant_creation', { findings: { requester_owner_gate: 'unauthorized' } });

  assert.equal(result.approval.approval_status, 'pending');
});

// ================================================================================ THE TOCTOU

test('TOCTOU: acquiring the role team AFTER filing still does not let you approve yourself', async () => {
  // File with no role, get added to the role team, then comment 'approved' yourself. The
  // validation artifact still says 'none', but the approver resolver now sees the membership -
  // so without the exclusion the resolver would answer tenant_role_team and approve.
  const result = await gate('repo_admin_membership', {
    commenter: REQUESTER,
    findings: {
      requester_authorization_path: 'none',
      requires_approval_routing: true,
      eligible_approver_team_slugs: ['contosouk-repo-admin', 'contosouk-root'],
    },
    api: {
      getMembershipForUser: async ({ teamSlug, username }) => (
        teamSlug === 'contosouk-repo-admin' && username === REQUESTER
          ? { state: 'active', membership: { role: 'member' } }
          : { state: 'absent', membership: null }
      ),
    },
  });

  assert.equal(result.approval.approval_status, 'denied');
  assert.equal(result.approval.requester_self_approval_blocked, true);
});

test('CONTROL TOCTOU: a different role-team member approving the same request is accepted', async () => {
  const result = await gate('repo_admin_membership', {
    commenter: OTHER_MEMBER,
    findings: {
      requester_authorization_path: 'none',
      requires_approval_routing: true,
      eligible_approver_team_slugs: ['contosouk-repo-admin', 'contosouk-root'],
    },
    api: {
      getMembershipForUser: async ({ teamSlug, username }) => (
        teamSlug === 'contosouk-repo-admin' && username === OTHER_MEMBER
          ? { state: 'active', membership: { role: 'member' } }
          : { state: 'absent', membership: null }
      ),
    },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_role, 'tenant_role_team');
});
