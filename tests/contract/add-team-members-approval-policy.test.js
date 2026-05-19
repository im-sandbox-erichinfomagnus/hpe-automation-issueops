'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { APPROVAL_COMMAND, evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');

test('manual team-membership approval remains authorized only for organization owners', async () => {
  const decision = await evaluateApprovalGate(
    {
      approvalMode: 'team_membership',
      organization: 'octo-org',
      issueComments: [
        {
          body: APPROVAL_COMMAND,
          user: { login: 'org-owner-user' },
          created_at: '2026-05-19T10:00:00Z',
        },
      ],
    },
    {
      resolveRole: async () => ({ approver_role: 'org_owner' }),
    }
  );

  assert.equal(decision.approval_status, 'approved');
  assert.equal(decision.approver_role, 'org_owner');
});

test('team-membership approval remains denied for non-owners even when CSV-compatible context is present', async () => {
  const decision = await evaluateApprovalGate(
    {
      approvalMode: 'team_membership',
      organization: 'octo-org',
      intake_mode: 'bulk_csv',
      issueComments: [
        {
          body: APPROVAL_COMMAND,
          user: { login: 'repo-maintainer' },
          created_at: '2026-05-19T10:05:00Z',
        },
      ],
    },
    {
      resolveRole: async () => ({ approver_role: 'other' }),
    }
  );

  assert.equal(decision.approval_status, 'denied');
  assert.equal(decision.approver_role, 'other');
});