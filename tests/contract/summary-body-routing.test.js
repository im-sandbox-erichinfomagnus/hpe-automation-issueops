'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');

// #119 fixed the summary HEADER for all eighteen operations. The BODY is chosen by a
// separate set of branches, and those branches used to re-derive the operation from
// request fields: `operation === 'tenant_creation' || Boolean(request.tenant_key || ...)`.
//
// The second clause ignored the operation. Four operations carry a tenant key without
// being a tenant creation - tenant subteam creation, repo-admin and CICD-admin
// membership, and tenant variable management - so they rendered the tenant-creation body
// under their own correct header: "Topology root team", "Compatibility provenance",
// "Tenant CICD-admin team", almost all n/a, and nothing about the operation actually
// requested.
//
// Those clauses were redundant. The operation is resolved once, before any branch, as
// `metadata.operation || determineOperation(request)`, and determineOperation performs
// the same field inference AND prefers an explicit operation. Re-checking the fields per
// branch could only override a correct answer.

// Fields that appear only in the tenant-creation body. If one of these shows up for
// another operation, that operation is being rendered as a tenant creation.
const TENANT_CREATION_ONLY_FIELDS = [
  'Topology root team',
  'Topology nodes',
  'Compatibility provenance',
  'Tenant parent team',
  'Tenant repo-admin team',
  'Tenant CICD-admin team',
];

// The four operations that carry a tenant key and are not tenant creation.
const TENANT_KEYED_OPERATIONS = [
  ['tenant_variable_management', '# Manage Tenant Variables Workflow Summary'],
  ['tenant_subteam_creation', '# Create Tenant Subteam Workflow Summary'],
  ['repo_admin_membership', '# Add Repo Admin to Tenant Workflow Summary'],
  ['cicd_admin_membership', '# Add CICD Admin to Tenant Workflow Summary'],
];

function artifactFor(operation) {
  return {
    metadata: { operation },
    request: {
      request_id: 'org/repo#1/1.1',
      repository: 'org/repo',
      organization: 'org',
      requester_login: 'octocat',
      intake_mode: 'manual',
      dry_run: false,
      request_status: 'executed',
      // The field that used to hijack the body selector. These operations legitimately
      // carry it: they act on a tenant, they do not create one.
      tenant_key: 'tenant01',
      tenant_display_name: 'Tenant01',
    },
    validation: { is_valid: true, errors: [], warnings: [] },
    approval: { approval_status: 'approved', approver_role: 'target_org_owner' },
    execution: { mutation_count: 1, noop_count: 0, pending_count: 0, failure_count: 0 },
  };
}

for (const [operation, expectedHeader] of TENANT_KEYED_OPERATIONS) {
  test(`${operation} renders its own header and not the tenant creation body`, () => {
    const summary = String(formatAuditSummary(artifactFor(operation)));
    const [header] = summary.split('\n');

    assert.equal(header, expectedHeader, 'the header must name this operation');

    const leaked = TENANT_CREATION_ONLY_FIELDS.filter((field) => summary.includes(field));
    assert.deepEqual(
      leaked,
      [],
      `${operation} carries a tenant key but is not a tenant creation, so the tenant creation body must not be used. Leaked fields: ${leaked.join(', ')}`
    );
  });
}

test('tenant creation itself still renders the tenant creation body', () => {
  // The branch these operations were wrongly falling into must keep working for the
  // operation it belongs to.
  const summary = String(formatAuditSummary(artifactFor('tenant_creation')));

  assert.equal(summary.split('\n')[0], '# Create Tenant Model Workflow Summary');
  for (const field of TENANT_CREATION_ONLY_FIELDS) {
    assert.ok(summary.includes(field), `tenant creation must still render ${field}`);
  }
});

test('an artifact with no operation still infers one from its fields', () => {
  // Removing the per-branch field checks must not remove the inference itself. A request
  // that carries a tenant key and no recorded operation is still a tenant creation,
  // because determineOperation says so before any branch is evaluated.
  const artifact = artifactFor('tenant_creation');
  delete artifact.metadata;

  const summary = String(formatAuditSummary(artifact));
  assert.equal(summary.split('\n')[0], '# Create Tenant Model Workflow Summary');
  assert.ok(summary.includes('Topology root team'), 'the inferred operation must still pick the body');
});
