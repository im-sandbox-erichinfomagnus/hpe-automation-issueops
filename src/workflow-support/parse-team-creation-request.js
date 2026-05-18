'use strict';

const {
  normalizeLogin,
  normalizeRequestedTeams,
} = require('./normalize-requested-teams');

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

function parseTeamCreationRequest(input = {}) {
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
  const intendedOwnerLogin = normalizeLogin(
    readField(parsed, ['intended_owner', 'parsed_intended_owner']) || input.intendedOwner
  );
  const requestedTeamNamesInput =
    readField(parsed, [
      'requested_team_names',
      'parsed_requested_team_names',
      'team_names',
    ]) || input.requestedTeamNames;
  const normalization = normalizeRequestedTeams(requestedTeamNamesInput);
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
    intended_owner_login: intendedOwnerLogin,
    requested_teams: normalization.normalizedTeams.map((team) => ({
      ...team,
      intended_owner_login: intendedOwnerLogin,
      validation_status: 'valid',
      desired_action: 'create_team',
      execution_result: 'not_started',
      failure_reason: null,
    })),
    requested_team_detail: normalization.requestedTeamDetail.map((team) => ({
      ...team,
      intended_owner_login: intendedOwnerLogin,
    })),
    duplicate_team_names: normalization.duplicateTeamNames,
    conflicting_slugs: normalization.conflictingSlugs,
    invalid_team_names: normalization.invalidTeamNames,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      duplicate_team_names: normalization.duplicateTeamNames,
      conflicting_slugs: normalization.conflictingSlugs,
      invalid_team_names: normalization.invalidTeamNames,
    },
    unsupported_inputs: {
      parent_team: readField(parsed, ['parent_team', 'parent_team_slug', 'parsed_parent_team']) || '',
      requested_people: readField(parsed, ['requested_people', 'team_members', 'member_list', 'members']) || '',
    },
  };
}

module.exports = {
  normalizeBoolean,
  parseTeamCreationRequest,
};