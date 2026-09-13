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

// Expected headers are spelled out here rather than imported, so a wrong entry in
// OPERATION_SUMMARY_HEADERS cannot make this test agree with it.
const OPERATION_HEADERS = [
  ['tenant_creation', '# Create Tenant Model Workflow Summary'],
  ['tenant_repo_creation', '# Create Tenant Repositories Workflow Summary'],
  ['tenant_subteam_creation', '# Create Tenant Subteam Workflow Summary'],
  ['hosted_runner_creation', '# Create Tenant GitHub-Hosted Runner Workflow Summary'],
  ['hosted_runner_deletion', '# Delete Tenant GitHub-Hosted Runner Workflow Summary'],
  ['hosted_runner_move', '# Move Tenant GitHub-Hosted Runner Workflow Summary'],
  ['runner_group_creation', '# Create Tenant Runner Group Workflow Summary'],
  ['cicd_admin_membership', '# Add CICD Admin to Tenant Workflow Summary'],
  ['repo_admin_membership', '# Add Repo Admin to Tenant Workflow Summary'],
  ['tenant_variable_management', '# Manage Tenant Variables Workflow Summary'],
  ['org_variable_management', '# Manage Org Variables Workflow Summary'],
  ['repository_ruleset_creation', '# Create Repository Ruleset Workflow Summary'],
  ['repository_ruleset_deletion', '# Delete Repository Ruleset Workflow Summary'],
  ['team_creation', '# Create Organization Teams Workflow Summary'],
  ['team_membership', '# Add Team Members Workflow Summary'],
  ['team_hierarchy', '# Add Child Teams Workflow Summary'],
  ['team_repo_access', '# Add Team Repository Access Workflow Summary'],
  ['team_repo_access_removal', '# Remove Team Repository Access Workflow Summary'],
];

for (const [operation, expectedHeader] of OPERATION_HEADERS) {
  test(`formatAuditSummary renders the ${operation} summary header`, () => {
    // tenant_key is the field that used to hijack the header via the tenant-creation
    // fallback, so it is present deliberately: the operation must still win.
    const summary = formatAuditSummary({
      metadata: { operation },
      request: { request_id: 'req-header', tenant_key: 'acme', tenant_display_name: 'Acme' },
    });

    assert.equal(summary.split('\n')[0], expectedHeader);
  });
}

test('formatAuditSummary gives every operation a distinct summary header', () => {
  const headers = OPERATION_HEADERS.map(([, header]) => header);

  assert.equal(new Set(headers).size, headers.length);
});
