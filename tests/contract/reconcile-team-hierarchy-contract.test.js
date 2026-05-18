'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { reconcileTeamHierarchy } = require('../../src/workflow-support/reconcile-team-hierarchy');

function loadFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'github-api', 'team-hierarchy-validation.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('reconciliation plans links for all-new requested child teams', () => {
  const scenario = loadFixture().visible_org;
  const plan = reconcileTeamHierarchy({
    request: { dry_run: false, parent_team_slug: 'platform-engineering' },
    validatedChildLinks: [
      {
        requested_child_name: 'Application Platform',
        child_team_slug: 'application-platform',
        validation_status: 'valid',
        desired_action: 'link_child'
      }
    ],
    currentTeams: scenario.teams,
  });

  assert.deepEqual(plan.child_links_to_apply.map((entry) => entry.child_team_slug), ['application-platform']);
  assert.deepEqual(plan.child_links_already_present, []);
  assert.equal(plan.state, 'approved_for_execution');
});

test('reconciliation plans mixed link and no-op results from current hierarchy state', () => {
  const scenario = loadFixture().visible_org;
  const plan = reconcileTeamHierarchy({
    request: { dry_run: false, parent_team_slug: 'platform-engineering' },
    validatedChildLinks: [
      {
        requested_child_name: 'Application Platform',
        child_team_slug: 'application-platform',
        validation_status: 'valid',
        desired_action: 'link_child'
      },
      {
        requested_child_name: 'Release Engineering',
        child_team_slug: 'release-engineering',
        validation_status: 'valid',
        desired_action: 'link_child'
      }
    ],
    currentTeams: scenario.teams,
  });

  assert.deepEqual(plan.child_links_to_apply.map((entry) => entry.child_team_slug), ['application-platform']);
  assert.deepEqual(plan.child_links_already_present.map((entry) => entry.child_team_slug), ['release-engineering']);
});

test('reconciliation preserves re-parent-blocked and cycle-blocked child teams as rejected', () => {
  const plan = reconcileTeamHierarchy({
    request: { dry_run: false, parent_team_slug: 'platform-engineering' },
    validatedChildLinks: [
      {
        requested_child_name: 'Security Engineering',
        child_team_slug: 'security-engineering',
        validation_status: 'reparent_blocked',
        desired_action: 'reject',
        failure_reason: 'reparent_blocked'
      },
      {
        requested_child_name: 'Application Infrastructure',
        child_team_slug: 'application-infrastructure',
        validation_status: 'cycle_blocked',
        desired_action: 'reject',
        failure_reason: 'cycle_blocked'
      }
    ],
  });

  assert.deepEqual(plan.child_links_to_apply, []);
  assert.deepEqual(plan.child_links_rejected.map((entry) => entry.failure_reason), ['reparent_blocked', 'cycle_blocked']);
  assert.equal(plan.state, 'approved_for_execution');
});