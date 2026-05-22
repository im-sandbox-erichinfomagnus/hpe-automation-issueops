'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');

test('formatAuditSummary preserves explicit zero CSV counts for bulk summary rendering', () => {
  const summary = formatAuditSummary({
    request: {
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      intended_owner_login: 'octocat',
      intake_mode: 'bulk_csv',
      request_status: 'awaiting_approval',
      requested_teams: [
        { requested_name: 'Platform Engineering' },
      ],
      bulk_csv_submission: {
        valid_row_count: 2,
        duplicate_row_count: 3,
        invalid_row_count: 4,
      },
    },
    validation: {
      is_valid: true,
      csv_row_findings: [{}, {}],
    },
    execution: {
      duplicate_row_count: 0,
      invalid_row_count: 0,
    },
  });

  assert.match(summary, /CSV duplicate rows: 0/i);
  assert.match(summary, /CSV invalid rows: 0/i);
});

test('formatAuditSummary preserves explicit zero CSV counts for attachment membership summaries', () => {
  const summary = formatAuditSummary({
    request: {
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requester_login: 'requester',
      intake_mode: 'csv_attachment',
      request_status: 'awaiting_approval',
      bulk_csv_submission: {
        valid_row_count: 2,
        duplicate_row_count: 5,
        invalid_row_count: 6,
      },
    },
    validation: {
      is_valid: true,
      csv_row_findings: [{}, {}],
    },
    execution: {
      duplicate_row_count: 0,
      invalid_row_count: 0,
    },
  });

  assert.match(summary, /CSV duplicate rows: 0/i);
  assert.match(summary, /CSV invalid rows: 0/i);
});