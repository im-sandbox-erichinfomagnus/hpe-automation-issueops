'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSlug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 100);
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

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return '';
}

function deriveTenantTeams(tenantDisplayName) {
  const normalizedName = normalizeText(tenantDisplayName).replace(/\s+/g, '_');
  const tenantTeamName = `${normalizedName}_Tenant`;
  const repoAdminsTeamName = `${normalizedName}_RepoAdmins`;

  return {
    tenant_team_name: tenantTeamName,
    tenant_team_slug: normalizeSlug(tenantTeamName),
    repo_admin_team_name: repoAdminsTeamName,
    repo_admin_team_slug: normalizeSlug(repoAdminsTeamName),
  };
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseTenantCreationRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeText(input.requesterLogin || issue.user && issue.user.login || '').toLowerCase();
  const organization = normalizeText(readField(parsed, ['organization', 'parsed_organization']) || input.organization).toLowerCase();
  const tenantDisplayName = normalizeText(readField(parsed, ['tenant_name', 'parsed_tenant_name']) || input.tenant_name);
  const designatedApprover = normalizeText(readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designated_approver).toLowerCase();
  const dryRun = normalizeBoolean(readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run, true);
  const justification = normalizeText(readField(parsed, ['justification', 'parsed_justification', 'business_justification']) || input.justification);
  const submittedAt = input.submittedAt || new Date().toISOString();
  const requestId = buildRequestId(
    repository,
    issueNumber,
    runContext.run_id || process.env.GITHUB_RUN_ID,
    runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
  );

  const tenantKey = normalizeSlug(tenantDisplayName);
  const derivedTeams = deriveTenantTeams(tenantDisplayName);

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_display_name: tenantDisplayName,
    tenant_key: tenantKey,
    designated_approver_login: designatedApprover,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
    requested_teams: [
      {
        requested_name: derivedTeams.tenant_team_name,
        normalized_slug: derivedTeams.tenant_team_slug,
        desired_action: 'create_team',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
      {
        requested_name: derivedTeams.repo_admin_team_name,
        normalized_slug: derivedTeams.repo_admin_team_slug,
        desired_action: 'create_team',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
    ],
    parent_team_slug: derivedTeams.tenant_team_slug,
    requested_child_links: [
      {
        child_team_slug: derivedTeams.repo_admin_team_slug,
        requested_child_name: derivedTeams.repo_admin_team_name,
        desired_action: 'link_child',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
    ],
    tenant_team_name: derivedTeams.tenant_team_name,
    tenant_team_slug: derivedTeams.tenant_team_slug,
    repo_admin_team_name: derivedTeams.repo_admin_team_name,
    repo_admin_team_slug: derivedTeams.repo_admin_team_slug,
  };
}

module.exports = {
  parseTenantCreationRequest,
  normalizeBoolean,
  normalizeSlug,
};
