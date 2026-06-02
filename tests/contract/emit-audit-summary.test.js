'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');

test('formatAuditSummary preserves explicit zero CSV counts over request-level fallback values', () => {
  const summary = formatAuditSummary({
    metadata: { operation: 'team_hierarchy' },
    request: {
      request_id: 'req-123',
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      parent_team_slug: 'platform-engineering',
      designated_approver_login: 'octocat',
      requester_login: 'requester',
      intake_mode: 'bulk_csv',
      request_status: 'executed',
      bulk_csv_submission: {
        duplicate_row_count: 4,
        invalid_row_count: 3,
      },
      requested_child_links: [],
    },
    validation: {
      is_valid: true,
    },
    execution: {
      duplicate_row_count: 0,
      invalid_row_count: 0,
      noop_count: 0,
      failure_count: 0,
      linked_count: 0,
    },
  });

  assert.match(summary, /CSV duplicate rows: 0/i);
  assert.match(summary, /CSV invalid rows: 0/i);
});