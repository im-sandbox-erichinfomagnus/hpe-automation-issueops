'use strict';

// Standalone audit-artifact builder for the cost-center-management operation.
// Kept separate from build-audit-artifact.js so this enterprise-billing feature
// does not modify the org/team operation dispatcher.
function buildCostCenterArtifact(input = {}) {
  const request = input.request || {};
  const validation = input.validation || {};
  const approval = input.approval || {};
  const reconciliation = input.reconciliation || input.reconciliationPlan || {};
  const execution = input.execution || input.executionOutcome || {};
  const runContext = input.runContext || input.run_context || {};

  return {
    request: {
      request_id: request.request_id,
      issue_number: request.issue_number,
      repository: request.repository,
      requester_login: request.requester_login,
      enterprise: request.enterprise,
      enterprise_normalized: request.enterprise_normalized,
      designated_approver_login: request.designated_approver_login,
      dry_run: request.dry_run,
      business_justification: request.business_justification,
      intake_mode: request.intake_mode || 'manual',
      attachment_provenance: request.attachment_provenance || null,
      request_status: request.request_status,
      csv_header: request.csv_header || [],
      csv_schema_status: request.csv_schema_status || null,
      unsupported_columns: request.unsupported_columns || [],
      duplicate_row_count: request.duplicate_row_count || 0,
      requested_changes: request.requested_changes || [],
      submitted_at: request.submitted_at,
    },
    validation: {
      is_valid: validation.is_valid,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      live_access: validation.live_access ?? null,
      counts: validation.counts || null,
      requested_changes: validation.requested_changes || request.requested_changes || [],
    },
    approval: {
      approval_status: approval.approval_status || 'pending',
      approver_login: approval.approver_login || '',
      approver_role: approval.approver_role || 'other',
      approved_at: approval.approved_at || null,
      decision_source: approval.decision_source || '',
      decision_note: approval.decision_note || '',
    },
    reconciliation: {
      mutation_count: reconciliation.mutation_count ?? null,
      noop_count: reconciliation.noop_count ?? null,
      rejected_count: reconciliation.rejected_count ?? null,
      blocked_reason: reconciliation.blocked_reason || null,
      dry_run: reconciliation.dry_run,
      state: reconciliation.state || '',
    },
    execution,
    metadata: {
      operation: 'cost_center_management',
      run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
      run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
      generated_at: new Date().toISOString(),
      artifact_name: runContext.artifact_name || process.env.AUDIT_ARTIFACT_NAME || null,
      artifact_retention_days: Number.isFinite(Number(runContext.artifact_retention_days || process.env.AUDIT_ARTIFACT_RETENTION_DAYS))
        ? Number(runContext.artifact_retention_days || process.env.AUDIT_ARTIFACT_RETENTION_DAYS)
        : null,
    },
  };
}

function toCostCenterArtifactJson(input = {}) {
  return `${JSON.stringify(buildCostCenterArtifact(input), null, 2)}\n`;
}

module.exports = {
  buildCostCenterArtifact,
  toCostCenterArtifactJson,
};
