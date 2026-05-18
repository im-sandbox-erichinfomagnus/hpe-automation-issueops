'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { reconcileTeamCreation } = require('../../src/workflow-support/reconcile-team-creation');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'current-org-teams.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('reconciliation plans creates for all-new requested teams', () => {
  const scenario = loadFixture().no_existing_teams;
  const plan = reconcileTeamCreation({
    request: { dry_run: false },
    validatedTeams: [
      { requested_name: 'Platform Engineering', normalized_slug: 'platform-engineering', validation_status: 'valid' },
      { requested_name: 'AI Model Routing Specialists', normalized_slug: 'ai-model-routing-specialists', validation_status: 'valid' },
    ],
    currentTeams: scenario,
  });

  assert.deepEqual(plan.teams_to_create.map((entry) => entry.normalized_slug), [
    'platform-engineering',
    'ai-model-routing-specialists',
  ]);
  assert.deepEqual(plan.teams_already_present, []);
  assert.equal(plan.state, 'approved_for_execution');
});

test('reconciliation plans mixed create and no-op results for partially satisfied batches', () => {
  const scenario = loadFixture().existing_team;
  const plan = reconcileTeamCreation({
    request: { dry_run: false },
    validatedTeams: [
      { requested_name: 'Platform Engineering', normalized_slug: 'platform-engineering', validation_status: 'existing', desired_action: 'noop' },
      { requested_name: 'AI Model Routing Specialists', normalized_slug: 'ai-model-routing-specialists', validation_status: 'valid' },
    ],
    currentTeams: scenario,
  });

  assert.deepEqual(plan.teams_to_create.map((entry) => entry.normalized_slug), ['ai-model-routing-specialists']);
  assert.deepEqual(plan.teams_already_present.map((entry) => entry.normalized_slug), ['platform-engineering']);
  assert.equal(plan.teams_already_present[0].current_team_id, 1);
});

test('reconciliation emits a no-op plan when all requested teams are already present', () => {
  const scenario = loadFixture().existing_team;
  const plan = reconcileTeamCreation({
    request: { dry_run: false },
    validatedTeams: [
      { requested_name: 'Platform Engineering', normalized_slug: 'platform-engineering', validation_status: 'existing', desired_action: 'noop', current_team_id: 1 },
    ],
    currentTeams: scenario,
  });

  assert.deepEqual(plan.teams_to_create, []);
  assert.deepEqual(plan.teams_already_present.map((entry) => entry.normalized_slug), ['platform-engineering']);
  assert.equal(plan.state, 'validated');
});