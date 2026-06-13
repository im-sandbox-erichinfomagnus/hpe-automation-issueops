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

test('approval policy keeps the designated hierarchy approver model stable for manual-compatible request batches', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [
        { child_team_slug: 'application-platform' },
        { child_team_slug: 'platform-engineering-operations' },
      ],
      approvalMode: 'team_hierarchy',
      issueComments: fixture.comments,
      intakeMode: 'manual',
      requestedChildTeamsInput: 'Application Platform\nPlatform Engineering Operations',
      bulkCsvInput: '',
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks }) =>
        resolveTeamHierarchyApprover(
          { organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks },
          {
            getTeamMembership: async ({ teamSlug, username }) =>
              fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
                ? fixture.memberships[teamSlug][username]
                : { membership: { role: 'maintainer', state: 'active' } },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'himanshu-im');
  assert.equal(decision.approver_role, 'designated_hierarchy_approver');
});

test('approval policy keeps the designated hierarchy approver model stable for CSV-derived request batches', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [
        { child_team_slug: 'application-platform', source_row_number: 1 },
        { child_team_slug: 'platform-engineering-operations', source_row_number: 2 },
      ],
      approvalMode: 'team_hierarchy',
      issueComments: fixture.comments,
      intakeMode: 'bulk_csv',
      bulkCsvInput: 'child_team\nApplication Platform\nPlatform Engineering Operations',
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks }) =>
        resolveTeamHierarchyApprover(
          { organization, approverLogin, designatedApproverLogin, parentTeamSlug, requestedChildLinks },
          {
            getTeamMembership: async ({ teamSlug, username }) =>
              fixture.memberships[teamSlug] && fixture.memberships[teamSlug][username]
                ? fixture.memberships[teamSlug][username]
                : { membership: { role: 'maintainer', state: 'active' } },
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

test('resolveTeamHierarchyApprover accepts hyphen slug when team exists with underscore variant', async () => {
  const decision = await resolveTeamHierarchyApprover(
    {
      organization: 'im-sandbox-himanshu',
      approverLogin: 'himanshu-im',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'acme-tenant',
      requestedChildLinks: [{ child_team_slug: 'beta-team' }],
    },
    {
      getTeamMembership: async ({ teamSlug, username }) => {
        const variants = new Map([
          ['acme-tenant', { membership: null }],
          ['acme_tenant', { membership: { role: 'maintainer', state: 'active' } }],
          ['beta-team', { membership: null }],
          ['beta_team', { membership: { role: 'maintainer', state: 'active' } }],
        ]);

        return variants.get(teamSlug) || { membership: null };
      },
    }
  );

  assert.equal(decision.approver_role, 'designated_hierarchy_approver');
  assert.equal(decision.approver_authorization_state, 'authorized');
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

test('approval policy does not evaluate hierarchy approval while csv_attachment intake is waiting_for_attachment', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [],
      approvalMode: 'team_hierarchy',
      issueComments: fixture.comments,
      intakeMode: 'csv_attachment',
      requestStatus: 'waiting_for_attachment',
    },
    {
      resolveRole: async () => ({ approver_role: 'designated_hierarchy_approver' }),
    }
  );

  assert.equal(decision.approval_status, 'not_requested');
  assert.match(decision.decision_note, /waiting for a requester-authored CSV attachment comment/i);
});

test('approval policy requests designated hierarchy approver comment after accepted attachment for hierarchy mode', async () => {
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [{ child_team_slug: 'application-platform' }],
      approvalMode: 'team_hierarchy',
      issueComments: [],
      intakeMode: 'csv_attachment',
      requestStatus: 'awaiting_approval',
      accepted_attachment_submission: {
        comment_created_at: '2026-05-25T10:09:00Z',
      },
    },
    {
      resolveRole: async () => ({ approver_role: 'designated_hierarchy_approver' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, /designated hierarchy approver/i);
  assert.match(decision.decision_note, /after the accepted CSV attachment comment/i);
  assert.doesNotMatch(decision.decision_note, /organization owner/i);
});

test('approval policy rejects approval comments from centrally assigned queue owners when they are not the designated hierarchy approver', async () => {
  const decision = await evaluateApprovalGate(
    {
      organization: 'im-sandbox-himanshu',
      designatedApproverLogin: 'himanshu-im',
      parentTeamSlug: 'platform-engineering',
      requestedChildLinks: [{ child_team_slug: 'application-platform' }],
      approvalMode: 'team_hierarchy',
      issueComments: [
        {
          id: 99,
          body: 'approved',
          created_at: '2026-05-25T12:00:00Z',
          user: { login: 'central-owner' },
        },
      ],
    },
    {
      resolveRole: async () => ({
        approver_login: 'central-owner',
        approver_role: 'other',
        approver_authorization_state: 'unauthorized',
      }),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_login, 'central-owner');
  assert.equal(decision.approver_role, 'other');
  assert.match(decision.decision_note, /does not authorize team hierarchy mutation/i);
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

test('team hierarchy policy permits dry-run evaluation with non-PAT workflow tokens', () => {
  const guard = buildTeamHierarchyPermissionGuard({
    approval_status: 'approved',
    approver_login: 'octocat',
    designated_approver_login: 'octocat',
    approver_authorization_state: 'authorized',
    dry_run: true,
    tokenInfo: {
      token: 'github-token',
      source: 'GITHUB_TOKEN',
      is_pat_backed: false,
      token_kind: 'github_token',
      supports_team_hierarchy_mutation: false,
    },
  });

  assert.equal(guard.can_mutate, false);
  assert.equal(guard.reason, 'dry_run');
  assert.equal(guard.token_source, 'GITHUB_TOKEN');
});