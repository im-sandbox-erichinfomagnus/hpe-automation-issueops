'use strict';

const {
  createEmptyCostCenterAssignmentNormalization,
  normalizeCostCenterAssignments,
  CSV_ROW_NUMBERING_CONVENTION,
} = require('./normalize-cost-center-assignments');
const { normalizeLogin, unwrapCodeFence } = require('./normalize-requested-people');

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return undefined;
}

function readFieldIncludingEmpty(source, keys) {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeEnterpriseSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

function normalizeBoolean(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseCostCenterRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};
  const repository =
    input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber =
    input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(
    input.requesterLogin ||
      readField(parsed, ['requester_login']) ||
      (issue.user && issue.user.login)
  );
  const enterprise = normalizeEnterpriseSlug(
    readField(parsed, ['enterprise', 'parsed_enterprise', 'enterprise_slug']) || input.enterprise
  );
  const intendedApproverLogin = normalizeLogin(
    readField(parsed, ['intended_approver', 'parsed_intended_approver']) || input.intendedApprover
  );
  const assignmentsCsvInput =
    readFieldIncludingEmpty(parsed, [
      'assignments_csv',
      'parsed_assignments_csv',
      'assignments',
    ]) ?? input.assignmentsCsv ?? '';
  const csvPopulated = unwrapCodeFence(assignmentsCsvInput).trim() !== '';
  const normalization = csvPopulated
    ? normalizeCostCenterAssignments(assignmentsCsvInput)
    : createEmptyCostCenterAssignmentNormalization(assignmentsCsvInput);
  const intakeMode = csvPopulated ? 'spreadsheet_csv' : null;
  const dryRun = normalizeBoolean(
    readField(parsed, ['dry_run', 'parsed_dry_run']) ?? input.dryRun,
    true
  );
  const justification = readField(parsed, [
    'business_justification',
    'justification',
    'reason',
  ]);
  const submittedAt = input.submittedAt || new Date().toISOString();
  const requestId = buildRequestId(
    repository,
    issueNumber,
    runContext.run_id || process.env.GITHUB_RUN_ID,
    runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
  );

  return {
    request_id: requestId,
    operation: 'cost_center_reallocation',
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    enterprise,
    intended_approver_login: intendedApproverLogin,
    intake_mode: intakeMode,
    assignments_csv_input: assignmentsCsvInput,
    csv_submission: csvPopulated
      ? {
        encoding: normalization.encoding,
        header_columns: normalization.header_columns,
        required_columns: normalization.required_columns,
        optional_columns: normalization.optional_columns,
        unsupported_columns: normalization.unsupported_columns,
        row_count: normalization.row_count,
        valid_row_count: normalization.valid_row_count,
        invalid_row_count: normalization.invalid_row_count,
        duplicate_row_count: normalization.duplicate_row_count,
        schema_status: normalization.schema_status,
        schema_errors: normalization.schema_errors,
      }
      : null,
    requested_assignments: normalization.normalizedAssignments.map((assignment) => ({
      ...assignment,
      validation_status: 'valid',
      desired_action: assignment.action === 'remove' ? 'remove_user' : 'add_user',
      execution_result: 'not_started',
      failure_reason: null,
    })),
    duplicate_assignments: normalization.duplicateAssignments,
    invalid_assignments: normalization.invalidAssignments,
    csv_row_findings: normalization.csv_row_findings,
    csv_row_numbering_convention: csvPopulated ? CSV_ROW_NUMBERING_CONVENTION : null,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
  };
}

module.exports = {
  normalizeBoolean,
  normalizeEnterpriseSlug,
  parseCostCenterRequest,
};
