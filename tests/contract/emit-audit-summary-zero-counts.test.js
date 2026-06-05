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

test('formatAuditSummary shows tenant repo visibility fields and conflict details', () => {
  const summary = formatAuditSummary({
    request: {
      request_id: 'octo-org/issueops-speckit#22/100.1',
      repository: 'octo-org/issueops-speckit',
      organization: 'octo-org',
      tenant_name_input: 'Tenant A',
      repository_name_normalized: 'acme-platform-service',
      repository_visibility: 'private',
      repository_visibility_source: 'user_selected',
      designated_approver_login: 'octocat',
      requester_login: 'requester',
      request_status: 'failed',
    },
    validation: {
      is_valid: true,
      tenant_resolution: {
        tenant_resolution_status: 'resolved',
        tenant_match_count: 1,
      },
      validation_findings: {
        visibility_validation_status: 'valid',
        visibility_validation_reason: "Requested repository visibility 'private' is allowed.",
        allowed_repository_visibilities: ['private', 'internal', 'public'],
      },
      repository_exists: true,
      current_repo_admin_permission: 'admin',
    },
    reconciliation: {
      existing_visibility: 'public',
      actual_visibility: 'public',
      visibility_conflict: true,
      blocked_reason: 'visibility_conflict',
      creation_action: 'reject',
      permission_action: 'reject',
      boundary_revalidation_status: 'matched',
    },
    execution: {
      repository_creation_result: 'failed',
      repo_admin_grant_result: 'failed',
      failure_count: 1,
      mutation_count: 0,
      noop_count: 0,
      pending_count: 0,
      rollback_status: 'manual_follow_up_required',
    },
    metadata: {
      operation: 'tenant_repo_creation',
    },
  });

  assert.match(summary, /Requested repository visibility: private/i);
  assert.match(summary, /Actual repository visibility: public/i);
  assert.match(summary, /Visibility conflict: true/i);
  assert.match(summary, /Blocked reason: visibility_conflict/i);
});