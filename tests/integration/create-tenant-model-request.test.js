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
          membership: { role: 'member', state: 'active' },
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

test('runApprovalGate approves tenant request when designated active owner comments approved', async () => {
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
          membership: { role: 'member', state: 'active' },
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
      listIssueComments: async () => [
        {
          id: 100,
          body: 'approved',
          created_at: '2026-05-26T10:00:00Z',
          user: { login: 'org-owner-user' },
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

  assert.equal(approvalResult.approval.approval_status, 'approved');
  assert.equal(approvalResult.approval.approver_role, 'target_org_owner');
  assert.equal(approvalResult.request.request_status, 'approved');
  assert.match(approvalResult.assignment.assignment_note, /queue ownership only/i);
});

test('runApprovalGate denies tenant approval from non-designated commenter', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-denied-wrong-user-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath),
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async ({ username }) => ({
        exists: true,
        membership: { role: username === 'requester-user' ? 'member' : 'admin', state: 'active' },
      }),
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
      listIssueComments: async () => [
        {
          id: 200,
          body: 'approved',
          created_at: '2026-05-26T10:05:00Z',
          user: { login: 'different-owner' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'admin', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  assert.equal(approvalResult.approval.approval_status, 'denied');
  assert.equal(approvalResult.approval.approver_role, 'other');
  assert.match(approvalResult.approval.decision_note, /does not authorize tenant bootstrap mutation/i);
});

test('runApprovalGate denies tenant approval when designated approver is not an active owner', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-denied-non-owner-'));
  const artifactPath = path.join(workspace, 'audit.json');

  await runRequestValidation({
    env: buildTenantValidationEnv(artifactPath),
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

  const approvalResult = await runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: artifactPath,
      GITHUB_TOKEN: 'test-token',
    },
    api: {
      getAssignableOwners: async () => ['queue-owner'],
      addIssueAssignees: async () => ({ status: 'assigned' }),
      listIssueComments: async () => [
        {
          id: 300,
          body: 'approved',
          created_at: '2026-05-26T10:10:00Z',
          user: { login: 'org-owner-user' },
        },
      ],
      getOrganizationMembership: async () => ({
        exists: true,
        membership: { role: 'member', state: 'active' },
      }),
    },
    setProcessExitCode: false,
  });

  assert.equal(approvalResult.approval.approval_status, 'denied');
  assert.equal(approvalResult.approval.approver_authorization_state, 'unauthorized');
  assert.match(approvalResult.approval.decision_note, /does not authorize tenant bootstrap mutation/i);
});

test('runApprovalGate keeps central assignment routing-only when no approval comment exists', async () => {
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
          membership: { role: 'member', state: 'active' },
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

  assert.equal(approvalResult.assignment.assignment_status, 'assigned');
  assert.match(approvalResult.assignment.assignment_note, /queue ownership only/i);
  assert.equal(approvalResult.approval.approval_status, 'pending');
  assert.equal(approvalResult.request.request_status, 'awaiting_approval');
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
          membership: { role: 'member', state: 'active' },
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
