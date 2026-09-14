'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runApprovalGate } = require('../../src/scripts/run-approval-gate');

function writeArtifact(operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'central-assignment-non-fatal-'));
  const artifactPath = path.join(directory, 'validation.json');
  fs.writeFileSync(artifactPath, JSON.stringify({
    metadata: { operation, run_id: '1', run_attempt: '1' },
    request: {
      requester_login: 'member-requester',
      organization: 'octo-org',
      repository: 'octo-org/central',
      issue_number: 207,
      context_marker: 'central-assignment-non-fatal-context:1',
      request_status: 'awaiting_approval',
      intake_mode: 'manual',
      tenant_admin_login: 'tenant-admin-user',
      designated_approver_login: 'org-owner-user',
    },
    validation: { is_valid: true, validation_findings: { tenant_resolution_status: 'resolved' } },
    approval: { approval_status: 'pending' },
    execution: { summary: '' },
    reconciliation: null,
  }), 'utf8');
  return artifactPath;
}

function forbidden(message) {
  return Object.assign(new Error(message), { ok: false, status: 403 });
}

function buildApi(overrides = {}) {
  return {
    getAssignableOwners: async () => ['queue-owner', 'member-requester'],
    addIssueAssignees: async () => ({ status: 'assigned' }),
    listIssueComments: async () => [],
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    ...overrides,
  };
}

async function gate(overrides) {
  return runApprovalGate({
    env: {
      AUDIT_ARTIFACT_PATH: writeArtifact('tenant_creation'),
      ISSUEOPS_GITHUB_TOKEN: 'pat-token',
      GITHUB_TOKEN: 'pat-token',
    },
    api: buildApi(overrides),
    setProcessExitCode: false,
  });
}

test('a 403 from addIssueAssignees no longer fails the approval gate', async () => {
  const result = await gate({
    addIssueAssignees: async () => {
      throw forbidden('Failed to add issue assignees');
    },
  });

  assert.equal(result.assignment.assignment_status, 'failed');
  assert.equal(result.assignment.assigned_login, '');
  assert.match(result.assignment.assignment_note, /Failed to add issue assignees/);
  assert.equal(result.approval.approval_status, 'pending');
  assert.notEqual(result.request.request_status, 'approved');
});

test('a 403 from getAssignableOwners is handled the same way', async () => {
  const result = await gate({
    getAssignableOwners: async () => {
      throw forbidden('Failed to list assignable users');
    },
  });

  assert.equal(result.assignment.assignment_status, 'failed');
  assert.match(result.assignment.assignment_note, /Failed to list assignable users/);
  assert.equal(result.approval.approval_status, 'pending');
});

test('a failed assignment still lets a valid approval comment approve the request', async () => {
  const result = await gate({
    addIssueAssignees: async () => {
      throw forbidden('Failed to add issue assignees');
    },
    listIssueComments: async () => [
      {
        id: 2101,
        body: 'approved',
        created_at: '2026-06-05T10:00:00Z',
        user: { login: 'org-owner-user' },
      },
    ],
  });

  assert.equal(result.assignment.assignment_status, 'failed');
  assert.equal(result.approval.approval_status, 'approved');
});

test('the successful assignment path is unchanged', async () => {
  const result = await gate();

  assert.equal(result.assignment.assignment_status, 'assigned');
  assert.equal(result.assignment.assigned_login, 'queue-owner');
  assert.match(result.assignment.assignment_note, /does not authorize/);
  assert.ok(result.assignment.assigned_at);
});

test('the assignment catch does not swallow approval-path failures', async () => {
  await assert.rejects(
    gate({
      listIssueComments: async () => {
        throw forbidden('Failed to list issue comments');
      },
    }),
    /Failed to list issue comments/
  );
});
