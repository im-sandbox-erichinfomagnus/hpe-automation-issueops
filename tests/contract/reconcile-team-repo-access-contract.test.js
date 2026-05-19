'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { reconcileTeamRepoAccess } = require('../../src/workflow-support/reconcile-team-repo-access');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-repo-access-validation.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('reconciliation plans grants for all-new requested repository access', () => {
  const scenario = loadFixture().visible_org;
  const plan = reconcileTeamRepoAccess({
    request: { dry_run: false },
    validatedRepositoryGrants: scenario.repositories['octo-org/service-catalog'] ? [
      {
        requested_repository_name: 'service-catalog',
        repository_owner: 'octo-org',
        repository_name: 'service-catalog',
        repository_full_name: 'octo-org/service-catalog',
        validation_status: 'valid',
        desired_action: 'grant_access',
      }
    ] : [],
  });

  assert.deepEqual(plan.repositories_to_grant.map((entry) => entry.repository_full_name), ['octo-org/service-catalog']);
  assert.deepEqual(plan.repositories_already_satisfied, []);
  assert.equal(plan.state, 'approved_for_execution');
});

test('reconciliation plans mixed grant and no-op results for partially satisfied repository access', () => {
  const plan = reconcileTeamRepoAccess({
    request: { dry_run: false },
    validatedRepositoryGrants: [
      {
        repository_full_name: 'octo-org/service-catalog',
        validation_status: 'valid',
        desired_action: 'grant_access',
      },
      {
        repository_full_name: 'octo-org/developer-portal',
        validation_status: 'stronger_existing_access',
        desired_action: 'noop',
      }
    ],
  });

  assert.deepEqual(plan.repositories_to_grant.map((entry) => entry.repository_full_name), ['octo-org/service-catalog']);
  assert.deepEqual(plan.repositories_already_satisfied.map((entry) => entry.repository_full_name), ['octo-org/developer-portal']);
});

test('reconciliation preserves weaker-existing-access rejections', () => {
  const plan = reconcileTeamRepoAccess({
    request: { dry_run: false },
    validatedRepositoryGrants: [
      {
        repository_full_name: 'octo-org/legacy-portal',
        validation_status: 'weaker_existing_access',
        desired_action: 'reject',
        failure_reason: 'weaker_existing_access',
      }
    ],
  });

  assert.deepEqual(plan.repositories_to_grant, []);
  assert.deepEqual(plan.repositories_rejected.map((entry) => entry.failure_reason), ['weaker_existing_access']);
  assert.equal(plan.state, 'approved_for_execution');
});