'use strict';

const {
  CSV_ROW_NUMBERING_CONVENTION,
  createEmptyBulkCsvNormalization,
} = require('./normalize-bulk-csv-requested-repositories');
const {
  normalizeLogin,
  normalizeRequestedRepositoryRemovals,
  toLines,
} = require('./normalize-requested-repositories');

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

function normalizeRequestedRepositoriesInput(value) {
  return toLines(value)
    .map((line) => String(line || '').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function parseTeamRepoAccessRemovalRequest(input = {}) {
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
    readField(parsed, ['team', 'parsed_team', 'target_team', 'parsed_target_team']) || input.team;
  const teamSlug = normalizeLogin(String(teamName || '').trim().replace(/\s+/g, '-'));
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
  const normalizedRequestedIntakeMode = String(requestedIntakeMode || '').trim().toLowerCase();
  const intakeMode = normalizedRequestedIntakeMode === 'csv_attachment'
    ? 'csv_attachment'
    : 'manual';
  const requestedRepositoriesInput =
    readFieldIncludingEmpty(parsed, ['requested_repositories', 'parsed_requested_repositories']) ??
    input.requestedRepositories ??
    '';
  const requestedRepositoriesRawInput = normalizeRequestedRepositoriesInput(requestedRepositoriesInput);
  const removalNormalization = normalizeRequestedRepositoryRemovals(requestedRepositoriesInput, {
    defaultOwner: organization,
  });
  const dryRun = normalizeBoolean(
    readField(parsed, ['dry_run', 'parsed_dry_run']) ?? input.dryRun,
    true
  );
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
    intake_mode: intakeMode,
    comment_context: {
      comment_id: commentId,
      comment_author_login: commentAuthorLogin || null,
      comment_body: comment.body || input.commentBody || '',
      issue_comment_count: Array.isArray(issueComments) ? issueComments.length : 0,
    },
    requested_repositories_input: requestedRepositoriesRawInput,
    bulk_csv_input: '',
    bulk_csv_submission: createEmptyBulkCsvNormalization(''),
    requested_repository_removals: removalNormalization.normalizedRepositories,
    requested_repository_removal_detail: removalNormalization.requestedRepositoryDetail,
    duplicate_repositories: removalNormalization.duplicateRepositories,
    conflicting_repositories: removalNormalization.conflictingRepositories,
    invalid_repositories: removalNormalization.invalidRepositories,
    accepted_attachment_submission: createEmptyAttachmentSubmission(),
    attachment_validation_attempt: createEmptyAttachmentValidationAttempt(),
    csv_row_findings: [],
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
    request_status: intakeMode === 'csv_attachment' ? 'waiting_for_attachment' : 'submitted',
    dry_run: dryRun,
    submitted_at: input.submittedAt || new Date().toISOString(),
    validation_findings: {
      attachment_max_bytes: null,
      duplicate_repositories: removalNormalization.duplicateRepositories,
      conflicting_repositories: removalNormalization.conflictingRepositories,
      invalid_repositories: removalNormalization.invalidRepositories,
      csv_row_findings: [],
      csv_row_numbering_convention: intakeMode === 'csv_attachment' ? CSV_ROW_NUMBERING_CONVENTION : null,
    },
    unsupported_inputs: {
      requested_team_names:
        readField(parsed, ['requested_team_names', 'parsed_requested_team_names']) || '',
      requested_people:
        readField(parsed, ['requested_people', 'parsed_requested_people', 'team_members', 'members']) || '',
      parent_team:
        readField(parsed, ['parent_team', 'parsed_parent_team']) || '',
      permission_level:
        readField(parsed, ['permission_level', 'parsed_permission_level']) || '',
    },
  };
}

module.exports = {
  normalizeBoolean,
  parseTeamRepoAccessRemovalRequest,
};
