'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { APPROVAL_COMMAND, evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { resolveTeamRepoAccessApprover } = require('../../src/workflow-support/resolve-team-repo-access-approver');
const {
  assertRepositoryAccessAllowed,
  buildRepositoryAccessPermissionGuard,
  isEligibleTeamRepoAccessApprover,
} = require('../../src/actions/team-repo-access-policy');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-repo-access-approver-membership.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('approval policy accepts the designated target org owner adding the approval comment', async () => {
  const fixture = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      organization: 'octo-org',
      designatedApproverLogin: 'octocat',
      approvalMode: 'team_repo_access',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin }) =>
        resolveTeamRepoAccessApprover(
          { organization, approverLogin, designatedApproverLogin },
          {
            getOrganizationMembership: async ({ username }) =>
              fixture.membership[username] || { exists: false, membership: null },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'octocat');
  assert.equal(decision.approver_role, 'target_org_owner');
});

test('approval policy rejects approval by a user other than the designated owner', async () => {
  const fixture = loadFixture().denied_wrong_user;
  const decision = await evaluateApprovalGate(
    {
      organization: 'octo-org',
      designatedApproverLogin: 'octocat',
      approvalMode: 'team_repo_access',
      issueComments: fixture.comments,
    },
    {
      resolveRole: ({ organization, approverLogin, designatedApproverLogin }) =>
        resolveTeamRepoAccessApprover(
          { organization, approverLogin, designatedApproverLogin },
          {
            getOrganizationMembership: async ({ username }) =>
              fixture.membership[username] || { exists: false, membership: null },
          }
        ),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_role, 'other');
});

test('resolveTeamRepoAccessApprover requires the designated approver to remain an active org owner', async () => {
  const fixture = loadFixture().denied_stale_authorization;
  const decision = await resolveTeamRepoAccessApprover(
    {
      organization: 'octo-org',
      approverLogin: 'octocat',
      designatedApproverLogin: 'octocat',
    },
    {
      getOrganizationMembership: async ({ username }) =>
        fixture.membership[username] || { exists: false, membership: null },
    }
  );

  assert.equal(decision.approver_role, 'other');
  assert.equal(decision.approver_authorization_state, 'unauthorized');
});

test('approval policy remains pending when no approval signal exists', async () => {
  const decision = await evaluateApprovalGate(
    {
      designatedApproverLogin: 'octocat',
      approvalMode: 'team_repo_access',
      issueComments: [],
    },
    {
      resolveRole: async () => ({ approver_role: 'target_org_owner' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, new RegExp(APPROVAL_COMMAND));
});

test('approval policy keeps the same designated-approver rule for manual and csv-compatible repo-access requests', async () => {
  const fixture = loadFixture().approved;

  for (const intakeMode of ['manual', 'bulk_csv']) {
    const decision = await evaluateApprovalGate(
      {
        organization: 'octo-org',
        designatedApproverLogin: 'octocat',
        approvalMode: 'team_repo_access',
        intake_mode: intakeMode,
        issueComments: fixture.comments,
      },
      {
        resolveRole: ({ organization, approverLogin, designatedApproverLogin }) =>
          resolveTeamRepoAccessApprover(
            { organization, approverLogin, designatedApproverLogin },
            {
              getOrganizationMembership: async ({ username }) =>
                fixture.membership[username] || { exists: false, membership: null },
            }
          ),
      }
    );

    assert.equal(decision.approval_status, 'approved');
    assert.equal(decision.approver_role, 'target_org_owner');
  }
});

test('team repo access policy requires approver, designated approver, and authorized owner state to match', () => {
  assert.equal(
    isEligibleTeamRepoAccessApprover({
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
    }),
    true
  );
  assert.equal(
    isEligibleTeamRepoAccessApprover({
      approver_login: 'octocat',
      designated_approver_login: 'hubot',
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
    }),
    false
  );
});

test('team repo access policy reports PAT-backed token details for eligible execution', () => {
  const guard = buildRepositoryAccessPermissionGuard({
    approval_status: 'approved',
    approver_login: 'octocat',
    designated_approver_login: 'octocat',
    approver_role: 'target_org_owner',
    approver_authorization_state: 'authorized',
    dry_run: false,
    tokenInfo: {
      token: 'test-token',
      source: 'ISSUEOPS_GITHUB_TOKEN',
      is_pat_backed: true,
      token_kind: 'pat',
      supports_team_repo_access_mutation: true,
    },
  });

  assert.equal(guard.can_mutate, true);
  assert.equal(guard.token_source, 'ISSUEOPS_GITHUB_TOKEN');
  assert.equal(guard.token_kind, 'pat');
});

test('team repo access policy blocks non-PAT tokens for repository-access mutation', () => {
  assert.throws(
    () => assertRepositoryAccessAllowed({
      approval_status: 'approved',
      approver_login: 'octocat',
      designated_approver_login: 'octocat',
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
      dry_run: false,
      tokenInfo: {
        token: 'github-token',
        source: 'GITHUB_TOKEN',
        is_pat_backed: false,
        token_kind: 'github_token',
        supports_team_repo_access_mutation: false,
      },
    }),
    /not PAT-backed for repository-access mutation/i
  );
});