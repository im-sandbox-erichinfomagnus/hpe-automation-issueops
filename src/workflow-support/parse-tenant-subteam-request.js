'use strict';

const { normalizeRequestedTeams, slugifyTeamName, unwrapCodeFence } = require('./normalize-requested-teams');
const {
  CSV_ROW_NUMBERING_CONVENTION,
  createEmptyBulkCsvNormalization,
} = require('./normalize-bulk-csv-requested-subteams');

const ALLOWED_SUBTEAM_OPERATIONS = ['create'];

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

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeDropdownValue(value) {
  return String(value || '').replace(/[\[\]"'\s,]/g, '').toLowerCase();
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

function createEmptyManualNormalization() {
  return {
    normalizedTeams: [],
    requestedTeamDetail: [],
    duplicateTeamNames: [],
    conflictingSlugs: [],
    invalidTeamNames: [],
  };
}

function createEmptyAttachmentSubmission() {
  return {
    comment_id: null,
    comment_created_at: null,
    uploader_login: null,
    attachment_url: null,
    filename: null,
    extension: null,
    content_hash: null,
    downloaded_at: null,
    byte_size: 0,
    acceptance_status: 'waiting',
    rejection_reason: null,
  };
}

function createEmptyAttachmentValidationAttempt() {
  return {
    attempt_id: null,
    request_id: null,
    candidate_comment_id: null,
    attempt_status: 'waiting',
    selection_rule: 'newest requester attachment comment after the latest failed CSV attachment validation result',
    evaluated_at: null,
    errors: [],
    warnings: [],
    supersedes_attempt_id: null,
  };
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseTenantSubteamRequest(input = {}) {
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
      issue.user && issue.user.login
  );
  const organization = normalizeLogin(
    readField(parsed, ['organization', 'parsed_organization']) || input.organization
  );
  const tenantNameInput = normalizeTenantName(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const subteamOperation = normalizeDropdownValue(
    readField(parsed, ['subteam_operation', 'parsed_subteam_operation']) || input.subteamOperation
  );
  const parentTeamInput = slugifyTeamName(
    readField(parsed, ['parent_team', 'parsed_parent_team']) || input.parentTeam || ''
  );
  const requestedSubteamsInput =
    readFieldIncludingEmpty(parsed, [
      'requested_subteams',
      'parsed_requested_subteams',
    ]) ?? input.requestedSubteams ?? '';
  const requestedIntakeMode = normalizeDropdownValue(
    readFieldIncludingEmpty(parsed, ['intake_mode', 'parsed_intake_mode']) ?? input.intakeMode ?? ''
  );
  const comment = input.comment || input.comment_context || {};
  const issueComments = input.issueComments || input.issue_comments || [];
  const commentId = input.commentId || comment.id || null;
  const commentAuthorLogin = normalizeLogin(
    input.commentAuthorLogin || comment.author_login || comment.user && comment.user.login || ''
  );
  const manualPopulated = hasPopulatedInput(requestedSubteamsInput);
  const intakeMode = requestedIntakeMode === 'csv_attachment'
    ? 'csv_attachment'
    : requestedIntakeMode === 'manual'
      ? 'manual'
      : manualPopulated
        ? 'manual'
        : null;
  const manualNormalization = manualPopulated
    ? normalizeRequestedTeams(requestedSubteamsInput)
    : createEmptyManualNormalization();
  const selectedNormalization = intakeMode === 'manual'
    ? manualNormalization
    : createEmptyManualNormalization();
  const bulkCsvNormalization = createEmptyBulkCsvNormalization('');
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designatedApprover
  );
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
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: tenantNameInput.toLowerCase(),
    subteam_operation: subteamOperation,
    parent_team_slug: parentTeamInput,
    intake_mode: intakeMode,
    comment_context: {
      comment_id: commentId,
      comment_author_login: commentAuthorLogin || null,
      comment_body: comment.body || input.commentBody || '',
      issue_comment_count: Array.isArray(issueComments) ? issueComments.length : 0,
    },
    requested_team_names_input: requestedSubteamsInput,
    bulk_csv_input: '',
    accepted_attachment_submission: createEmptyAttachmentSubmission(),
    attachment_validation_attempt: createEmptyAttachmentValidationAttempt(),
    bulk_csv_submission: {
      encoding: bulkCsvNormalization.encoding,
      header_columns: bulkCsvNormalization.header_columns,
      required_columns: bulkCsvNormalization.required_columns,
      unsupported_columns: bulkCsvNormalization.unsupported_columns,
      row_count: bulkCsvNormalization.row_count,
      valid_row_count: bulkCsvNormalization.valid_row_count,
      invalid_row_count: bulkCsvNormalization.invalid_row_count,
      duplicate_row_count: bulkCsvNormalization.duplicate_row_count,
      schema_status: bulkCsvNormalization.schema_status,
      schema_errors: bulkCsvNormalization.schema_errors,
    },
    requested_teams: selectedNormalization.normalizedTeams,
    requested_team_detail: selectedNormalization.requestedTeamDetail,
    duplicate_team_names: selectedNormalization.duplicateTeamNames,
    conflicting_slugs: selectedNormalization.conflictingSlugs,
    invalid_team_names: selectedNormalization.invalidTeamNames,
    csv_row_findings: bulkCsvNormalization.csv_row_findings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
    designated_approver_login: designatedApproverLogin,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      duplicate_team_names: selectedNormalization.duplicateTeamNames,
      conflicting_slugs: selectedNormalization.conflictingSlugs,
      invalid_team_names: selectedNormalization.invalidTeamNames,
      csv_row_findings: bulkCsvNormalization.csv_row_findings,
      csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
    },
  };
}

module.exports = {
  ALLOWED_SUBTEAM_OPERATIONS,
  parseTenantSubteamRequest,
};
