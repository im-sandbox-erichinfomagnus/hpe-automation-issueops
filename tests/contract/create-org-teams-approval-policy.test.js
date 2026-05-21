'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { APPROVAL_COMMAND, evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { resolveTeamCreationApprover } = require('../../src/workflow-support/resolve-team-creation-approver');
const {
  assertTeamCreationAllowed,
  buildTeamCreationPermissionGuard,
  isEligibleTeamCreationApprover,
} = require('../../src/actions/team-creation-policy');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-creation-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('approval policy accepts the shared intended owner adding the approval comment', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      intendedOwnerLogin: 'himanshu-im',
      approvalMode: 'team_creation',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin }) =>
        resolveTeamCreationApprover(
          { organization, approverLogin, intendedOwnerLogin: 'himanshu-im' },
          {
            getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'himanshu-im');
  assert.equal(decision.approver_role, 'intended_owner');
});

test('approval policy rejects approval by a user other than the intended owner', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      intendedOwnerLogin: 'himanshu-im',
      approvalMode: 'team_creation',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin }) =>
        resolveTeamCreationApprover(
          { organization, approverLogin, intendedOwnerLogin: 'himanshu-im' },
          {
            getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_role, 'other');
});

test('approval policy keeps the same intended-owner requirement for CSV-compatible team-creation requests', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      intendedOwnerLogin: 'himanshu-im',
      approvalMode: 'team_creation',
      intakeMode: 'bulk_csv',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin }) =>
        resolveTeamCreationApprover(
          { organization, approverLogin, intendedOwnerLogin: 'himanshu-im' },
          {
            getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'himanshu-im');
  assert.equal(decision.approver_role, 'intended_owner');
});

test('resolveTeamCreationApprover requires the intended owner to be an active member', async () => {
  const fixture = loadFixture().denied_inactive_owner;
  const decision = await resolveTeamCreationApprover(
    {
      organization: 'im-sandbox-himanshu',
      approverLogin: 'himanshu-im',
      intendedOwnerLogin: 'himanshu-im',
    },
    {
      getOrganizationMembership: async ({ username }) => fixture.memberships[username] || { exists: false },
    }
  );

  assert.equal(decision.approver_role, 'other');
  assert.equal(decision.approver_membership_state, 'pending');
});

test('approval policy remains pending when no approval signal exists', async () => {
  const decision = await evaluateApprovalGate(
    {
      intendedOwnerLogin: 'himanshu-im',
      approvalMode: 'team_creation',
      issueComments: [],
    },
    {
      resolveRole: async () => ({ approver_role: 'intended_owner' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, new RegExp(APPROVAL_COMMAND));
});

test('team creation policy requires approver and intended owner to match', () => {
  assert.equal(
    isEligibleTeamCreationApprover({ approver_login: 'octocat', intended_owner_login: 'octocat' }),
    true
  );
  assert.equal(
    isEligibleTeamCreationApprover({ approver_login: 'octocat', intended_owner_login: 'monalisa' }),
    false
  );
});

test('team creation policy reports PAT-backed token details for eligible execution', () => {
  const guard = buildTeamCreationPermissionGuard(
    {
      approval_status: 'approved',
      approver_login: 'octocat',
      intended_owner_login: 'octocat',
      dry_run: false,
      tokenInfo: {
        token: 'test-token',
        source: 'ISSUEOPS_GITHUB_TOKEN',
        is_pat_backed: true,
        token_kind: 'pat',
      },
    }
  );

  assert.equal(guard.can_mutate, true);
  assert.equal(guard.token_source, 'ISSUEOPS_GITHUB_TOKEN');
  assert.equal(guard.token_kind, 'pat');
});

test('team creation policy blocks non-PAT tokens for org mutation', () => {
  assert.throws(
    () => assertTeamCreationAllowed({
      approval_status: 'approved',
      approver_login: 'octocat',
      intended_owner_login: 'octocat',
      dry_run: false,
      tokenInfo: {
        token: 'github-token',
        source: 'GITHUB_TOKEN',
        is_pat_backed: false,
        token_kind: 'github_token',
      },
    }),
    /not PAT-backed for org mutation/i
  );
});