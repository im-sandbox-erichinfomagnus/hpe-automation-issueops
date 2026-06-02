'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildExecutionOutcome } = require('../../src/workflow-support/build-execution-outcome');

<<<<<<< HEAD
test('buildExecutionOutcome preserves explicit zero row counts over bulk CSV fallback values', () => {
=======
test('buildExecutionOutcome preserves explicit zero row counts over fallback bulk CSV metadata', () => {
>>>>>>> origin/main
  const outcome = buildExecutionOutcome({
    executionResults: [],
    duplicate_row_count: 0,
    invalid_row_count: 0,
    bulk_csv_submission: {
      duplicate_row_count: 4,
      invalid_row_count: 3,
    },
  });

  assert.equal(outcome.duplicate_row_count, 0);
  assert.equal(outcome.invalid_row_count, 0);
});