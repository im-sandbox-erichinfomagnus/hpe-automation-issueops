'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runRequestValidation } = require('../../src/scripts/run-request-validation');
const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function buildTenantValidationEnv(artifactPath, overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '950',
    REQUESTER_LOGIN: 'requester-user',
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'Acme Platform',
    PARSED_TENANT_ADMIN_LOGIN: 'tenant-admin-user',
    PARSED_TENANT_TYPE: 'application',
    PARSED_PRIMARY_CONTACT: 'owner@example.com',
    PARSED_SECONDARY_CONTACT: 'secondary@example.com',
    PARSED_CMDB_ID: 'CMDB-001',
    PARSED_COST_CENTER: 'CC-001',
    PARSED_BUSINESS_UNIT: 'platform',
    PARSED_ENVIRONMENT: 'nonprod',
    PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
    PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
    PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_JUSTIFICATION: 'Bootstrap tenant',
    PARSED_DRY_RUN: 'false',
    GITHUB_TOKEN: 'test-token',
    AUDIT_ARTIFACT_PATH: artifactPath,
    ...overrides,
  };
}

test('create-tenant-model request integration scaffold reads comment fixture', () => {
  const commentsPath = path.join(__dirname, '..', 'fixtures', 'create-tenant-model-comments.json');
  const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));

  assert.ok(Array.isArray(comments));
  assert.equal(comments.length > 0, true);
});

test('runRequestValidation for create-tenant-model dry-run emits reconciliation intent with no mutation', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-dry-run-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '950',
      REQUESTER_LOGIN: 'requester-user',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TENANT_NAME: 'Acme Platform',
      PARSED_TENANT_ADMIN_LOGIN: 'tenant-admin-user',
      PARSED_TENANT_TYPE: 'application',
      PARSED_PRIMARY_CONTACT: 'owner@example.com',
      PARSED_SECONDARY_CONTACT: 'secondary@example.com',
      PARSED_CMDB_ID: 'CMDB-001',
      PARSED_COST_CENTER: 'CC-001',
      PARSED_BUSINESS_UNIT: 'platform',
      PARSED_ENVIRONMENT: 'nonprod',
      PARSED_GOVERNANCE_CODE_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED: 'true',
      PARSED_GOVERNANCE_DEPENDABOT_ENABLED: 'true',
      PARSED_DESIGNATED_APPROVER: 'org-owner-user',
      PARSED_JUSTIFICATION: 'Bootstrap tenant',
      PARSED_DRY_RUN: 'true',
      GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => {
        if (username === 'org-owner-user') {
          return {
            exists: true,
            membership: { role: 'admin', state: 'active' },
          };
        }

        return {
          exists: true,
          membership: { role: 'admin', state: 'active' },
        };
      },
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.request_status, 'awaiting_approval');
  assert.equal(persisted.metadata.operation, 'tenant_creation');
  assert.equal(Boolean(persisted.request.dry_run), true);
  assert.equal(persisted.validation.no_mutation_planned, true);
  assert.equal(Array.isArray(persisted.reconciliation.teams_to_create), true);
  assert.equal(persisted.execution.mutation_count, 0);
  assert.match(persisted.execution.summary, /No tenant bootstrap mutation was attempted/i);
});

test('runApprovalGate holds tenant creation until the named tenant admin approves', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-approval-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath),
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => {
        if (username === 'org-owner-user') {
          return {
            exists: true,
            membership: { role: 'admin', state: 'active' },
          };
        }

        return {
          exists: true,
          membership: { role: 'admin', state: 'active' },
        };
      },
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  // Tenant creation is no longer self-serve: with no approval comment it waits.
  assert.notEqual(approvalResult.approval.approval_status, 'approved');
  assert.notEqual(approvalResult.request.request_status, 'approved');

  // The tenant admin named on the request is the one who releases it.
  const approvedResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 11,
          body: 'approved',
          created_at: '2026-09-13T10:00:00Z',
          user: { login: 'tenant-admin-user' },
        },
      ],
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

  assert.equal(approvedResult.approval.approval_status, 'approved');
  assert.equal(approvedResult.approval.approver_role, 'tenant_admin');
  assert.equal(approvedResult.approval.decision_source, 'comment');
  assert.equal(approvedResult.approval.approver_login, 'tenant-admin-user');
  assert.equal(approvedResult.request.request_status, 'approved');
});

