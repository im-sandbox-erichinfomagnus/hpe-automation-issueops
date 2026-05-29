'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatCostCenterSummary } = require('../../src/workflow-support/format-cost-center-summary');

function summaryFor(approvalStatus, overrides = {}) {
  return formatCostCenterSummary({
    request: {
      dry_run: true,
      intended_approver_login: 'octocat',
      request_status: 'awaiting_approval',
      enterprise: 'acme',
      requester_login: 'requester',
      request_id: 'x',
      ...(overrides.request || {}),
    },
    validation: { is_valid: true, live_state_verified: false, requested_assignments: [{}] },
    approval: { approval_status: approvalStatus, approver_login: 'adamg-infomagnus' },
    reconciliation: { cost_centers_to_create: ['A'], assignments_to_add: [{ login: 'u', cost_center: 'A' }] },
  });
}

test('denied footer states no changes were made and does not claim approval', () => {
  const out = summaryFor('denied');
  const footer = out.split('\n').pop();
  assert.equal(footer, 'The approval comment was not from the named approver, so no changes were made.');
  assert.equal(footer.includes('Request is approved'), false);
});

test('pending footer asks for an approval comment from the named approver', () => {
  const footer = summaryFor('pending').split('\n').pop();
  assert.match(footer, /awaiting an approval comment of exactly "approved" from octocat/);
});

test('approved dry-run footer says the plan will apply once dry-run is off', () => {
  const footer = summaryFor('approved').split('\n').pop();
  assert.match(footer, /Request is approved\. Dry-run is on/);
});

test('approved live footer says the plan has been applied', () => {
  const footer = summaryFor('approved', { request: { dry_run: false } }).split('\n').pop();
  assert.equal(footer, 'Request is approved. The plan above has been applied.');
});
