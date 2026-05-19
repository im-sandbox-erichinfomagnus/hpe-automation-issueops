'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'approver-roles.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createResolveRole(fixtureCase) {
  return async ({ approverLogin }) => ({
    approver_role: fixtureCase.roles[approverLogin] || 'other',
  });
}

test('approval gate passes when an organization owner approves', async () => {
  const fixtureCase = loadFixture().approved;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'approved');
});

test('approval gate denies non-owner approval attempts', async () => {
  const fixtureCase = loadFixture().denied;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'denied');
});

test('approval gate remains pending when no approval signal exists', async () => {
  const fixtureCase = loadFixture().missing;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'pending');
});

test('approval gate invalidates a previously approved request when the approval comment is removed', async () => {
  const fixtureCase = loadFixture().missing;
  const decision = await evaluateApprovalGate(
    {
      issueComments: fixtureCase.comments,
      priorApprovalStatus: 'approved',
    },
    { resolveRole: createResolveRole(fixtureCase) }
  );

  assert.equal(decision.approval_status, 'invalidated');
  assert.match(decision.decision_note, /no longer present/i);
});

test('approval-ready manual summaries surface intake metadata before execution', () => {
  const summary = formatAuditSummary({
    request: {
      request_id: 'octo-org/issueops-speckit#220/local.1',
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requester_login: 'requester',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      requested_people: ['octocat', 'hubot'],
      csv_row_findings: [],
      csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
    },
    validation: {
      is_valid: true,
      errors: [],
      warnings: [],
      csv_row_findings: [],
    },
    approval: {
      approval_status: 'pending',
      approver_role: 'other',
    },
    execution: {
      mutation_count: 0,
      noop_count: 0,
      pending_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
    },
  });

  assert.match(summary, /Intake mode: manual/i);
  assert.doesNotMatch(summary, /CSV row findings:/i);
  assert.doesNotMatch(summary, /CSV valid rows:/i);
  assert.doesNotMatch(summary, /CSV duplicate rows:/i);
  assert.doesNotMatch(summary, /CSV invalid rows:/i);
  assert.doesNotMatch(summary, /CSV row numbering:/i);
});

test('manual approval guidance remains the organization-owner workflow path', async () => {
  const decision = await evaluateApprovalGate(
    {
      approvalMode: 'team_membership',
      organization: 'octo-org',
      issueComments: [],
    },
    {
      resolveRole: async () => ({ approver_role: 'other' }),
    }
  );

  assert.equal(decision.approval_status, 'pending');
  assert.match(decision.decision_note, /organization owner/i);
});