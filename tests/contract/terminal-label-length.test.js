'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveApprovedExecutionTerminalState,
} = require('../../src/scripts/run-approved-execution');

// GitHub rejects a label whose name exceeds 50 characters with
// HTTP 422 "name is too long (maximum is 50 characters)". The terminal state label is
// built as <prefix><status>, and the prefixes run to 37 characters, so a status name
// that reads well in an audit artifact can still be unusable as a label. That is not
// hypothetical: issueops:add-child-teams:failed_after_approved_execution was 56
// characters, so it could never be created and the one operation that reaches the
// status was left with no terminal label at all.
const GITHUB_LABEL_MAX_LENGTH = 50;

// Deliberately literal rather than imported: importing the map would assert it equals
// itself, and the point here is to measure the strings that actually reach GitHub.
const OPERATION_LABEL_PREFIXES = [
  ['team_creation', 'issueops:create-org-teams:'],
  ['team_hierarchy', 'issueops:add-child-teams:'],
  ['team_membership', 'issueops:add-team-members:'],
  ['team_repo_access', 'issueops:add-team-repo-access:'],
  ['team_repo_access_removal', 'issueops:remove-team-repo-access:'],
  ['tenant_creation', 'issueops:create-tenant:'],
  ['tenant_repo_creation', 'issueops:create-tenant-repos:'],
  ['tenant_subteam_creation', 'issueops:create-tenant-subteam:'],
  ['hosted_runner_creation', 'issueops:create-tenant-hosted-runner:'],
  ['hosted_runner_deletion', 'issueops:delete-tenant-hosted-runner:'],
  ['hosted_runner_move', 'issueops:move-tenant-hosted-runner:'],
  ['runner_group_creation', 'issueops:create-tenant-runner-groups:'],
  ['tenant_variable_management', 'issueops:manage-tenant-variables:'],
  ['org_variable_management', 'issueops:manage-org-variables:'],
  ['repo_admin_membership', 'issueops:add-repo-admin-to-tenant:'],
  ['cicd_admin_membership', 'issueops:add-cicd-admin-to-tenant:'],
  ['repository_ruleset_creation', 'issueops:create-repository-ruleset:'],
  ['repository_ruleset_deletion', 'issueops:delete-repository-ruleset:'],
];

// partially_executed is deliberately excluded here and pinned separately below: it
// overflows for ten operations, which is a second and wider instance of the same defect
// and needs its own decision about migrating existing labels.
const ALWAYS_REACHABLE_STATUSES = ['executed', 'failed'];

// Ask the real derivation whether an operation can reach the post-approval failure
// status, rather than hardcoding the answer. If the gate is ever widened, this test
// starts measuring the newly reachable operations automatically.
function postApprovalFailureStatusFor(operation) {
  return deriveApprovedExecutionTerminalState(
    { failure_count: 1, mutation_count: 0, noop_count: 0, pending_count: 0 },
    { operation, intakeMode: 'csv_attachment', approvalStatus: 'approved' }
  );
}

test('every terminal state label an operation can reach fits GitHub label length limit', () => {
  const tooLong = [];

  for (const [operation, prefix] of OPERATION_LABEL_PREFIXES) {
    const statuses = [...ALWAYS_REACHABLE_STATUSES];
    const postApproval = postApprovalFailureStatusFor(operation);
    if (!statuses.includes(postApproval)) {
      statuses.push(postApproval);
    }

    for (const status of statuses) {
      const label = `${prefix}${status}`;
      if (label.length > GITHUB_LABEL_MAX_LENGTH) {
        tooLong.push(`${label} (${label.length} chars, operation ${operation})`);
      }
    }
  }

  assert.deepEqual(
    tooLong,
    [],
    `these terminal state labels exceed GitHub's ${GITHUB_LABEL_MAX_LENGTH}-character limit and cannot be created:\n  ${tooLong.join('\n  ')}`
  );
});

test('the post-approval failure status is short enough for every prefix that could adopt it', () => {
  // The six workflows changed for #114 create this label defensively, even where the
  // status is not reachable today, so the name has to fit prefixes beyond the one
  // operation that currently produces it.
  const status = postApprovalFailureStatusFor('team_hierarchy');
  assert.notEqual(status, 'failed', 'team_hierarchy must still reach a distinct post-approval failure status');

  const defensivePrefixes = [
    'issueops:create-org-teams:',
    'issueops:add-child-teams:',
    'issueops:add-team-members:',
    'issueops:add-team-repo-access:',
    'issueops:remove-team-repo-access:',
    'issueops:create-tenant:',
  ];

  for (const prefix of defensivePrefixes) {
    const label = `${prefix}${status}`;
    assert.ok(
      label.length <= GITHUB_LABEL_MAX_LENGTH,
      `${label} is ${label.length} characters, over the ${GITHUB_LABEL_MAX_LENGTH} limit`
    );
  }
});

// Pinned, not fixed. partially_executed is 18 characters and overflows for ten of the
// eighteen prefixes, so those operations cannot label a partial execution - the same
// failure mode as #114, on a far more commonly reached status. Shortening it means
// changing a persisted request_status used across 43 files, or decoupling the label
// suffix from the status value, and either way existing labels would be orphaned. That
// is a separate decision. This test pins the exact known-bad set so the problem cannot
// quietly grow, and fails the moment the set changes in either direction.
test('the known partially_executed label overflow has not changed', () => {
  const overflowing = OPERATION_LABEL_PREFIXES
    .map(([operation, prefix]) => [operation, `${prefix}partially_executed`])
    .filter(([, label]) => label.length > GITHUB_LABEL_MAX_LENGTH)
    .map(([operation]) => operation)
    .sort();

  assert.deepEqual(overflowing, [
    'cicd_admin_membership',
    'hosted_runner_creation',
    'hosted_runner_deletion',
    'hosted_runner_move',
    'repo_admin_membership',
    'repository_ruleset_creation',
    'repository_ruleset_deletion',
    'runner_group_creation',
    'team_repo_access_removal',
    'tenant_variable_management',
  ], 'the set of operations that cannot label a partial execution has changed - if it shrank, update this pin; if it grew, a new prefix has pushed another operation over the limit');
});

test('the post-approval failure status stays distinguishable from a plain failure', () => {
  const postApproval = postApprovalFailureStatusFor('team_hierarchy');
  const ordinary = deriveApprovedExecutionTerminalState(
    { failure_count: 1, mutation_count: 0, noop_count: 0, pending_count: 0 },
    { operation: 'team_membership', intakeMode: 'csv_attachment', approvalStatus: 'approved' }
  );

  assert.equal(ordinary, 'failed');
  assert.notEqual(postApproval, ordinary);
  assert.match(postApproval, /approved/, 'the status should still say the request had been approved');
});
