'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateRunnerGroupRequest } = require('../../src/workflow-support/validate-runner-group-request');
const { validateHostedRunnerRequest } = require('../../src/workflow-support/validate-hosted-runner-request');
const { validateHostedRunnerDeletionRequest } = require('../../src/workflow-support/validate-hosted-runner-deletion-request');
const { validateHostedRunnerMoveRequest } = require('../../src/workflow-support/validate-hosted-runner-move-request');
const { validateTenantVariablesRequest } = require('../../src/workflow-support/validate-tenant-variables-request');
const { waivesApprovalComment, CICD_ROLE_HOLDER_PATHS } = require('../../src/workflow-support/cicd-fast-lane');

// Stephen, 14 Sep: "as an org member but also a Tenant Admin member, I was not able to create a
// runner group - the error is 'Designated approver must be an active target organization owner'
// but should instead be waiting on CAM approval."
//
// He holds the tenant role, so the 1.0.6 CI/CD fast lane was going to waive the approval comment
// entirely. He was rejected for failing to name an approver the product would never have asked.
// The same mandatory field sits on five operations, so all five are exercised here.
//
// STUB-VS-PRODUCTION API SURFACE (Piece 48 rule). The stub below supplies:
//   getOrganization, getOrganizationMembership, getMembershipForUser, listTeams,
//   listRunnerGroups, listHostedRunners, listOrganizationVariables, getOrganizationVariable
// Every options.<fn> the five validators invoke, type-check, or forward to
// resolve-tenant-cicd-context-from-registry is in that list - verified mechanically, not by eye.
// teamExists is deliberately absent: the resolver builds it itself from listTeams
// (resolve-tenant-cicd-context-from-registry.js:231), so it is not part of the stub contract.

const APPROVER_ERROR = /Designated approver must be an active target organization owner/;

function canonicalTopologyRecord() {
  return {
    tenantId: 'contosouk',
    tenantName: 'ContosoUK',
    tenantType: 'application',
    organization: 'octo-org',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'contosouk-root',
        structure: [
          { team: 'contosouk-root', parent: null, type: 'root' },
          { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
          { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
          { team: 'contosouk-cicd-admin', parent: 'contosouk-root', type: 'cicd-admin' },
        ],
      },
      runnerTopology: { runnerGroups: [] },
    },
  };
}

function buildRegistry() {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approver-waiver-'));
  fs.writeFileSync(path.join(registryDir, 'contosouk.json'), JSON.stringify(canonicalTopologyRecord(), null, 2), 'utf8');
  return registryDir;
}

// activeTeamSlug/activeUsername describe the tenant role the requester actually holds.
// Pass null to model a requester holding no tenant role at all.
function buildOptions(registryDir, activeTeamSlug, activeUsername) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'contosouk-root', parent: null },
      { slug: 'contosouk-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-cicd-admin', parent: { slug: 'contosouk-root' } },
    ]),
    getMembershipForUser: async ({ teamSlug, username }) => (
      activeTeamSlug && teamSlug === activeTeamSlug && username === activeUsername
        ? { state: 'active', membership: { role: 'member' } }
        : { state: 'absent', membership: null }
    ),
    // Only org-owner-user is an owner. Stephen's shape is a plain member who holds a tenant role.
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'org-owner-user' ? 'admin' : 'member', state: 'active' },
    }),
    // ContosoUK_Builders must exist: move-tenant-hosted-runner resolves its target group here,
    // and without it that operation fails for a reason unrelated to the approver requirement.
    listRunnerGroups: async () => ([
      { id: 1, name: 'Default', default: true, visibility: 'all' },
      { id: 2, name: 'ContosoUK_Builders', default: false, visibility: 'selected' },
    ]),
    listHostedRunners: async () => ([{ id: 55, name: 'contosouk_ubuntu-build', runner_group_id: 1 }]),
    listOrganizationVariables: async () => ([]),
    getOrganizationVariable: async () => null,
  };
}

// The five operations, with the parsed-request shape each one's own contract test already uses,
// so these are shapes the real parser produces rather than shapes invented here.
const OPERATIONS = [
  {
    key: 'runner_group_creation',
    label: 'create-tenant-runner-groups',
    validate: validateRunnerGroupRequest,
    issueNumber: 350,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_group_name: 'Builders',
      runner_group_visibility: 'selected',
      allows_public_repositories: 'false',
      dry_run: 'false',
      justification: 'Tenant runner isolation.',
    },
  },
  {
    key: 'hosted_runner_creation',
    label: 'create-tenant-hosted-runner',
    validate: validateHostedRunnerRequest,
    issueNumber: 320,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu-build',
      runner_image_id: 'ubuntu-24.04',
      runner_image_source: 'github',
      runner_size: '4-core',
      dry_run: 'false',
      justification: 'CI capacity for the tenant.',
    },
  },
  {
    key: 'hosted_runner_deletion',
    label: 'delete-tenant-hosted-runner',
    validate: validateHostedRunnerDeletionRequest,
    issueNumber: 340,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu-build',
      dry_run: 'false',
      justification: 'Decommissioning tenant CI capacity.',
    },
  },
  {
    key: 'hosted_runner_move',
    label: 'move-tenant-hosted-runner',
    validate: validateHostedRunnerMoveRequest,
    issueNumber: 360,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu-build',
      hosted_runner_id: '',
      target_runner_group_name: 'ContosoUK_Builders',
      dry_run: 'false',
      justification: 'Move the runner into the tenant group.',
    },
  },
  {
    key: 'tenant_variable_management',
    label: 'manage-tenant-variables',
    validate: validateTenantVariablesRequest,
    issueNumber: 420,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      variable_operation: 'create',
      variable_name: 'API_BASE_URL',
      variable_value: 'https://api.contoso.example.com',
      dry_run: 'false',
      justification: 'Shared endpoint for tenant CI.',
    },
  },
];

