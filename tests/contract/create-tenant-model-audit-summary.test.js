'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAuditArtifact } = require('../../src/workflow-support/build-audit-artifact');
const { buildExecutionOutcome } = require('../../src/workflow-support/build-execution-outcome');

test('buildAuditArtifact includes rate-limit retry evidence for tenant topology reconciliation', () => {
  const artifact = buildAuditArtifact({
    request: {
      request_id: 'octo-org/issueops#1/10.1',
      issue_number: 1,
      repository: 'octo-org/issueops',
      requester_login: 'requester-user',
      organization: 'octo-org',
      tenant_display_name: 'Acme Platform',
      tenant_key: 'acme-platform',
      tenant_type: 'application',
      primary_contact: 'owner@example.com',
      secondary_contact: null,
      topology: {
        organization: { orgName: 'octo-org' },
      },
      compatibility: {
        mode: 'canonical',
      },
      request_status: 'awaiting_approval',
      dry_run: false,
    },
    validation: {
      is_valid: true,
      validation_findings: {
        topology_draft_validation: 'valid',
      },
    },
    reconciliationPlan: {
      state: 'approved_for_execution',
      dry_run: false,
      rate_limit_snapshot: {
        retry_count: 1,
      },
      canonical_topology_markers: {
        root_team: 'acme-platform-root',
      },
    },
    executionOutcome: {
      mutation_count: 0,
      noop_count: 0,
      failure_count: 0,
      summary: 'No mutation required.',
      rollback_status: 'not_needed',
    },
    runContext: {
      operation: 'tenant_creation',
      run_id: '10',
      run_attempt: '1',
    },
  });

  assert.equal(artifact.reconciliation.rate_limit_retry_evidence.strategy, 'bounded_exponential_backoff');
  assert.equal(artifact.reconciliation.rate_limit_retry_evidence.snapshot_present, true);
  assert.equal(artifact.reconciliation.canonical_topology_markers.root_team, 'acme-platform-root');
});

test('buildAuditArtifact includes structured logging fields for validation and compatibility context', () => {
  const artifact = buildAuditArtifact({
    request: {
      request_id: 'octo-org/issueops#2/10.1',
      issue_number: 2,
      repository: 'octo-org/issueops',
      requester_login: 'requester-user',
      organization: 'octo-org',
      tenant_display_name: 'Legacy Tenant',
      tenant_key: 'legacy-tenant',
      tenant_type: 'platform',
      primary_contact: 'owner@example.com',
      topology: {
        teams: { tenantRootTeam: 'legacy-tenant-root', structure: [] },
      },
      compatibility: {
        mode: 'legacy_projection',
      },
      request_status: 'failed',
      dry_run: true,
    },
    validation: {
      is_valid: false,
    },
    reconciliationPlan: {
      state: 'blocked',
      compatibility_mode: 'legacy_projection',
      dry_run: true,
      rate_limit_snapshot: null,
    },
    executionOutcome: {
      mutation_count: 0,
      noop_count: 0,
      failure_count: 1,
      summary: 'Validation blocked mutation.',
      rollback_status: 'not_needed',
    },
    runContext: {
      operation: 'tenant_creation',
      run_id: '10',
      run_attempt: '1',
    },
  });

  assert.equal(artifact.execution.structured_logging.validation_status, 'failed');
  assert.equal(artifact.execution.structured_logging.reconciliation_state, 'blocked');
  assert.equal(artifact.execution.structured_logging.compatibility_mode, 'legacy_projection');
  assert.equal(artifact.validation.canonical_topology_validation_context.compatibility_mode, 'legacy_projection');
});

test('buildAuditArtifact keeps deterministic no-mutation planning for pre-execution request statuses', () => {
  const baseInput = {
    request: {
      request_id: 'octo-org/issueops#3/10.1',
      issue_number: 3,
      repository: 'octo-org/issueops',
      requester_login: 'requester-user',
      organization: 'octo-org',
      tenant_display_name: 'Deterministic Tenant',
      tenant_key: 'deterministic-tenant',
      tenant_type: 'application',
      primary_contact: 'owner@example.com',
      compatibility: { mode: 'canonical' },
      dry_run: false,
    },
    validation: {
      is_valid: true,
      errors: [],
      warnings: [],
    },
    reconciliationPlan: {
      state: 'approved_for_execution',
      compatibility_mode: 'canonical',
    },
    executionOutcome: {
      mutation_count: 0,
      noop_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
    },
    runContext: {
      operation: 'tenant_creation',
      run_id: '10',
      run_attempt: '1',
    },
  };

  for (const status of ['submitted', 'awaiting_approval', 'validation_failed', 'waiting_for_attachment']) {
    const artifact = buildAuditArtifact({
      ...baseInput,
      request: {
        ...baseInput.request,
        request_status: status,
      },
    });

    assert.equal(artifact.request.request_status, status);
    assert.equal(artifact.validation.no_mutation_planned, true);
  }

  const executedArtifact = buildAuditArtifact({
    ...baseInput,
    request: {
      ...baseInput.request,
      request_status: 'executed',
    },
  });
  assert.equal(executedArtifact.validation.no_mutation_planned, false);
});

test('buildExecutionOutcome maps CICD capability taxonomy for all supported statuses', () => {
  const statuses = ['requested', 'applied', 'skipped', 'blocked', 'unavailable', 'failed'];

  for (const status of statuses) {
    const execution = buildExecutionOutcome({
      runContext: {
        operation: 'tenant_creation',
      },
      cicd_capability: {
        selected_path: status === 'applied' ? 'primary' : 'none',
        status,
        reason_code: status === 'applied' ? null : 'capability_status_test',
      },
    });

    assert.equal(execution.cicd_capability_status, status);
  }
});

test('buildAuditArtifact carries CICD capability decision fields into execution section', () => {
  const executionOutcome = buildExecutionOutcome({
    runContext: {
      operation: 'tenant_creation',
      run_id: '20',
      run_attempt: '1',
    },
    cicd_capability: {
      selected_path: 'none',
      status: 'blocked',
      reason_code: 'unsafe_scope',
      reason_message: 'Scope was blocked by policy.',
    },
    cicd_topology_update_outcome: 'noop',
  });

  const artifact = buildAuditArtifact({
    request: {
      request_id: 'octo-org/issueops#5/20.1',
      issue_number: 5,
      repository: 'octo-org/issueops',
      requester_login: 'requester-user',
      organization: 'octo-org',
      tenant_display_name: 'Capability Tenant',
      tenant_key: 'capability-tenant',
      tenant_type: 'application',
      primary_contact: 'owner@example.com',
      request_status: 'executed',
      dry_run: false,
    },
    validation: {
      is_valid: true,
    },
    reconciliationPlan: {
      state: 'approved_for_execution',
      cicd_capability_decision: {
        selected_path: 'none',
        status: 'blocked',
        reason_code: 'unsafe_scope',
      },
    },
    executionOutcome,
    runContext: {
      operation: 'tenant_creation',
      run_id: '20',
      run_attempt: '1',
    },
  });

  assert.equal(artifact.execution.cicd_capability_selected_path, 'none');
  assert.equal(artifact.execution.cicd_capability_status, 'blocked');
  assert.equal(artifact.execution.cicd_capability_reason_code, 'unsafe_scope');
  assert.equal(artifact.execution.cicd_topology_update_outcome, 'noop');
});