test('runApprovalGate never approves tenant creation when validation failed', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-invalid-request-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const validationResult = await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath, {
      GITHUB_TOKEN: '',
      ISSUEOPS_GITHUB_TOKEN: '',
    }),
    setProcessExitCode: false,
  });

  assert.equal(validationResult.validation.is_valid, false);

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  assert.equal(approvalResult.approval.approval_status, 'not_requested');
  assert.notEqual(approvalResult.approval.approval_status, 'approved');
});

test('runRequestValidation admits a member-raised tenant creation which then awaits approval', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-requester-not-owner-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath),
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: {
          role: username === 'requester-user' ? 'member' : 'admin',
          state: 'active',
        },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  // The requester is a plain member. That is now sufficient to raise the request.
  assert.equal(result.validation.is_valid, true, JSON.stringify(result.validation.errors));
  assert.equal(
    result.validation.errors.includes('Requester must be an active owner in the target organization to create a tenant.'),
    false
  );
  assert.equal(result.validation.validation_findings.requester_membership_gate, 'authorized');
  assert.equal(result.validation.validation_findings.requester_owner_gate, 'unauthorized');

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  assert.notEqual(approvalResult.approval.approval_status, 'approved');
});

test('runApprovalGate centrally assigns tenant creation while it awaits approval', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-assignment-only-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath),
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => {
        if (username === 'org-owner-user') {
          return {
            exists: true,
            membership: { role: 'admin', state: 'active' },
          };
        }

        return {
          exists: true,
          membership: { role: 'admin', state: 'active' },
        };
      },
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  // Self-serve operations skip central assignment because nobody needs to act on them.
  // Tenant creation now needs a human approver, so it is assigned to the queue like every
  // other approval-gated operation.
  assert.equal(approvalResult.assignment.assignment_status, 'assigned');
  assert.notEqual(approvalResult.approval.approval_status, 'approved');
  assert.notEqual(approvalResult.approval.approver_role, 'tenant_self_serve');
  assert.notEqual(approvalResult.request.request_status, 'approved');
});

test('runRequestValidation fails closed for tenant creation when workflow token is missing', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-missing-token-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath, {
      GITHUB_TOKEN: '',
      ISSUEOPS_GITHUB_TOKEN: '',
    }),
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /Workflow token secret is missing/i);
});

test('runRequestValidation keeps tenant model operation when parsed repository name is spillover markdown', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-operation-spillover-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath, {
      PARSED_REPOSITORY_NAME: '### Tenant type\nplatform',
      PARSED_SECONDARY_CONTACT: '[himanshu.kumar@infomagnus.com](mailto:himanshu.kumar@infomagnus.com) (makme-tenant-type-platform-enable-code-scanning-true-enable-secret-scanning-true-enable-dependabot-t)',
      PARSED_PRIMARY_CONTACT: '[himanshu.kumar@infomagnus.com](mailto:himanshu.kumar@infomagnus.com)',
      PARSED_TENANT_NAME: 'Makme\n\n### Tenant type\nplatform',
    }),
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => {
        if (username === 'org-owner-user') {
          return {
            exists: true,
            membership: { role: 'admin', state: 'active' },
          };
        }

        return {
          exists: true,
          membership: { role: 'admin', state: 'active' },
        };
      },
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  assert.equal(result.auditArtifact.metadata.operation, 'tenant_creation');
  assert.equal(result.auditArtifact.request.tenant_display_name, 'Makme');
  assert.equal(result.auditArtifact.request.primary_contact, 'himanshu.kumar@infomagnus.com');
  assert.equal(result.auditArtifact.request.secondary_contact, 'himanshu.kumar@infomagnus.com');
  assert.equal(result.validation.is_valid, true);
});

test('runRequestValidation fails closed for tenant creation when token lacks org-read capability', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-insufficient-token-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath),
    api: {
      getOrganization: async () => {
        throw new Error('Resource not accessible by integration');
      },
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /Resource not accessible by integration/i);
});

test('runRequestValidation accepts tenant creation without a designated approver', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-no-approver-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath, { PARSED_DESIGNATED_APPROVER: '' }),
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  assert.equal(result.validation.is_valid, true);
  assert.equal(result.validation.designated_approver_authorization.state, 'not_applicable');
  assert.equal(result.validation.designated_approver_authorization.role, 'not_applicable');
});
