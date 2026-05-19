'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { reconcileTeamMembers } = require('../../src/workflow-support/reconcile-team-members');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'current-team-members.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('reconciliation plans adds for all-new requested members', () => {
  const scenario = loadFixture().all_new;
  const plan = reconcileTeamMembers({
    request: { dry_run: false },
    validatedPeople: scenario.requested_people,
    currentMembers: scenario.current_members,
  });

  assert.deepEqual(plan.people_to_add.map((entry) => entry.username), ['octocat', 'hubot']);
  assert.deepEqual(plan.people_already_present, []);
  assert.equal(plan.state, 'approved_for_execution');
});

test('reconciliation plans mixed add and no-op results for partially satisfied membership', () => {
  const scenario = loadFixture().partially_satisfied;
  const plan = reconcileTeamMembers({
    request: { dry_run: false },
    validatedPeople: scenario.requested_people,
    currentMembers: scenario.current_members,
  });

  assert.deepEqual(plan.people_to_add.map((entry) => entry.username), ['hubot']);
  assert.deepEqual(plan.people_already_present.map((entry) => entry.username), ['octocat']);
  assert.equal(plan.people_already_present[0].current_membership_state, 'active');
});

test('reconciliation emits no-op plan when all requested members are already present', () => {
  const scenario = loadFixture().fully_satisfied;
  const plan = reconcileTeamMembers({
    request: { dry_run: false },
    validatedPeople: scenario.requested_people,
    currentMembers: scenario.current_members,
  });

  assert.deepEqual(plan.people_to_add, []);
  assert.deepEqual(plan.people_already_present.map((entry) => entry.username), ['octocat', 'hubot']);
  assert.equal(plan.people_already_present[1].current_membership_state, 'pending');
});

test('reconciliation preserves CSV source row provenance for add and no-op outcomes', () => {
  const plan = reconcileTeamMembers({
    request: { dry_run: false, intake_mode: 'bulk_csv' },
    validatedPeople: [
      { username: 'octocat', source_row_number: 1, resolution_status: 'resolved' },
      { username: 'hubot', source_row_number: 2, resolution_status: 'resolved' },
    ],
    currentMembers: [
      { login: 'octocat', state: 'active' },
    ],
  });

  assert.deepEqual(
    plan.people_already_present.map((entry) => ({ username: entry.username, source_row_number: entry.source_row_number })),
    [{ username: 'octocat', source_row_number: 1 }]
  );
  assert.deepEqual(
    plan.people_to_add.map((entry) => ({ username: entry.username, source_row_number: entry.source_row_number })),
    [{ username: 'hubot', source_row_number: 2 }]
  );
});