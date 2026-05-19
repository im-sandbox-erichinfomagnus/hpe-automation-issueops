'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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