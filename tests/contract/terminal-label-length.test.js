'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveApprovedExecutionTerminalState,
} = require('../../src/scripts/run-approved-execution');
const {
  terminalStateLabel,
  terminalStateLabelVariants,
  labelSuffixForStatus,
  statusForLabelSuffix,
} = require('../../src/workflow-support/terminal-state-labels');

// GitHub rejects a label name longer than 50 characters with
// HTTP 422 "name is too long (maximum is 50 characters)". The terminal state label is
// <prefix><suffix> and the prefixes run to 37, so a status that reads well in an audit
// artifact can still be unusable as a label. Two have been:
// issueops:add-child-teams:failed_after_approved_execution was 56, and
// issueops:create-tenant-hosted-runner:partially_executed is 55.
const GITHUB_LABEL_MAX_LENGTH = 50;

// Deliberately literal rather than imported: importing the map would assert it equals
// itself, and the point is to measure the strings that actually reach GitHub.
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

const ALWAYS_REACHABLE_STATUSES = ['executed', 'partially_executed', 'failed'];

// Ask the real derivation whether an operation can reach the post-approval failure
// status rather than hardcoding the answer, so widening that gate later brings newly
// reachable operations under the guard automatically.
function postApprovalFailureStatusFor(operation) {
  return deriveApprovedExecutionTerminalState(
    { failure_count: 1, mutation_count: 0, noop_count: 0, pending_count: 0 },
    { operation, intakeMode: 'csv_attachment', approvalStatus: 'approved' }
  );
}

function reachableStatusesFor(operation) {
  const statuses = [...ALWAYS_REACHABLE_STATUSES];
  const postApproval = postApprovalFailureStatusFor(operation);
  if (!statuses.includes(postApproval)) {
    statuses.push(postApproval);
  }

  return statuses;
}

test('every terminal state label the code can apply fits GitHub label length limit', () => {
  const tooLong = [];

  for (const [operation, prefix] of OPERATION_LABEL_PREFIXES) {
    for (const status of reachableStatusesFor(operation)) {
      const label = terminalStateLabel(prefix, status);
      if (label.length > GITHUB_LABEL_MAX_LENGTH) {
        tooLong.push(`${label} (${label.length} chars, operation ${operation}, status ${status})`);
      }
    }
  }

  assert.deepEqual(
    tooLong,
    [],
    `these terminal state labels exceed GitHub's ${GITHUB_LABEL_MAX_LENGTH}-character limit and cannot be created:\n  ${tooLong.join('\n  ')}`
  );
});

test('a label that already fits keeps its exact spelling so live labels are not orphaned', () => {
  // These eight are under the limit today and are applied on real issues in the sandbox
  // and at HPE. Shortening them would strand every label already out there.
  const alreadyFitting = [
    'issueops:create-tenant:',
    'issueops:add-child-teams:',
    'issueops:create-org-teams:',
    'issueops:add-team-members:',
    'issueops:create-tenant-repos:',
    'issueops:manage-org-variables:',
    'issueops:add-team-repo-access:',
    'issueops:create-tenant-subteam:',
  ];

  for (const prefix of alreadyFitting) {
    assert.equal(
      terminalStateLabel(prefix, 'partially_executed'),
      `${prefix}partially_executed`,
      `${prefix} already fits and must keep the long spelling`
    );
  }

  // executed and failed are short enough everywhere and must never be rewritten.
  for (const [, prefix] of OPERATION_LABEL_PREFIXES) {
    assert.equal(terminalStateLabel(prefix, 'executed'), `${prefix}executed`);
    assert.equal(terminalStateLabel(prefix, 'failed'), `${prefix}failed`);
  }
});

test('only the prefixes that would overflow get the shortened suffix', () => {
  const shortened = OPERATION_LABEL_PREFIXES
    .filter(([, prefix]) => labelSuffixForStatus(prefix, 'partially_executed') !== 'partially_executed')
    .map(([operation]) => operation)
    .sort();

  assert.deepEqual(shortened, [
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
  ], 'the set of operations needing a shortened suffix has changed');

  // And every one of them now fits.
  for (const [operation, prefix] of OPERATION_LABEL_PREFIXES) {
    const label = terminalStateLabel(prefix, 'partially_executed');
    assert.ok(
      label.length <= GITHUB_LABEL_MAX_LENGTH,
      `${label} is ${label.length} characters for ${operation}`
    );
  }
});

test('reading a label back accepts the long spelling that may already be live', () => {
  // An issue labelled before this change carries the long form even for a prefix that
  // now writes the short one. Both must resolve to the same status.
  const overflowingPrefix = 'issueops:create-tenant-hosted-runner:';
  const variants = terminalStateLabelVariants(overflowingPrefix, 'partially_executed');

  assert.ok(
    variants.includes(`${overflowingPrefix}partially_executed`),
    'the older long spelling must still be recognised'
  );
  assert.ok(
    variants.includes(`${overflowingPrefix}partial`),
    'the new short spelling must be recognised'
  );

  assert.equal(statusForLabelSuffix('partial'), 'partially_executed');
  assert.equal(statusForLabelSuffix('partially_executed'), 'partially_executed');
  assert.equal(statusForLabelSuffix('executed'), 'executed');
  assert.equal(statusForLabelSuffix('failed'), 'failed');
  assert.equal(statusForLabelSuffix('approved_failed'), 'approved_failed');
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
