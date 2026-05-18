'use strict';

const {
  normalizeLogin,
  normalizeRequestedChildTeams,
  slugifyTeamName,
} = require('./normalize-requested-child-teams');

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
    readField(parsed, ['requested_child_teams', 'parsed_requested_child_teams']) ||
    input.requestedChildTeams;
  const normalization = normalizeRequestedChildTeams(requestedChildTeamsInput);
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
    requested_child_links: normalization.normalizedChildTeams.map((childTeam) => ({
      ...childTeam,
      current_parent_slug: null,
      validation_status: 'valid',
      desired_action: 'link_child',
      execution_result: 'not_started',
      failure_reason: null,
    })),
    requested_child_link_detail: normalization.requestedChildTeamDetail,
    duplicate_child_teams: normalization.duplicateChildTeams,
    conflicting_child_slugs: normalization.conflictingChildSlugs,
    invalid_child_teams: normalization.invalidChildTeams,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      duplicate_child_teams: normalization.duplicateChildTeams,
      conflicting_child_slugs: normalization.conflictingChildSlugs,
      invalid_child_teams: normalization.invalidChildTeams,
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