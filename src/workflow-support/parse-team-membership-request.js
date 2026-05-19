'use strict';

const {
  normalizeLogin,
  normalizeRequestedPeople,
  unwrapCodeFence,
} = require('./normalize-requested-people');
const {
  CSV_ROW_NUMBERING_CONVENTION,
  createEmptyBulkCsvNormalization,
  normalizeBulkCsvRequestedPeople,
} = require('./normalize-bulk-csv-requested-people');

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

function createEmptyManualNormalization() {
  return {
    normalizedPeople: [],
    duplicatePeople: [],
    invalidPeople: [],
    requestedPeopleDetail: [],
  };
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

function parseTeamMembershipRequest(input = {}) {
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
  const teamSlug = normalizeLogin(
    readField(parsed, ['team_slug', 'parsed_team_slug', 'team']) || input.teamSlug
  );
  const requestedPeopleInput =
    readFieldIncludingEmpty(parsed, [
      'requested_people',
      'parsed_requested_people',
      'people',
      'usernames',
    ]) ?? input.requestedPeople ?? '';
  const bulkCsvInput =
    readFieldIncludingEmpty(parsed, [
      'bulk_csv_requested_people',
      'parsed_bulk_csv_requested_people',
    ]) ?? input.bulkCsvRequestedPeople ?? input.bulkCsvInput ?? '';
  const manualPopulated = hasPopulatedInput(requestedPeopleInput);
  const bulkCsvPopulated = hasPopulatedInput(bulkCsvInput);
  const intakeMode = manualPopulated === bulkCsvPopulated
    ? null
    : manualPopulated
      ? 'manual'
      : 'bulk_csv';
  const manualNormalization = manualPopulated
    ? normalizeRequestedPeople(requestedPeopleInput)
    : createEmptyManualNormalization();
  const bulkCsvNormalization = bulkCsvPopulated
    ? normalizeBulkCsvRequestedPeople(bulkCsvInput)
    : createEmptyBulkCsvNormalization(bulkCsvInput);
  const selectedNormalization = intakeMode === 'bulk_csv'
    ? bulkCsvNormalization
    : intakeMode === 'manual'
      ? manualNormalization
      : createEmptyManualNormalization();
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
    intake_mode: intakeMode,
    requested_people_input: requestedPeopleInput,
    bulk_csv_input: bulkCsvInput,
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
    requested_people: selectedNormalization.normalizedPeople,
    requested_people_detail: selectedNormalization.requestedPeopleDetail,
    duplicate_people: selectedNormalization.duplicatePeople,
    invalid_people: selectedNormalization.invalidPeople,
    csv_row_findings: bulkCsvNormalization.csv_row_findings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      duplicate_people: selectedNormalization.duplicatePeople,
      invalid_people: selectedNormalization.invalidPeople,
      csv_row_findings: bulkCsvNormalization.csv_row_findings,
      csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
    },
  };
}

module.exports = {
  normalizeBoolean,
  parseTeamMembershipRequest,
};