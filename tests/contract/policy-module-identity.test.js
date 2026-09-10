'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const hostedRunnerPolicy = require('../../src/actions/hosted-runner-policy');
const runnerGroupPolicy = require('../../src/actions/runner-group-policy');

// run-approved-execution.js reuses runner-group-policy for runner groups, tenant variables and
// repository rulesets, while hosted runners use hosted-runner-policy. The 1.0.6 verification
// argument rests on the two behaving identically, so this guard fails if one is changed alone.
const assertHosted = hostedRunnerPolicy.assertHostedRunnerMutationAllowed;
const assertGroup = runnerGroupPolicy.assertRunnerGroupCreationAllowed;

const APPROVER_ROLES = [
  'target_org_owner',
  'tenant_role_holder',
  'org_owner',
  'org_member',
  'tenant_self_serve',
  'other',
  undefined,
];
const APPROVAL_STATUSES = ['approved', 'pending', 'denied', undefined];
const AUTHORIZATION_STATES = ['authorized', 'unauthorized', 'unknown', undefined];
const ALLOWED_ROLE_OPTIONS = [
  undefined,
  { allowedApproverRoles: ['target_org_owner'] },
  { allowedApproverRoles: ['target_org_owner', 'tenant_role_holder'] },
  { allowedApproverRoles: [] },
];
const TOKENS = [
  { token: 'pat', is_pat_backed: true, supports_org_mutation: true },
  { token: 'pat', is_pat_backed: false, supports_org_mutation: true },
  { token: 'pat', is_pat_backed: true, supports_org_mutation: false },
  { token: '', is_pat_backed: true, supports_org_mutation: true },
];

// The only intended difference between the modules is the noun in the error text.
function normalize(outcome) {
  if (!outcome.threw) return outcome;
  return {
    threw: true,
    message: outcome.message
      .replace(/^Hosted runner mutation blocked/, 'BLOCKED')
      .replace(/^Runner group creation blocked/, 'BLOCKED'),
  };
}

function invoke(fn, context, options) {
  try {
    const result = options === undefined ? fn(context) : fn(context, options);
    return { threw: false, allowed: result.allowed, reason: result.reason };
  } catch (error) {
    return { threw: true, message: error.message };
  }
}

test('both policy modules expose the same default approver roles', () => {
  assert.deepEqual(
    hostedRunnerPolicy.DEFAULT_ALLOWED_APPROVER_ROLES,
    runnerGroupPolicy.DEFAULT_ALLOWED_APPROVER_ROLES
  );
  assert.deepEqual(hostedRunnerPolicy.DEFAULT_ALLOWED_APPROVER_ROLES, ['target_org_owner']);
});

test('both isEligibleApproverRole implementations agree across the role and option matrix', () => {
  for (const role of APPROVER_ROLES) {
    for (const options of ALLOWED_ROLE_OPTIONS) {
      const label = `${role}/${JSON.stringify(options)}`;
      const hosted = options === undefined
        ? hostedRunnerPolicy.isEligibleApproverRole(role)
        : hostedRunnerPolicy.isEligibleApproverRole(role, options);
      const group = options === undefined
        ? runnerGroupPolicy.isEligibleApproverRole(role)
        : runnerGroupPolicy.isEligibleApproverRole(role, options);
      assert.equal(hosted, group, label);
    }
  }
});

test('both mutation asserts produce identical outcomes across the full matrix', () => {
  let cases = 0;
  for (const approval_status of APPROVAL_STATUSES) {
    for (const approver_role of APPROVER_ROLES) {
      for (const approver_authorization_state of AUTHORIZATION_STATES) {
        for (const dry_run of [true, false]) {
          for (const tokenInfo of TOKENS) {
            for (const options of ALLOWED_ROLE_OPTIONS) {
              const context = {
                approval_status,
                approver_role,
                approver_authorization_state,
                dry_run,
                tokenInfo,
                approver_login: 'someone',
                designated_approver_login: 'org-owner-user',
              };
              const label = JSON.stringify({ approval_status, approver_role, approver_authorization_state, dry_run, tokenInfo, options });
              assert.deepEqual(
                normalize(invoke(assertHosted, context, options)),
                normalize(invoke(assertGroup, context, options)),
                label
              );
              cases += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(cases > 1000, `expected a broad matrix, ran ${cases} cases`);
});

test('the default allow-list rejects a tenant role holder unless the call site widens it', () => {
  const context = {
    approval_status: 'approved',
    approver_role: 'tenant_role_holder',
    approver_authorization_state: 'authorized',
    dry_run: false,
    tokenInfo: { token: 'pat', is_pat_backed: true, supports_org_mutation: true },
  };

  for (const fn of [assertHosted, assertGroup]) {
    assert.throws(() => fn(context), /approver role tenant_role_holder is not eligible/);
    assert.equal(
      fn(context, { allowedApproverRoles: ['target_org_owner', 'tenant_role_holder'] }).allowed,
      true
    );
  }
});
