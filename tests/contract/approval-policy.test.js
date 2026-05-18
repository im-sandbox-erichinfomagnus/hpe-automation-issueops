'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { APPROVAL_COMMAND, evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { resolveApproverRole } = require('../../src/workflow-support/resolve-approver-role');

test('approval policy accepts an organization owner adding the approval comment', async () => {
  const decision = await evaluateApprovalGate(
    {
      issueComments: [
        {
          body: APPROVAL_COMMAND,
          user: { login: 'org-owner-user' },
          created_at: '2026-05-14T10:00:00Z',
        },
      ],
    },
    {
      resolveRole: async () => ({ approver_role: 'org_owner' }),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_login, 'org-owner-user');
  assert.equal(decision.approver_role, 'org_owner');
});

test('approval policy rejects a non-owner adding the approval comment', async () => {
  const decision = await evaluateApprovalGate(
    {
      issueComments: [
        {
          body: APPROVAL_COMMAND,
          user: { login: 'repo-maintainer' },
          created_at: '2026-05-14T10:00:00Z',
        },
      ],
    },
    {
      resolveRole: async () => ({ approver_role: 'other' }),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_login, 'repo-maintainer');
  assert.equal(decision.approver_role, 'other');
});

test('resolveApproverRole maps admin membership to org_owner', async () => {
  const decision = await resolveApproverRole(
    { organization: 'octo-org', approverLogin: 'org-owner-user' },
    {
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin' } }),
    }
  );

  assert.equal(decision.approver_role, 'org_owner');
});