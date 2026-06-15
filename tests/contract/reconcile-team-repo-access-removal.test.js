'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { reconcileTeamRepoAccessRemoval } = require('../../src/workflow-support/reconcile-team-repo-access-removal');

test('reconciliation classifies remove, noop_already_absent, and reject outcomes', () => {
  const plan = reconcileTeamRepoAccessRemoval({
    request: { dry_run: false, intake_mode: 'manual' },
    validatedRepositoryRemovals: [
      {
        repository_full_name: 'octo-org/service-catalog',
        validation_status: 'valid',
        desired_action: 'remove_access',
      },
      {
        repository_full_name: 'octo-org/developer-portal',
        validation_status: 'already_absent',
        desired_action: 'noop_already_absent',
      },
      {
        repository_full_name: 'octo-org/legacy-portal',
        validation_status: 'archived_blocked',
        desired_action: 'reject',
        failure_reason: 'archived_repository',
      },
    ],
  });

  assert.deepEqual(plan.removals_to_apply.map((entry) => entry.repository_full_name), ['octo-org/service-catalog']);
  assert.deepEqual(plan.already_absent_noops.map((entry) => entry.repository_full_name), ['octo-org/developer-portal']);
  assert.deepEqual(plan.rejected_items.map((entry) => entry.repository_full_name), ['octo-org/legacy-portal']);
  assert.equal(plan.state, 'approved_for_execution');
});

test('reconciliation stays idempotent when everything is already absent', () => {
  const plan = reconcileTeamRepoAccessRemoval({
    request: { dry_run: false, intake_mode: 'csv_attachment' },
    validatedRepositoryRemovals: [
      {
        repository_full_name: 'octo-org/service-catalog',
        validation_status: 'already_absent',
        desired_action: 'noop_already_absent',
      },
      {
        repository_full_name: 'octo-org/developer-portal',
        validation_status: 'already_absent',
        desired_action: 'noop_already_absent',
      },
    ],
  });

  assert.deepEqual(plan.removals_to_apply, []);
  assert.deepEqual(plan.already_absent_noops.map((entry) => entry.repository_full_name), [
    'octo-org/service-catalog',
    'octo-org/developer-portal',
  ]);
  assert.equal(plan.state, 'validated');
});
