'use strict';

const fs = require('fs');

function rowOutcome(row) {
  const exec = row.execution_result;
  if (exec) {
    return exec;
  }
  if (row.validation_status === 'noop') {
    return 'no-op';
  }
  if (row.validation_status === 'rejected') {
    return `rejected (${row.failure_reason})`;
  }
  if (row.validation_status === 'unverified') {
    return 'planned (unverified)';
  }
  return row.desired_action || 'pending';
}

function formatCostCenterSummary(artifact = {}) {
  const request = artifact.request || {};
  const validation = artifact.validation || {};
  const approval = artifact.approval || {};
  const reconciliation = artifact.reconciliation || {};
  const execution = artifact.execution || {};
  const rows = (validation.requested_changes && validation.requested_changes.length
    ? validation.requested_changes
    : request.requested_changes) || [];

  const lines = [
    '# Manage Cost Centers Workflow Summary',
    '',
    `- Request ID: ${request.request_id || 'n/a'}`,
    `- Enterprise: ${request.enterprise || 'n/a'}`,
    `- Designated approver: ${request.designated_approver_login || 'n/a'}`,
    `- Dry-run mode: ${request.dry_run ? 'true' : 'false'}`,
    `- Request status: ${request.request_status || 'submitted'}`,
    `- Live enterprise access: ${validation.live_access === false ? 'false (plan computed from spreadsheet)' : validation.live_access === true ? 'true' : 'unknown'}`,
    `- Approval: ${approval.approval_status || 'pending'}${approval.approver_login ? ` (${approval.approver_login})` : ''}`,
    `- Validation: ${validation.is_valid ? 'passed' : 'failed'}`,
    `- Planned: ${reconciliation.mutation_count ?? (validation.counts ? (validation.counts.create + validation.counts.rename + validation.counts.delete) : 0)} change(s), ${validation.counts ? validation.counts.noop : 0} no-op, ${validation.counts ? validation.counts.rejected : 0} rejected`,
  ];

  if (execution && (execution.executed_count != null || execution.failure_count != null)) {
    lines.push(`- Executed: created ${execution.created_count || 0}, renamed ${execution.renamed_count || 0}, deleted ${execution.deleted_count || 0}, failed ${execution.failure_count || 0}`);
    if (execution.rollback_status) {
      lines.push(`- Rollback status: ${execution.rollback_status}`);
    }
  }

  if (validation.warnings && validation.warnings.length > 0) {
    lines.push(`- Warnings: ${validation.warnings.join('; ')}`);
  }
  if (validation.errors && validation.errors.length > 0) {
    lines.push(`- Errors: ${validation.errors.join('; ')}`);
  }
  if (approval.decision_note) {
    lines.push(`- Approval note: ${approval.decision_note}`);
  }

  if (rows.length > 0) {
    lines.push('', '| Row | Cost center | Action | Outcome | Detail |', '|---|---|---|---|---|');
    for (const row of rows) {
      const target = row.action === 'rename'
        ? `${row.cost_center_input} -> ${row.new_name_input}`
        : row.cost_center_input;
      lines.push(`| ${row.source_row_number} | ${target} | ${row.action} | ${rowOutcome(row)} | ${(row.detail || '').replace(/\|/g, '\\|')} |`);
    }
  }

  const isWaiting = request.request_status === 'waiting_for_attachment';
  lines.push('', execution && execution.summary
    ? execution.summary
    : isWaiting
      ? 'Waiting for a CSV attachment. Attach a single .csv file in a comment on this issue, as the issue author, and the plan will be generated.'
      : validation.is_valid
        ? approval.approval_status === 'approved'
          ? 'Request is approved and eligible for cost-center execution.'
          : 'Request is validated and ready for approval. No cost-center mutation was attempted.'
        : 'Request validation failed. No cost-center mutation was attempted.');

  return lines.join('\n');
}

function emitCostCenterSummary(artifact, options = {}) {
  const summary = formatCostCenterSummary(artifact);
  const summaryPath = options.summaryPath || process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, `${summary}\n`, 'utf8');
  }
  return summary;
}

module.exports = {
  emitCostCenterSummary,
  formatCostCenterSummary,
};
