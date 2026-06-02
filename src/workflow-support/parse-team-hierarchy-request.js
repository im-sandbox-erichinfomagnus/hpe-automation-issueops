'use strict';

const {
  normalizeLogin,
  normalizeRequestedChildTeams,
  unwrapCodeFence,
  slugifyTeamName,
} = require('./normalize-requested-child-teams');
const {
  CSV_ROW_NUMBERING_CONVENTION,
  createEmptyBulkCsvNormalization,
  normalizeBulkCsvRequestedChildTeams,
} = require('./normalize-bulk-csv-requested-child-teams');

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
    normalizedChildTeams: [],
    requestedChildTeamDetail: [],
    duplicateChildTeams: [],
    conflictingChildSlugs: [],
    invalidChildTeams: [],
  };
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseTeamHierarchyRequest(input = {}) {
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
  const parentTeamName = readField(parsed, ['parent_team', 'parsed_parent_team']) || input.parentTeam;
  const parentTeamSlug = normalizeLogin(slugifyTeamName(parentTeamName || ''));
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) ||
      input.designatedApprover
  );
  const requestedChildTeamsInput =
    readFieldIncludingEmpty(parsed, ['requested_child_teams', 'parsed_requested_child_teams']) ??
    input.requestedChildTeams ??
    '';
  const bulkCsvInput =
    readFieldIncludingEmpty(parsed, [
      'bulk_csv_requested_child_teams',
      'parsed_bulk_csv_requested_child_teams',
    ]) ?? input.bulkCsvRequestedChildTeams ?? input.bulkCsvInput ?? '';
  const manualPopulated = hasPopulatedInput(requestedChildTeamsInput);
  const bulkCsvPopulated = hasPopulatedInput(bulkCsvInput);
  const intakeMode = manualPopulated === bulkCsvPopulated
    ? null
    : manualPopulated
      ? 'manual'
      : 'bulk_csv';
  const manualNormalization = manualPopulated
    ? normalizeRequestedChildTeams(requestedChildTeamsInput)
    : createEmptyManualNormalization();
  const bulkCsvNormalization = bulkCsvPopulated
    ? normalizeBulkCsvRequestedChildTeams(bulkCsvInput)
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
    parent_team_slug: parentTeamSlug,
    parent_team_name: String(parentTeamName || '').trim(),
    designated_approver_login: designatedApproverLogin,
    intake_mode: intakeMode,
    requested_child_teams_input: requestedChildTeamsInput,
    bulk_csv_input: bulkCsvInput,
    bulk_csv_submission: intakeMode === 'bulk_csv'
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
      }
      : null,
    requested_child_links: selectedNormalization.normalizedChildTeams.map((childTeam) => ({
      ...childTeam,
      current_parent_slug: null,
      validation_status: 'valid',
      desired_action: 'link_child',
      execution_result: 'not_started',
      failure_reason: null,
    })),
    requested_child_link_detail: selectedNormalization.requestedChildTeamDetail,
    duplicate_child_teams: selectedNormalization.duplicateChildTeams,
    conflicting_child_slugs: selectedNormalization.conflictingChildSlugs,
    invalid_child_teams: selectedNormalization.invalidChildTeams,
    csv_row_findings: bulkCsvNormalization.csv_row_findings,
    csv_row_numbering_convention: intakeMode === 'bulk_csv'
      ? CSV_ROW_NUMBERING_CONVENTION
      : null,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      duplicate_child_teams: selectedNormalization.duplicateChildTeams,
      conflicting_child_slugs: selectedNormalization.conflictingChildSlugs,
      invalid_child_teams: selectedNormalization.invalidChildTeams,
      csv_row_findings: bulkCsvNormalization.csv_row_findings,
      csv_row_numbering_convention: intakeMode === 'bulk_csv'
        ? CSV_ROW_NUMBERING_CONVENTION
        : null,
    },
    unsupported_inputs: {
      requested_team_names: readField(parsed, ['requested_team_names', 'parsed_requested_team_names']) || '',
      requested_people: readField(parsed, ['requested_people', 'parsed_requested_people', 'team_members', 'members']) || '',
    },
  };
}

module.exports = {
  normalizeBoolean,
  parseTeamHierarchyRequest,
};