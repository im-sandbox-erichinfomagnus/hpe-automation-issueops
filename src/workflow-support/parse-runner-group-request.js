'use strict';

const { parseSingleCsvRow } = require('./parse-single-csv-row');

const RUNNER_GROUP_NAME_MAX_LENGTH = 100;
const ALLOWED_RUNNER_GROUP_VISIBILITIES = ['selected', 'all', 'private'];
const RUNNER_GROUP_CSV_COLUMNS = [
  'runner_group_name',
  'runner_group_visibility',
  'allows_public_repositories',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLogin(value) {
  return normalizeText(value).toLowerCase();
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

function normalizeTenantName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
}

function normalizeDropdownValue(value) {
  return normalizeText(value).replace(/^\[|\]$/g, '').trim().toLowerCase();
}

function normalizeRunnerGroupBaseName(value) {
  return normalizeText(value)
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '')
    .slice(0, RUNNER_GROUP_NAME_MAX_LENGTH);
}

function deriveRunnerGroupName(tenantDisplayName, groupBaseName) {
  const tenantPrefix = normalizeText(tenantDisplayName).replace(/\s+/g, '_');
  const normalizedBase = normalizeRunnerGroupBaseName(groupBaseName);

  if (!tenantPrefix || !normalizedBase) {
    return {
      tenant_prefix: tenantPrefix,
      group_base_name_normalized: normalizedBase,
      derived_name: '',
      derivation_status: 'empty',
      constraint_findings: ['Tenant prefix and runner group base name are both required for derivation.'],
    };
  }

  const lowerBase = normalizedBase.toLowerCase();
  const lowerPrefix = `${tenantPrefix.toLowerCase()}_`;
  const derivedName = lowerBase.startsWith(lowerPrefix)
    ? normalizedBase
    : `${tenantPrefix}_${normalizedBase}`;

  const constraintFindings = [];
  if (derivedName.length > RUNNER_GROUP_NAME_MAX_LENGTH) {
    constraintFindings.push(
      `Derived runner group name exceeds ${RUNNER_GROUP_NAME_MAX_LENGTH} characters (${derivedName.length}).`
    );
  }

  return {
    tenant_prefix: tenantPrefix,
    group_base_name_normalized: normalizedBase,
    derived_name: derivedName,
    derivation_status: constraintFindings.length === 0 ? 'valid' : 'invalid',
    constraint_findings: constraintFindings,
  };
}

function normalizeRunnerGroupVisibility(value) {
  const normalized = normalizeDropdownValue(value);
  if (!normalized) {
    return { visibility: 'selected', source: 'default' };
  }

  return { visibility: normalized, source: 'user_selected' };
}

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return '';
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseRunnerGroupRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const runnerGroupCsv = parseSingleCsvRow(
    readField(parsed, ['runner_groups_csv', 'parsed_runner_groups_csv']) || input.runner_groups_csv || input.runnerGroupsCsv,
    RUNNER_GROUP_CSV_COLUMNS
  );
  const csvRow = runnerGroupCsv.row || {};
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const tenantNameInput = normalizeText(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const tenantNameNormalized = normalizeTenantName(tenantNameInput);
  const groupBaseNameInput = normalizeText(
    csvRow.runner_group_name || readField(parsed, ['runner_group_name', 'parsed_runner_group_name']) || input.runnerGroupName
  );
  const visibilityInput = csvRow.runner_group_visibility || readField(parsed, ['runner_group_visibility', 'parsed_runner_group_visibility']) || input.runnerGroupVisibility;
  const { visibility: runnerGroupVisibility, source: runnerGroupVisibilitySource } = normalizeRunnerGroupVisibility(visibilityInput);
  const allowsPublicRepositories = normalizeBoolean(
    csvRow.allows_public_repositories || readField(parsed, ['allows_public_repositories', 'parsed_allows_public_repositories']) || input.allowsPublicRepositories,
    false
  );
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designatedApprover
  );
  const dryRun = normalizeBoolean(
    readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run,
    true
  );
  const justification = normalizeText(
    readField(parsed, ['justification', 'parsed_justification', 'business_justification']) || input.justification
  );
  const submittedAt = input.submittedAt || new Date().toISOString();
  const requestId = buildRequestId(
    repository,
    issueNumber,
    runContext.run_id || process.env.GITHUB_RUN_ID,
    runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
  );

  const runnerGroupNameDerivation = deriveRunnerGroupName(tenantNameInput, groupBaseNameInput);

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: tenantNameNormalized,
    runner_group_base_name_input: groupBaseNameInput,
    runner_group_name_derivation: runnerGroupNameDerivation,
    runner_group_name_derived: runnerGroupNameDerivation.derived_name,
    runner_group_visibility: runnerGroupVisibility,
    runner_group_visibility_source: runnerGroupVisibilitySource,
    allows_public_repositories: allowsPublicRepositories,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: runnerGroupCsv.provided ? 'csv' : 'manual',
    csv_input_provided: runnerGroupCsv.provided,
    csv_row_count: runnerGroupCsv.row_count,
    csv_input_errors: runnerGroupCsv.errors,
    request_status: 'submitted',
  };
}

module.exports = {
  ALLOWED_RUNNER_GROUP_VISIBILITIES,
  RUNNER_GROUP_CSV_COLUMNS,
  RUNNER_GROUP_NAME_MAX_LENGTH,
  deriveRunnerGroupName,
  normalizeRunnerGroupBaseName,
  normalizeRunnerGroupVisibility,
  parseRunnerGroupRequest,
};
