'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CSV_ROW_NUMBERING_CONVENTION,
  OPTIONAL_COLUMNS,
  REQUIRED_COLUMNS,
  createEmptyCostCenterAssignmentNormalization,
  normalizeCostCenterAssignments,
} = require('../../src/workflow-support/normalize-cost-center-assignments');

test('parses a valid sheet with cost_center, login, action columns', () => {
  const csv = ['cost_center,login,action', 'CC-100,octocat,add', 'CC-200,hubot,remove'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.equal(result.encoding, 'utf-8');
  assert.deepEqual(result.header_columns, ['cost_center', 'login', 'action']);
  assert.deepEqual(result.required_columns, REQUIRED_COLUMNS);
  assert.deepEqual(result.optional_columns, OPTIONAL_COLUMNS);
  assert.deepEqual(result.unsupported_columns, []);
  assert.equal(result.row_count, 2);
  assert.equal(result.valid_row_count, 2);
  assert.equal(result.invalid_row_count, 0);
  assert.equal(result.duplicate_row_count, 0);
  assert.equal(result.schema_status, 'valid');
  assert.deepEqual(result.schema_errors, []);
  assert.equal(result.csv_row_numbering_convention, CSV_ROW_NUMBERING_CONVENTION);

  assert.deepEqual(result.normalizedAssignments, [
    { cost_center: 'CC-100', login: 'octocat', action: 'add', source_row_number: 1 },
    { cost_center: 'CC-200', login: 'hubot', action: 'remove', source_row_number: 2 },
  ]);
});

test('defaults action to add when the action column is absent', () => {
  const csv = ['cost_center,login', 'CC-100,octocat', 'CC-200,hubot'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.deepEqual(result.header_columns, ['cost_center', 'login']);
  assert.deepEqual(result.unsupported_columns, []);
  assert.equal(result.schema_status, 'valid');
  assert.equal(result.valid_row_count, 2);
  assert.deepEqual(result.normalizedAssignments, [
    { cost_center: 'CC-100', login: 'octocat', action: 'add', source_row_number: 1 },
    { cost_center: 'CC-200', login: 'hubot', action: 'add', source_row_number: 2 },
  ]);
});

test('defaults action to add when a single action cell is blank', () => {
  const csv = ['cost_center,login,action', 'CC-100,octocat,', 'CC-200,hubot,remove'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.equal(result.schema_status, 'valid');
  assert.deepEqual(result.normalizedAssignments, [
    { cost_center: 'CC-100', login: 'octocat', action: 'add', source_row_number: 1 },
    { cost_center: 'CC-200', login: 'hubot', action: 'remove', source_row_number: 2 },
  ]);
});

test('missing login header yields invalid schema with a login-specific error', () => {
  const csv = ['cost_center,action', 'CC-100,add'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.equal(result.schema_status, 'invalid');
  assert.ok(
    result.schema_errors.some((error) => error.includes('login')),
    `expected a schema error mentioning login, got: ${JSON.stringify(result.schema_errors)}`
  );
});

test('missing cost_center cell on a data row marks the row invalid', () => {
  const csv = ['cost_center,login', ',octocat', 'CC-200,hubot'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  const finding = result.csv_row_findings.find((row) => row.row_number === 1);
  assert.equal(finding.validation_status, 'invalid');
  assert.equal(finding.failure_reason, 'missing_cost_center');

  assert.equal(result.schema_status, 'invalid');
  assert.equal(result.invalid_row_count, 1);
  assert.equal(
    result.invalidAssignments.filter((entry) => entry.failure_reason === 'missing_cost_center')
      .length,
    1
  );
  assert.deepEqual(result.normalizedAssignments, [
    { cost_center: 'CC-200', login: 'hubot', action: 'add', source_row_number: 2 },
  ]);
});

test('implausible login is flagged invalid_login', () => {
  const csv = ['cost_center,login', 'CC-100,not a valid login'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  const finding = result.csv_row_findings.find((row) => row.row_number === 1);
  assert.equal(finding.validation_status, 'invalid');
  assert.equal(finding.failure_reason, 'invalid_login');
  assert.equal(result.invalid_row_count, 1);
  assert.equal(result.schema_status, 'invalid');
});

test('unsupported action value is flagged invalid_action', () => {
  const csv = ['cost_center,login,action', 'CC-100,octocat,delete'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  const finding = result.csv_row_findings.find((row) => row.row_number === 1);
  assert.equal(finding.validation_status, 'invalid');
  assert.equal(finding.failure_reason, 'invalid_action');
  assert.equal(result.invalid_row_count, 1);
  assert.equal(result.schema_status, 'invalid');
});

test('duplicate identical assignment keeps one valid and flags the other', () => {
  const csv = ['cost_center,login,action', 'CC-100,octocat,add', 'CC-100,octocat,add'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.equal(result.valid_row_count, 1);
  assert.equal(result.duplicate_row_count, 1);
  assert.equal(result.normalizedAssignments.length, 1);
  assert.deepEqual(result.duplicateAssignments, [
    { cost_center: 'CC-100', login: 'octocat', action: 'add', source_row_number: 2 },
  ]);

  const duplicateFinding = result.csv_row_findings.find((row) => row.row_number === 2);
  assert.equal(duplicateFinding.validation_status, 'duplicate');
  assert.equal(duplicateFinding.failure_reason, 'duplicate_assignment');
});

test('blank line in the middle is reported as blank', () => {
  const csv = ['cost_center,login', 'CC-100,octocat', '', 'CC-200,hubot'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  const blankFinding = result.csv_row_findings.find((row) => row.validation_status === 'blank');
  assert.ok(blankFinding, 'expected a blank row finding');
  assert.equal(blankFinding.failure_reason, 'blank_row');
  assert.equal(result.valid_row_count, 2);
});

test('unsupported header column is reported in schema_errors and unsupported_columns', () => {
  const csv = ['cost_center,login,team', 'CC-100,octocat,platform'].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.deepEqual(result.unsupported_columns, ['team']);
  assert.equal(result.schema_status, 'invalid');
  assert.ok(
    result.schema_errors.some((error) => error.includes('team')),
    `expected a schema error mentioning the unsupported column, got: ${JSON.stringify(result.schema_errors)}`
  );
  // The data row has the right cell count, so it is row-valid; the failure is header-level only.
  assert.equal(result.valid_row_count, 1);
  assert.equal(result.invalid_row_count, 0);
});

test('row sub-counts partition row_count on a mixed sheet', () => {
  const csv = [
    'cost_center,login,action',
    'CC-100,octocat,add',
    'CC-100,octocat,add',
    'CC-200,not a login,add',
    'CC-300,hubot,delete',
    '',
    'CC-400,monalisa,remove',
  ].join('\n');
  const result = normalizeCostCenterAssignments(csv);

  assert.equal(result.row_count, 6);
  assert.equal(result.valid_row_count, 2);
  assert.equal(result.duplicate_row_count, 1);
  const blankCount = result.csv_row_findings.filter(
    (finding) => finding.validation_status === 'blank'
  ).length;
  assert.equal(blankCount, 1);
  assert.equal(
    result.valid_row_count + result.invalid_row_count + result.duplicate_row_count + blankCount,
    result.row_count
  );
});

test('empty input matches the createEmpty not_provided shape', () => {
  const result = normalizeCostCenterAssignments('');
  const expected = createEmptyCostCenterAssignmentNormalization('');

  assert.equal(result.schema_status, 'not_provided');
  assert.deepEqual(result, expected);
});