async function runValidation(operation, { requesterLogin, designatedApprover, activeTeamSlug }) {
  const registryDir = buildRegistry();
  return operation.validate(
    {
      parsedRequest: {
        ...operation.parsedRequest,
        designated_approver: designatedApprover,
      },
      issue: { number: operation.issueNumber, user: { login: requesterLogin } },
    },
    buildOptions(registryDir, activeTeamSlug, requesterLogin)
  );
}

function approverErrors(result) {
  return (result.errors || []).filter((error) => APPROVER_ERROR.test(error));
}

// --------------------------------------------------- the shared helper this fix rests on

test('the fast-lane waiver recognises exactly the two role-holder paths and nothing else', () => {
  assert.deepEqual(CICD_ROLE_HOLDER_PATHS, ['tenant_cicd_admin_team', 'tenant_admin_maintainer']);
  assert.equal(waivesApprovalComment('tenant_cicd_admin_team'), true);
  assert.equal(waivesApprovalComment('tenant_admin_maintainer'), true);
  // Fails closed - these must never waive the requirement.
  assert.equal(waivesApprovalComment('none'), false);
  assert.equal(waivesApprovalComment(''), false);
  assert.equal(waivesApprovalComment(undefined), false);
  assert.equal(waivesApprovalComment(null), false);
  assert.equal(waivesApprovalComment('tenant_repo_admin_team'), false);
  assert.equal(waivesApprovalComment('org_owner'), false);
});

// ------------------------------------------- Stephen's case, on all five operations

for (const operation of OPERATIONS) {
  test(`${operation.label}: a tenant admin team member is not rejected for naming a non-owner approver`, async () => {
    const result = await runValidation(operation, {
      requesterLogin: 'tenant-admin-member',
      designatedApprover: 'another-team-member',
      activeTeamSlug: 'contosouk-admin',
    });

    // This is Stephen exactly: an org member who holds the tenant admin role. The fast lane
    // will waive his approval comment, so the approver he was forced to name is never consulted.
    assert.deepEqual(approverErrors(result), [], JSON.stringify(result.errors));
    assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  });

  test(`${operation.label}: a cicd admin team member is not rejected for naming a non-owner approver`, async () => {
    const result = await runValidation(operation, {
      requesterLogin: 'tenant-cicd-member',
      designatedApprover: 'another-team-member',
      activeTeamSlug: 'contosouk-cicd-admin',
    });

    assert.deepEqual(approverErrors(result), [], JSON.stringify(result.errors));
    assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  });

  // THE NEGATIVE. A requester the fast lane will NOT waive still has to name a real owner,
  // or the approval comment they are about to wait for can never be given by anyone.
  test(`${operation.label}: a requester with no tenant role is still required to name an org owner`, async () => {
    const result = await runValidation(operation, {
      requesterLogin: 'unrelated-user',
      designatedApprover: 'another-team-member',
      activeTeamSlug: null,
    });

    assert.equal(approverErrors(result).length, 1, JSON.stringify(result.errors));
    assert.equal(result.is_valid, false);
  });

  test(`${operation.label}: naming a genuine org owner is still accepted for a role holder`, async () => {
    const result = await runValidation(operation, {
      requesterLogin: 'tenant-admin-member',
      designatedApprover: 'org-owner-user',
      activeTeamSlug: 'contosouk-admin',
    });

    assert.deepEqual(approverErrors(result), [], JSON.stringify(result.errors));
    assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  });
}

// ------------------------------------------------------------------ the recorded evidence

test('the designated approver authorization state is still recorded for a waived role holder', async () => {
  const result = await runValidation(OPERATIONS[0], {
    requesterLogin: 'tenant-admin-member',
    designatedApprover: 'another-team-member',
    activeTeamSlug: 'contosouk-admin',
  });

  // Waiving the ERROR must not mean we stop looking. The artifact still says what was found
  // about the named login, so an auditor can see the approver was checked and not needed.
  assert.equal(result.designated_approver_authorization.state, 'unauthorized');
  assert.equal(result.designated_approver_authorization.role, 'member');
  assert.equal(result.validation_findings.requester_authorization_path, 'tenant_admin_maintainer');
});
