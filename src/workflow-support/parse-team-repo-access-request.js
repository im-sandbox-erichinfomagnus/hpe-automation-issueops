'use strict';

const { slugifyTeamName } = require('./normalize-requested-child-teams');
const { normalizeRequestedPermission } = require('./normalize-requested-permission');
const { normalizeRequestedRepositories, normalizeLogin } = require('./normalize-requested-repositories');

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
  const requestedRepositoriesInput =
    readField(parsed, ['requested_repositories', 'parsed_requested_repositories']) ||
    input.requestedRepositories;
  const repositoryNormalization = normalizeRequestedRepositories(requestedRepositoriesInput, {
    defaultOwner: organization,
  });
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
    requested_repository_grants: repositoryNormalization.normalizedRepositories,
    requested_repository_grant_detail: repositoryNormalization.requestedRepositoryDetail,
    duplicate_repositories: repositoryNormalization.duplicateRepositories,
    conflicting_repositories: repositoryNormalization.conflictingRepositories,
    invalid_repositories: repositoryNormalization.invalidRepositories,
    request_status: 'submitted',
    business_justification: justification || '',
    dry_run: dryRun,
    submitted_at: submittedAt,
    validation_findings: {
      duplicate_repositories: repositoryNormalization.duplicateRepositories,
      conflicting_repositories: repositoryNormalization.conflictingRepositories,
      invalid_repositories: repositoryNormalization.invalidRepositories,
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