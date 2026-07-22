'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateApprovalGate } = require('../../src/workflow-support/approval-gate');
const { buildExecutionOutcome } = require('../../src/workflow-support/build-execution-outcome');

test('tenant repo approval binds approved context marker to latest marker when approver is authorized', async () => {
  const result = await evaluateApprovalGate({
    approvalMode: 'tenant_repo_creation',
    request_status: 'awaiting_approval',
    issueComments: [
      {
        id: 10,
        body: 'approved',
        created_at: '2026-06-01T00:00:00Z',
        user: { login: 'owner-user' },
      },
    ],
    latest_context_marker: 'tenant-repo-context:abc123',
    prior_approved_context_marker: 'tenant-repo-context:stale',
  }, {
    resolveRole: async () => ({
      approver_role: 'target_org_owner',
      approver_authorization_state: 'authorized',
      approver_membership_state: 'active',
      approver_login: 'owner-user',
    }),
  });

  assert.equal(result.approval_status, 'approved');
  assert.equal(result.latest_context_marker, 'tenant-repo-context:abc123');
  assert.equal(result.approved_context_marker, 'tenant-repo-context:abc123');
});

test('tenant repo approval invalidates stale approved marker when no fresh approval comment is present', async () => {
  const result = await evaluateApprovalGate({
    approvalMode: 'tenant_repo_creation',
    request_status: 'awaiting_approval',
    priorApprovalStatus: 'approved',
    latest_context_marker: 'tenant-repo-context:new',
    prior_approved_context_marker: 'tenant-repo-context:old',
    issueComments: [],
  });

  assert.equal(result.approval_status, 'invalidated');
  assert.equal(result.latest_context_marker, 'tenant-repo-context:new');
  assert.equal(result.approved_context_marker, 'tenant-repo-context:old');
  assert.match(result.decision_note, /invalidated/i);
});

test('execution outcome reports context binding status and topology governance identifiers', () => {
  const outcome = buildExecutionOutcome({
    request_status: 'executed',
    summary: 'Execution completed for tenant repository request.',
    approved_context_marker: 'tenant-repo-context:xyz',
    latest_context_marker: 'tenant-repo-context:xyz',
    execution_context_marker: 'tenant-repo-context:xyz',
    topology_mode: 'canonical',
    tenant_id: 'contosouk',
    tenant_team_slug: 'contosouk_tenant',
    repo_admin_team_slug: 'contosouk_repoadmins',
    repository_creation_result: 'created',
    repo_admin_grant_result: 'granted',
    audit_persistence_result: 'persisted',
  });

  assert.equal(outcome.context_binding_status, 'matched');
  assert.equal(outcome.approved_context_marker, 'tenant-repo-context:xyz');
  assert.equal(outcome.latest_context_marker, 'tenant-repo-context:xyz');
  assert.equal(outcome.execution_context_marker, 'tenant-repo-context:xyz');
  assert.equal(outcome.topology_mode, 'canonical');
  assert.equal(outcome.tenant_id, 'contosouk');
  assert.equal(outcome.tenant_team_slug, 'contosouk_tenant');
  assert.equal(outcome.repo_admin_team_slug, 'contosouk_repoadmins');
});