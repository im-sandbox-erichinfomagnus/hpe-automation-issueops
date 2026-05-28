'use strict';

function buildCostCenterArtifact(input = {}) {
  const request = input.request || {};
  const validation = input.validation || {};
  const approval = input.approval || {};
  const reconciliationPlan = input.reconciliationPlan || input.reconciliation || {};
  const executionOutcome = input.executionOutcome || input.execution || {};
  const runContext = input.runContext || input.run_context || {};

  return {
    request: {
      request_id: request.request_id,
      operation: 'cost_center_reallocation',
      issue_number: request.issue_number,
      repository: request.repository,
      requester_login: request.requester_login,
      enterprise: request.enterprise,
      intended_approver_login: request.intended_approver_login,
      intake_mode: request.intake_mode || null,
      assignments_csv_input: request.assignments_csv_input || '',
      csv_submission: request.csv_submission || null,
      requested_assignments: request.requested_assignments || [],
      duplicate_assignments: request.duplicate_assignments || [],
      invalid_assignments: request.invalid_assignments || [],
      csv_row_findings: request.csv_row_findings || [],
      csv_row_numbering_convention: request.csv_row_numbering_convention || null,
      request_status: request.request_status,
      business_justification: request.business_justification || '',
      dry_run: request.dry_run,
      submitted_at: request.submitted_at,
    },
    validation: {
      is_valid: validation.is_valid,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      enterprise_visible: validation.enterprise_visible,
      live_state_verified: validation.live_state_verified === true,
      existing_cost_centers: validation.existing_cost_centers || [],
      csv_submission: validation.csv_submission || null,
      csv_row_findings: validation.csv_row_findings || [],
      csv_row_numbering_convention: validation.csv_row_numbering_convention || null,
      requested_assignments: validation.requested_assignments || [],
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
      enterprise_exists: reconciliationPlan.enterprise_exists,
      live_state_verified: reconciliationPlan.live_state_verified === true,
      cost_centers_to_create: reconciliationPlan.cost_centers_to_create || [],
      assignments_to_add: reconciliationPlan.assignments_to_add || [],
      assignments_to_remove: reconciliationPlan.assignments_to_remove || [],
      assignments_already_satisfied: reconciliationPlan.assignments_already_satisfied || [],
      assignments_rejected: reconciliationPlan.assignments_rejected || [],
      total_requested: reconciliationPlan.total_requested || 0,
      dry_run: reconciliationPlan.dry_run,
      rate_limit_snapshot: reconciliationPlan.rate_limit_snapshot || null,
      state: reconciliationPlan.state || '',
    },
    execution: executionOutcome,
    audit_summary_markdown: input.audit_summary_markdown || '',
    metadata: {
      run_id: runContext.run_id || process.env.GITHUB_RUN_ID || null,
      run_attempt: runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT || null,
      generated_at: new Date().toISOString(),
      operation: 'cost_center_reallocation',
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
