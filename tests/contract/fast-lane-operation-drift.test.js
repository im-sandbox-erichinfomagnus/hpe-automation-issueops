'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

// The gate's CICD_FAST_LANE_OPERATIONS list is module-private, so this guard derives the
// effective list by behaviour instead of importing it: any operation that auto-approves a
// role holder is in the fast lane. Drift in either direction fails here.
const EXPECTED_FAST_LANE_OPERATIONS = [
  'hosted_runner_creation',
  'hosted_runner_deletion',
  'hosted_runner_move',
  'runner_group_creation',
  'tenant_variable_management',
];

// Skipping the approval comment is not only the fast lane: the tenant self-serve policy
// skips it too, under approver_role 'tenant_self_serve'. Until 1.0.8 that second list was
// unconditional, so nothing here could tell the two apart. add-repo-admin and add-cicd-admin
// are now requester-aware and only auto-approve for a requester who holds the tenant role,
// so the full set of operations that reach execution without an approval comment is pinned
// by authorization path, not just the fast-lane subset.
const EXPECTED_POLICY_AUTO_APPROVED_FOR_ROLE_HOLDER = [
  ...EXPECTED_FAST_LANE_OPERATIONS,
  'cicd_admin_membership',
  'org_variable_management',
  'repo_admin_membership',
  'tenant_repo_creation',
  'tenant_subteam_creation',
];

// The same list with the two requester-routed operations removed: a requester holding no
// tenant role no longer skips approval on either of them.
const EXPECTED_POLICY_AUTO_APPROVED_FOR_NON_HOLDER = [
  'org_variable_management',
  'tenant_repo_creation',
  'tenant_subteam_creation',
];

const REQUESTER_ROUTED_OPERATIONS = ['cicd_admin_membership', 'repo_admin_membership'];

// Every metadata.operation value the product emits.
const ALL_OPERATIONS = [
  'cicd_admin_membership',
  'hosted_runner_creation',
  'hosted_runner_deletion',
  'hosted_runner_move',
  'org_variable_management',
  'repo_admin_membership',
  'repository_ruleset_creation',
  'repository_ruleset_deletion',
  'runner_group_creation',
  'team_creation',
  'team_hierarchy',
  'team_membership',
  'team_repo_access',
  'team_repo_access_removal',
  'tenant_creation',
  'tenant_repo_creation',
  'tenant_subteam_creation',
  'tenant_variable_management',
];

const ROLE_HOLDER_PATHS = ['tenant_cicd_admin_team', 'tenant_admin_maintainer'];

function writeArtifact(operation, authorizationPath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-lane-drift-'));
  const artifactPath = path.join(directory, 'validation.json');
  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: { operation, run_id: '1', run_attempt: '1' },
    request: {
      requester_login: 'cicd-team-member',
      organization: 'octo-org',
      repository: 'octo-org/central',
      context_marker: 'fast-lane-drift-context:1',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      designated_approver_login: 'org-owner-user',
    },
    validation: {
      is_valid: true,
      validation_findings: {
        tenant_resolution_status: 'resolved',
        requester_authorization_path: authorizationPath,
      },
    },
    approval: { approval_status: 'pending' },
    execution: { summary: '' },
    reconciliation: null,
  }), 'utf8');
  return artifactPath;
}

async function gate(operation, authorizationPath) {
  return runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact(operation, authorizationPath),
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: username === 'org-owner-user' ? 'admin' : 'member',
          state: 'active',
        },
      }),
    },
    setProcessExitCode: false,
  });
}

async function observedFastLaneOperations(authorizationPath) {
  const observed = [];
  for (const operation of ALL_OPERATIONS) {
    const result = await gate(operation, authorizationPath);
    if (result.approval.approver_role === 'tenant_role_holder') {
      observed.push(operation);
    }
  }
  return observed.sort();
}

for (const authorizationPath of ROLE_HOLDER_PATHS) {
  test(`the fast lane admits exactly the expected operations for ${authorizationPath}`, async () => {
    assert.deepEqual(
      await observedFastLaneOperations(authorizationPath),
      [...EXPECTED_FAST_LANE_OPERATIONS].sort()
    );
  });
}

test('no operation enters the fast lane for a non-holder', async () => {
  assert.deepEqual(await observedFastLaneOperations('none'), []);
});

test('no operation enters the fast lane when the authorization path is absent', async () => {
  assert.deepEqual(await observedFastLaneOperations(undefined), []);
});

async function observedPolicyAutoApprovedOperations(authorizationPath) {
  const observed = [];
  for (const operation of ALL_OPERATIONS) {
    const result = await gate(operation, authorizationPath);
    if (result.approval.approval_status === 'approved' && result.approval.decision_source === 'policy') {
      observed.push(operation);
    }
  }
  return observed.sort();
}

for (const authorizationPath of ROLE_HOLDER_PATHS) {
  test(`exactly the expected operations skip the approval comment for ${authorizationPath}`, async () => {
    assert.deepEqual(
      await observedPolicyAutoApprovedOperations(authorizationPath),
      [...EXPECTED_POLICY_AUTO_APPROVED_FOR_ROLE_HOLDER].sort()
    );
  });
}

test('exactly the expected operations skip the approval comment for a non-holder', async () => {
  assert.deepEqual(
    await observedPolicyAutoApprovedOperations('none'),
    [...EXPECTED_POLICY_AUTO_APPROVED_FOR_NON_HOLDER].sort()
  );
});

test('the requester-routed operations wait for an approval comment when the requester holds no role', async () => {
  for (const operation of REQUESTER_ROUTED_OPERATIONS) {
    for (const authorizationPath of ['none', undefined]) {
      const result = await gate(operation, authorizationPath);
      assert.equal(result.approval.approval_status, 'pending', `${operation}/${authorizationPath}`);
      assert.equal(result.request.request_status, 'awaiting_approval', `${operation}/${authorizationPath}`);
    }
  }
});

test('repository ruleset operations are never in the fast lane', async () => {
  for (const operation of ['repository_ruleset_creation', 'repository_ruleset_deletion']) {
    for (const authorizationPath of ROLE_HOLDER_PATHS) {
      const result = await gate(operation, authorizationPath);
      assert.notEqual(result.approval.approver_role, 'tenant_role_holder', `${operation}/${authorizationPath}`);
      assert.equal(result.approval.approval_status, 'pending', `${operation}/${authorizationPath}`);
    }
  }
});
