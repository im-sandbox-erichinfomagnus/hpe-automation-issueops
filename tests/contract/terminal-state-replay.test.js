'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldReplayTerminalState,
  deriveTerminalStatusFromIssueLabels,
} = require('../../src/scripts/run-request-validation');

// A workflow re-runs whenever anyone comments on its issue, including when the issue is
// closed with a comment. If the request has already executed, revalidating it re-queries
// live GitHub, which by then reflects the work the request performed - so a completed
// delete looks like a delete of something that is not there.
//
// Repository ruleset and variable requests are always parsed with intake_mode 'manual'
// (parse-repository-ruleset-request.js, parse-org-variables-request.js,
// parse-tenant-variables-request.js), so while the replay guard required 'csv_attachment'
// they could never reach it. A successful ruleset deletion then recorded validation_failed
// over its own audit record on the next comment.

function commentDrivenRequest(intakeMode) {
  return {
    intake_mode: intakeMode,
    comment_context: { comment_id: 987654321 },
  };
}

test('a completed manual-intake request replays its terminal state instead of revalidating', () => {
  // The case that was broken: ruleset and variable requests are always 'manual'.
  for (const intakeMode of ['manual', 'csv_attachment', 'form', undefined]) {
    assert.equal(
      shouldReplayTerminalState(commentDrivenRequest(intakeMode), 'executed'),
      true,
      `intake_mode ${String(intakeMode)} should replay a recorded terminal state`
    );
  }
});

test('every terminal status a completed request can carry is replayed', () => {
  for (const status of ['executed', 'partially_executed', 'failed', 'approved_failed']) {
    assert.equal(
      shouldReplayTerminalState(commentDrivenRequest('manual'), status),
      true,
      `${status} is a terminal state and should replay`
    );
  }
});

test('a request with no terminal state label is validated normally', () => {
  // This is the guard that keeps first runs, and re-runs of unfinished requests, working.
  assert.equal(shouldReplayTerminalState(commentDrivenRequest('manual'), null), false);
  assert.equal(shouldReplayTerminalState(commentDrivenRequest('csv_attachment'), null), false);
  assert.equal(shouldReplayTerminalState(commentDrivenRequest('manual'), ''), false);
});

test('a run that is not comment-driven is validated normally', () => {
  // Opening the issue, editing it, or a workflow_dispatch replay must still validate.
  assert.equal(shouldReplayTerminalState({ intake_mode: 'manual' }, 'executed'), false);
  assert.equal(
    shouldReplayTerminalState({ intake_mode: 'manual', comment_context: {} }, 'executed'),
    false
  );
  assert.equal(
    shouldReplayTerminalState({ intake_mode: 'manual', comment_context: { comment_id: null } }, 'executed'),
    false
  );
  assert.equal(shouldReplayTerminalState({}, 'executed'), false);
});

test('a ruleset deletion labelled executed replays that status rather than re-deriving it', () => {
  // End to end over the two pieces that decide it: the label on the issue resolves to a
  // status, and that status makes the request replay instead of re-querying GitHub.
  const labels = ['delete-repository-ruleset', 'issueops:delete-repository-ruleset:executed'];
  const status = deriveTerminalStatusFromIssueLabels(labels, 'repository_ruleset_deletion');

  assert.equal(status, 'executed', 'the terminal label must resolve to its status');
  assert.equal(
    shouldReplayTerminalState(commentDrivenRequest('manual'), status),
    true,
    'a commented, already-executed ruleset deletion must not be revalidated'
  );
});

test('the shortened partial label still resolves and still replays', () => {
  // delete-repository-ruleset is one of the ten operations whose partially_executed label
  // overflows GitHub's 50-character limit and is written as ':partial'.
  const labels = ['issueops:delete-repository-ruleset:partial'];
  const status = deriveTerminalStatusFromIssueLabels(labels, 'repository_ruleset_deletion');

  assert.equal(status, 'partially_executed');
  assert.equal(shouldReplayTerminalState(commentDrivenRequest('manual'), status), true);
});
