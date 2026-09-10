'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

const FAST_LANE_OPERATIONS = [
  'hosted_runner_creation',
  'hosted_runner_deletion',
  'hosted_runner_move',
  'runner_group_creation',
  'tenant_variable_management',
];

function writeArtifact(operation, authorizationPath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-lane-gate-'));
  const artifactPath = path.join(directory, 'validation.json');
  const findings = { tenant_resolution_status: 'resolved' };
  if (authorizationPath !== undefined) {
    findings.requester_authorization_path = authorizationPath;
  }
  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: { operation, run_id: '1', run_attempt: '1' },
    request: {
      requester_login: 'cicd-team-member',
      organization: 'octo-org',
      repository: 'octo-org/central',
      context_marker: 'fast-lane-context:1',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      designated_approver_login: 'org-owner-user',
    },
    validation: { is_valid: true, validation_findings: findings },
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

async function gate(operation, authorizationPath, approvalComments) {
  const artifactPath = writeArtifact(operation, authorizationPath);
  return runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: buildApi(approvalComments),
    setProcessExitCode: false,
  });
}

for (const operation of FAST_LANE_OPERATIONS) {
  test(`${operation}: a tenant cicd-admin team holder is auto-approved without an approval comment`, async () => {
    const result = await gate(operation, 'tenant_cicd_admin_team');

    assert.equal(result.approval.approval_status, 'approved');
    assert.equal(result.approval.approver_role, 'tenant_role_holder');
    assert.equal(result.approval.decision_source, 'policy');
    assert.equal(result.approval.approver_login, 'cicd-team-member');
    assert.equal(result.request.request_status, 'approved');
  });

  test(`${operation}: a tenant admin-team holder is auto-approved (admin is an equivalent CI/CD role)`, async () => {
    const result = await gate(operation, 'tenant_admin_maintainer');

    assert.equal(result.approval.approval_status, 'approved');
    assert.equal(result.approval.approver_role, 'tenant_role_holder');
    assert.equal(result.approval.decision_source, 'policy');
  });

  test(`${operation}: a non-holder without an approval comment still waits for approval`, async () => {
    const result = await gate(operation, 'none');

    assert.equal(result.approval.approval_status, 'pending');
    assert.notEqual(result.approval.approver_role, 'tenant_role_holder');
  });
}

test('a non-holder with a valid org-owner approval comment still approves through the comment path', async () => {
  const result = await gate('hosted_runner_creation', 'none', [
    {
      id: 2101,
      body: 'approved',
      created_at: '2026-06-05T10:00:00Z',
      user: { login: 'org-owner-user' },
    },
  ]);

  assert.equal(result.approval.approval_status, 'approved');
  assert.equal(result.approval.decision_source, 'comment');
  assert.notEqual(result.approval.approver_role, 'tenant_role_holder');
});

test('an artifact with no requester_authorization_path falls through to the approval path without throwing', async () => {
  const result = await gate('hosted_runner_creation', undefined);

  assert.equal(result.approval.approval_status, 'pending');
  assert.notEqual(result.approval.approver_role, 'tenant_role_holder');
});

test('tenant self-serve operations keep their own approval path and never enter the fast lane', async () => {
  for (const operation of ['cicd_admin_membership', 'repo_admin_membership']) {
    const result = await gate(operation, 'tenant_cicd_admin_team');

    assert.equal(result.approval.approval_status, 'approved');
    assert.equal(result.approval.approver_role, 'tenant_self_serve', operation);
  }
});

test('repository ruleset operations are excluded from the fast lane even for a role holder', async () => {
  const result = await gate('repository_ruleset_creation', 'tenant_cicd_admin_team');

  assert.equal(result.approval.approval_status, 'pending');
  assert.notEqual(result.approval.approver_role, 'tenant_role_holder');
});
