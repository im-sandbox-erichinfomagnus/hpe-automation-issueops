'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  parseCostCenterCsv,
  parseCostCenterRequest,
  splitCsvLine,
} = require('../../src/workflow-support/parse-cost-center-request');

test('manage-cost-centers fixture scaffold and issue form are present', () => {
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'manage-cost-centers-issue.md'), 'utf8');
  assert.match(fixture, /Enterprise slug/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Cost centers spreadsheet/i);

  const form = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'manage-cost-centers.yml'), 'utf8');
  assert.match(form, /id:\s+enterprise/);
  assert.match(form, /id:\s+designated_approver/);
  assert.match(form, /id:\s+cost_centers/);
  assert.match(form, /id:\s+dry_run/);
  assert.match(form, /id:\s+justification/);
});

test('csv splitter honors double-quoted fields with commas', () => {
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('"Platform, Eng",create,,,'), ['Platform, Eng', 'create', '', '', '']);
  assert.deepEqual(splitCsvLine('"He said ""hi""",rename'), ['He said "hi"', 'rename']);
});

test('parseCostCenterCsv reads header, rows, and flags unsupported columns', () => {
  const parsed = parseCostCenterCsv([
    'cost_center,action,new_name,cost_center_id,force,extra',
    'Platform Engineering,create,,,',
    'AI Model Routing,rename,AI Platform Routing,,',
    'Retired Sandbox,delete,,,true',
  ].join('\n'));

  assert.equal(parsed.schema_status, 'valid');
  assert.deepEqual(parsed.unsupported_columns, ['extra']);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].source_row_number, 1);
  assert.equal(parsed.rows[0].action, 'create');
  assert.equal(parsed.rows[1].new_name_input, 'AI Platform Routing');
  assert.equal(parsed.rows[2].force, true);
});

test('parseCostCenterCsv detects a missing required header', () => {
  const parsed = parseCostCenterCsv('name,verb\nPlatform,create');
  assert.equal(parsed.schema_status, 'invalid_header');
});

test('parseCostCenterRequest unwraps a code-fenced CSV and dedupes rows', () => {
  const request = parseCostCenterRequest({
    parsedRequest: {
      enterprise: 'Octo-Enterprise',
      designated_approver: 'Billing-Manager',
      dry_run: 'false',
      justification: 'cleanup',
      cost_centers: '```csv\ncost_center,action\nPlatform Engineering,create\nPlatform Engineering,create\n```',
    },
    issue: { number: 7, user: { login: 'requester' } },
  });

  assert.equal(request.enterprise, 'Octo-Enterprise');
  assert.equal(request.enterprise_normalized, 'octo-enterprise');
  assert.equal(request.designated_approver_login, 'billing-manager');
  assert.equal(request.dry_run, false);
  assert.equal(request.duplicate_row_count, 1);
  assert.equal(request.requested_changes.length, 1);
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.request_status, 'submitted');
});

test('parseCostCenterRequest defaults dry_run to true', () => {
  const request = parseCostCenterRequest({
    parsedRequest: { enterprise: 'e', designated_approver: 'a', cost_centers: 'cost_center,action\nX,create' },
    issue: { number: 1, user: { login: 'r' } },
  });
  assert.equal(request.dry_run, true);
});
