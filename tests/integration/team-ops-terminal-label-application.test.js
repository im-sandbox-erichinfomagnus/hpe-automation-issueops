'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');

// #114 is "Executed label is missing for the IssueOps - add-team-members and add-child-teams".
//
// The labels were made to EXIST by the ensure-step added to those workflows, but the
// generic terminal-label application site in run-approved-execution.js only fired for an
// allowlist of operations that had each been appended as its own feature landed. The four
// team operations were never on that list, so on the manual intake path they executed
// successfully and the label was never applied - which is the reported symptom.
//
// Every test that previously asserted a team operation's terminal label set
// intake_mode to 'csv_attachment' (add-child-teams-workflow.test.js and
// add-team-repo-access-workflow.test.js), which is the one intake mode the allowlist
// already covered. Nothing asserted the manual path. These tests assert it.

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'github-api');

function loadApprovedArtifact(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
  return raw.approved_artifact || raw;
}

function writeArtifact(artifact) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-team-label-'));
  const file = path.join(dir, 'artifact.json');
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2), 'utf8');
  return file;
}

// Runs a real approved execution for add-team-members on the MANUAL intake path and
// reports which labels the run asked GitHub to apply.
async function runManualAddTeamMembers({ dryRun = false } = {}) {
  const artifact = loadApprovedArtifact('add-member-success.json');
  artifact.request.intake_mode = 'manual';
  artifact.request.dry_run = dryRun;
  if (artifact.reconciliation) {
    artifact.reconciliation.intake_mode = 'manual';
  }

  const appliedLabels = [];
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact(artifact),
      GITHUB_RUN_ID: '114114',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [],
      addOrUpdateTeamMembership: async ({ username }) => ({ username, state: 'active', role: 'member' }),
      listIssueLabels: async () => [],
      removeIssueLabel: async () => {},
      addIssueLabels: async ({ labels }) => {
        appliedLabels.push(...labels);
        return labels;
      },
    }),
    sleep: async () => {},
  });

  return { result, appliedLabels };
}

test('a manual-intake add-team-members execution applies its terminal state label', async () => {
  const { result, appliedLabels } = await runManualAddTeamMembers();

  // Guard the premise: if this stops being a successful manual execution the label
  // assertion below would pass or fail for the wrong reason.
  assert.equal(result.request.intake_mode, 'manual', 'the premise is the manual intake path');
  assert.equal(result.request.request_status, 'executed');
  assert.ok(result.execution.mutation_count > 0, 'the execution must actually have done something');

  assert.deepEqual(
    appliedLabels,
    ['issueops:add-team-members:executed'],
    'a successful manual-intake execution must apply the terminal state label the workflow pre-creates'
  );
});

test('the terminal state label is not applied on a dry run', async () => {
  // The application site must stay behind whatever stops a dry run mutating, so that
  // widening it by operation does not start labelling requests that changed nothing.
  const { result, appliedLabels } = await runManualAddTeamMembers({ dryRun: true });

  assert.equal(result.request.dry_run, true, 'the premise is a dry run');
  assert.deepEqual(appliedLabels, [], 'a dry run must not apply a terminal state label');
});

test('the csv_attachment path keeps applying its terminal state label', async () => {
  // The path that already worked. This fails if a fix replaces the allowlist in a way
  // that drops the intake mode it originally covered.
  const artifact = loadApprovedArtifact('add-member-success.json');
  artifact.request.intake_mode = 'csv_attachment';

  const appliedLabels = [];
  const result = await runApprovedExecution({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact(artifact),
      GITHUB_RUN_ID: '114115',
      GITHUB_RUN_ATTEMPT: '1',
    },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [],
      addOrUpdateTeamMembership: async ({ username }) => ({ username, state: 'active', role: 'member' }),
      listIssueLabels: async () => [],
      removeIssueLabel: async () => {},
      addIssueLabels: async ({ labels }) => {
        appliedLabels.push(...labels);
        return labels;
      },
    }),
    sleep: async () => {},
  });

  assert.equal(result.request.request_status, 'executed');
  assert.deepEqual(appliedLabels, ['issueops:add-team-members:executed']);
});
