'use strict';

const { slugifyTeamName } = require('./normalize-requested-child-teams');
const {
  CSV_ROW_NUMBERING_CONVENTION,
  createEmptyBulkCsvNormalization,
  normalizeBulkCsvRequestedRepositories,
} = require('./normalize-bulk-csv-requested-repositories');
const { normalizeRequestedPermission } = require('./normalize-requested-permission');
const {
  normalizeRequestedRepositories,
  normalizeLogin,
  toLines,
  unwrapCodeFence,
} = require('./normalize-requested-repositories');

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return undefined;
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

function normalizeRequestedRepositoriesInput(value) {
  return toLines(value)
    .map((line) => String(line || '').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function readFieldIncludingEmpty(source, keys) {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      return source[key];
    }
  }

  return undefined;
}

function createEmptyManualNormalization() {
  return {
    normalizedRepositories: [],
    requestedRepositoryDetail: [],
    duplicateRepositories: [],
    conflictingRepositories: [],
    invalidRepositories: [],
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

function hasPopulatedRequestInput(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasPopulatedRequestInput(entry));
  }

  if (value == null) {
    return false;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.values)) {
      return hasPopulatedRequestInput(value.values);
    }

    if (typeof value.value === 'string') {
      return hasPopulatedRequestInput(value.value);
    }

    return false;
  }

  return unwrapCodeFence(value).trim() !== '';
}

function parseTeamRepoAccessRequest(input = {}) {
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
  const organization = normalizeLogin(
    readField(parsed, ['organization', 'parsed_organization']) || input.organization
  );
  const teamName =
    readField(parsed, ['target_team', 'parsed_target_team', 'team', 'parsed_team']) || input.targetTeam;
  const teamSlug = normalizeLogin(slugifyTeamName(teamName || ''));
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) ||
      input.designatedApprover
  );
  const requestedIntakeMode = readFieldIncludingEmpty(parsed, [
    'intake_mode',
    'parsed_intake_mode',
  ]) ?? input.intakeMode ?? '';
  const comment = input.comment || input.comment_context || {};
  const issueComments = input.issueComments || input.issue_comments || [];
  const commentId = input.commentId || comment.id || null;
  const commentAuthorLogin = normalizeLogin(
    input.commentAuthorLogin || comment.author_login || comment.user && comment.user.login || ''
  );
  const requestedRepositoriesInput =
    readFieldIncludingEmpty(parsed, ['requested_repositories', 'parsed_requested_repositories']) ??
    input.requestedRepositories ??
    '';
  const requestedRepositoriesRawInput = normalizeRequestedRepositoriesInput(requestedRepositoriesInput);
  const bulkCsvInput =
    readFieldIncludingEmpty(parsed, [
      'bulk_csv_requested_repositories',
      'parsed_bulk_csv_requested_repositories',
    ]) ?? input.bulkCsvRequestedRepositories ?? input.bulkCsvInput ?? '';
  const manualInputPopulated = hasPopulatedRequestInput(requestedRepositoriesInput);
  const bulkCsvInputPopulated = hasPopulatedRequestInput(bulkCsvInput);
  const normalizedRequestedIntakeMode = String(requestedIntakeMode || '').trim().toLowerCase();
  const intakeMode = normalizedRequestedIntakeMode === 'csv_attachment'
    ? 'csv_attachment'
    : normalizedRequestedIntakeMode === 'manual'
      ? 'manual'
      : normalizedRequestedIntakeMode === 'bulk_csv'
        ? 'bulk_csv'
        : manualInputPopulated === bulkCsvInputPopulated
          ? null
          : manualInputPopulated
            ? 'manual'
            : 'bulk_csv';
  const manualNormalization = manualInputPopulated
    ? normalizeRequestedRepositories(requestedRepositoriesInput, { defaultOwner: organization })
    : createEmptyManualNormalization();
  const bulkCsvNormalization = bulkCsvInputPopulated
    ? normalizeBulkCsvRequestedRepositories(bulkCsvInput, { defaultOwner: organization })
    : createEmptyBulkCsvNormalization(bulkCsvInput);
  const selectedNormalization = intakeMode === 'bulk_csv'
    ? bulkCsvNormalization
    : intakeMode === 'manual'
      ? manualNormalization
      : createEmptyManualNormalization();
  const bulkCsvSubmission = (intakeMode === 'bulk_csv' || intakeMode === 'csv_attachment')
    ? {
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
      raw_input: bulkCsvNormalization.raw_input,
      csv_row_findings: bulkCsvNormalization.csv_row_findings,
      csv_row_numbering_convention: bulkCsvNormalization.csv_row_numbering_convention,
    }
    : createEmptyBulkCsvNormalization(bulkCsvInput);
  const requestedPermissionInput =
    readField(parsed, ['permission_level', 'parsed_permission_level']) || input.permissionLevel;
  const permissionNormalization = normalizeRequestedPermission(requestedPermissionInput);
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
    team_slug: teamSlug,
    team_name: String(teamName || '').trim(),
    designated_approver_login: designatedApproverLogin,
    requested_permission_label: permissionNormalization.requested_permission_label,
    requested_permission_api_value: permissionNormalization.requested_permission_api_value,
    requested_permission_rank: permissionNormalization.requested_permission_rank,
    intake_mode: intakeMode,
    comment_context: {
      comment_id: commentId,
      comment_author_login: commentAuthorLogin || null,
      comment_body: comment.body || input.commentBody || '',
      issue_comment_count: Array.isArray(issueComments) ? issueComments.length : 0,
    },
    requested_repositories_input: requestedRepositoriesRawInput,
    bulk_csv_input: bulkCsvInput,
    accepted_attachment_submission: createEmptyAttachmentSubmission(),
    attachment_validation_attempt: createEmptyAttachmentValidationAttempt(),
    bulk_csv_submission: bulkCsvSubmission,
    requested_repository_grants: selectedNormalization.normalizedRepositories,
    requested_repository_grant_detail: selectedNormalization.requestedRepositoryDetail,
    duplicate_repositories: selectedNormalization.duplicateRepositories,
    conflicting_repositories: selectedNormalization.conflictingRepositories,
    invalid_repositories: selectedNormalization.invalidRepositories,
    csv_row_findings: bulkCsvNormalization.csv_row_findings,
    csv_row_numbering_convention: bulkCsvSubmission.csv_row_numbering_convention || CSV_ROW_NUMBERING_CONVENTION,
    request_status: intakeMode === 'csv_attachment' ? 'waiting_for_attachment' : 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      legacy_bulk_csv_input_detected: bulkCsvInputPopulated,
      duplicate_repositories: selectedNormalization.duplicateRepositories,
      conflicting_repositories: selectedNormalization.conflictingRepositories,
      invalid_repositories: selectedNormalization.invalidRepositories,
      csv_row_findings: bulkCsvNormalization.csv_row_findings,
      csv_row_numbering_convention: (intakeMode === 'bulk_csv' || intakeMode === 'csv_attachment')
        ? CSV_ROW_NUMBERING_CONVENTION
        : null,
      bulk_csv_submission: bulkCsvSubmission,
      unsupported_permission: !permissionNormalization.is_supported,
    },
    unsupported_inputs: {
      requested_team_names:
        readField(parsed, ['requested_team_names', 'parsed_requested_team_names']) || '',
      requested_people:
        readField(parsed, ['requested_people', 'parsed_requested_people', 'team_members', 'members']) || '',
      parent_team:
        readField(parsed, ['parent_team', 'parsed_parent_team']) || '',
    },
  };
}

module.exports = {
  normalizeBoolean,
  parseTeamRepoAccessRequest,
};