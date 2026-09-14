'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function writeArtifact(operation, findings, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-owner-fast-lane-'));
  const artifactPath = path.join(directory, 'validation.json');
  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: { operation, run_id: '1', run_attempt: '1' },
    request: {
      requester_login: 'requester-user',
      organization: 'octo-org',
      repository: 'octo-org/central',
      issue_number: 501,
      context_marker: 'owner-fast-lane-context:1',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      tenant_admin_login: 'tenant-admin-user',
      designated_approver_login: 'org-owner-user',
      ...overrides,
    },
    validation: { is_valid: true, validation_findings: { tenant_resolution_status: 'resolved', ...findings } },
    approval: { approval_status: 'pending' },
    execution: { summary: '' },
    reconciliation: null,
  }), 'utf8');
  return artifactPath;
}

function buildApi(approvalComments) {
  return {
    getAssignableOwners: async () => ['queue-owner'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    listIssueComments: async () => approvalComments || [],
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
  };
}

async function gate(operation, findings, { comments, request } = {}) {
  return runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact(operation, findings, request),
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: buildApi(comments),
    setProcessExitCode: false,
  });
}

const OWNER = { requester_owner_gate: 'authorized', requester_membership_gate: 'authorized' };
const MEMBER = { requester_owner_gate: 'unauthorized', requester_membership_gate: 'authorized' };

test('an organization owner creating a tenant is approved without an approval comment', async () => {
  const result = await gate('tenant_creation', OWNER);

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_role, 'target_org_owner');
  assert.equal(result.approval.decision_source, 'policy');
  assert.equal(result.approval.approver_login, 'requester-user');
  assert.equal(result.request.request_status, 'approved');
  assert.match(result.approval.decision_note, /active organization owner/);
});

test('an owner who names themselves as tenant admin is still approved without a comment', async () => {
  const result = await gate('tenant_creation', OWNER, {
    request: { tenant_admin_login: 'requester-user' },
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_role, 'target_org_owner');
  assert.equal(result.request.request_status, 'approved');
});

test('a member creating a tenant is NOT auto-approved and still waits for the tenant admin', async () => {
  const result = await gate('tenant_creation', MEMBER);

  assert.equal(result.approval.approval_status, 'pending');
  assert.notEqual(result.approval.decision_source, 'policy');
  assert.notEqual(result.request.request_status, 'approved');
});

test("a member's tenant request is still approved by the tenant admin named on it", async () => {
  const result = await gate('tenant_creation', MEMBER, {
    comments: [
      {
        id: 3101,
        body: 'approved',
        created_at: '2026-06-05T10:00:00Z',
        user: { login: 'tenant-admin-user' },
      },
    ],
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.request.request_status, 'approved');
});

test('the central assignment still runs for a member, because that request is queued', async () => {
  const result = await gate('tenant_creation', MEMBER);

  assert.equal(result.assignment.assignment_status, 'assigned');
  assert.equal(result.assignment.assigned_login, 'queue-owner');
});

test('the tenant CI/CD fast lane is unchanged by the owner fast lane', async () => {
  const result = await gate('hosted_runner_creation', {
    requester_authorization_path: 'tenant_cicd_admin_team',
    requester_owner_gate: 'unauthorized',
    requester_membership_gate: 'authorized',
  });

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.approver_role, 'tenant_role_holder');
  assert.equal(result.approval.decision_source, 'policy');
  assert.match(result.approval.decision_note, /tenant CI\/CD role/);
});

test('an owner filing a non-tenant-creation operation is not fast-laned', async () => {
  const result = await gate('team_membership', OWNER);

  assert.notEqual(result.approval.approval_status, 'approved');
  assert.notEqual(result.approval.decision_source, 'policy');
});
