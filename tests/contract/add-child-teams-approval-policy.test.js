'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { APPROVAL_COMMAND, evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { resolveTeamHierarchyApprover } = require('../../src/workflow-support/resolve-team-hierarchy-approver');
const {
  assertTeamHierarchyAllowed,
  buildTeamHierarchyPermissionGuard,
  isEligibleTeamHierarchyApprover,
} = require('../../src/actions/team-hierarchy-policy');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-hierarchy-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('approval policy accepts the designated hierarchy approver adding the approval comment', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [{ child_team_slug: 'application-platform' }],
      approvalMode: 'team_hierarchy',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks }) =>
        resolveTeamHierarchyApprover(
          { organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks },
          {
            getTeamMembership: async ({ teamSlug, username }) =>
              fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
                ? fixture.memberships[teamSlug][username]
                : { membership: null },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'himanshu-im');
  assert.equal(decision.approver_role, 'designated_hierarchy_approver');
});

test('approval policy rejects approval by a user other than the designated hierarchy approver', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [{ child_team_slug: 'application-platform' }],
      approvalMode: 'team_hierarchy',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks }) =>
        resolveTeamHierarchyApprover(
          { organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks },
          {
            getTeamMembership: async ({ teamSlug, username }) =>
              fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
                ? fixture.memberships[teamSlug][username]
                : { membership: null },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_role, 'other');
});

test('resolveTeamHierarchyApprover requires the designated approver to remain maintainer on parent and child teams', async () => {
  const fixture = loadFixture().denied_stale_authorization;
  const decision = await resolveTeamHierarchyApprover(
    {
      organization: 'im-sandbox-himanshu',
      approverLogin: 'himanshu-im',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [{ child_team_slug: 'application-platform' }],
    },
    {
      getTeamMembership: async ({ teamSlug, username }) =>
        fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
          ? fixture.memberships[teamSlug][username]
          : { membership: null },
    }
  );

  assert.equal(decision.approver_role, 'other');
  assert.equal(decision.approver_authorization_state, 'unauthorized');
});

test('approval policy remains pending when no approval signal exists', async () => {
  const decision = await evaluateApprovalGate(
    {
      designatedApproverLogin: 'himanshu-im',
      approvalMode: 'team_hierarchy',
      issueComments: [],
    },
    {
      resolveRole: async () => ({ approver_role: 'designated_hierarchy_approver' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, new RegExp(APPROVAL_COMMAND));
});

test('team hierarchy policy requires approver and designated approver to match with authorized state', () => {
  assert.equal(
    isEligibleTeamHierarchyApprover({
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
      approver_authorization_state: 'authorized',
    }),
    true
  );
  assert.equal(
    isEligibleTeamHierarchyApprover({
      approver_login: 'octocat',
      designated_approver_login: 'monalisa',
      approver_authorization_state: 'authorized',
    }),
    false
  );
});

test('team hierarchy policy reports PAT-backed token details for eligible execution', () => {
  const guard = buildTeamHierarchyPermissionGuard(
    {
      approval_status: 'approved',
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
      approver_authorization_state: 'authorized',
      dry_run: false,
      tokenInfo: {
        token: 'test-token',
        source: 'ISSUEOPS_GITHUB_TOKEN',
        is_pat_backed: true,
        token_kind: 'pat',
        supports_team_hierarchy_mutation: true,
      },
    }
  );

  assert.equal(guard.can_mutate, true);
  assert.equal(guard.token_source, 'ISSUEOPS_GITHUB_TOKEN');
  assert.equal(guard.token_kind, 'pat');
});

test('team hierarchy policy blocks non-PAT tokens for org mutation', () => {
  assert.throws(
    () => assertTeamHierarchyAllowed({
      approval_status: 'approved',
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
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

test('team hierarchy policy blocks tokens that do not advertise hierarchy-mutation support', () => {
  assert.throws(
    () => assertTeamHierarchyAllowed({
      approval_status: 'approved',
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
      approver_authorization_state: 'authorized',
      dry_run: false,
      tokenInfo: {
        token: 'test-token',
        source: 'ISSUEOPS_GITHUB_TOKEN',
        is_pat_backed: true,
        token_kind: 'pat',
        supports_team_hierarchy_mutation: false,
      },
    }),
    /does not support team hierarchy mutation/i
  );
});