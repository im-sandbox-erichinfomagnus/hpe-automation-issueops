'use strict';

const RUNNER_NAME_MAX_LENGTH = 64;
const RUNNER_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const ALLOWED_IMAGE_SOURCES = ['github', 'partner', 'custom'];

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

function normalizeRunnerBaseName(value) {
  return normalizeText(value)
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '')
    .slice(0, RUNNER_NAME_MAX_LENGTH);
}

function buildTenantRunnerPrefix(tenantDisplayName) {
  return normalizeText(tenantDisplayName).replace(/\s+/g, '_');
}

function deriveRunnerName(tenantDisplayName, runnerBaseName) {
  const tenantPrefix = buildTenantRunnerPrefix(tenantDisplayName);
  const normalizedBase = normalizeRunnerBaseName(runnerBaseName);

  if (!tenantPrefix || !normalizedBase) {
    return {
      tenant_prefix: tenantPrefix,
      runner_base_name_normalized: normalizedBase,
      derived_name: '',
      derivation_status: 'empty',
      constraint_findings: ['Tenant prefix and runner base name are both required for derivation.'],
    };
  }

  const lowerBase = normalizedBase.toLowerCase();
  const lowerPrefix = `${tenantPrefix.toLowerCase()}_`;
  const derivedName = lowerBase.startsWith(lowerPrefix)
    ? normalizedBase
    : `${tenantPrefix}_${normalizedBase}`;

  const constraintFindings = [];
  if (derivedName.length > RUNNER_NAME_MAX_LENGTH) {
    constraintFindings.push(
      `Derived runner name exceeds ${RUNNER_NAME_MAX_LENGTH} characters (${derivedName.length}).`
    );
  }
  if (!RUNNER_NAME_PATTERN.test(derivedName)) {
    constraintFindings.push(
      'Derived runner name contains characters outside the allowed set (letters, digits, ., -, _).'
    );
  }

  return {
    tenant_prefix: tenantPrefix,
    runner_base_name_normalized: normalizedBase,
    derived_name: derivedName,
    derivation_status: constraintFindings.length === 0 ? 'valid' : 'invalid',
    constraint_findings: constraintFindings,
  };
}

function normalizeMaximumRunners(value) {
  const text = normalizeText(value);
  if (!text || text.toLowerCase() === 'none') {
    return { value: null, valid: true };
  }

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { value: null, valid: false };
  }

  return { value: parsed, valid: true };
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

function parseHostedRunnerRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const tenantNameInput = normalizeText(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const tenantNameNormalized = normalizeTenantName(tenantNameInput);
  const runnerBaseNameInput = normalizeText(
    readField(parsed, ['runner_name', 'parsed_runner_name']) || input.runnerName
  );
  const runnerImageId = normalizeText(
    readField(parsed, ['runner_image_id', 'parsed_runner_image_id']) || input.runnerImageId
  );
  const runnerImageSource = normalizeDropdownValue(
    readField(parsed, ['runner_image_source', 'parsed_runner_image_source']) || input.runnerImageSource || 'github'
  ) || 'github';
  const runnerSize = normalizeText(
    readField(parsed, ['runner_size', 'parsed_runner_size']) || input.runnerSize
  );
  const runnerGroupNameInput = normalizeText(
    readField(parsed, ['runner_group_name', 'parsed_runner_group_name']) || input.runnerGroupName
  );
  const maximumRunnersResult = normalizeMaximumRunners(
    readField(parsed, ['maximum_runners', 'parsed_maximum_runners']) || input.maximumRunners
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

  const runnerNameDerivation = deriveRunnerName(tenantNameInput, runnerBaseNameInput);

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: tenantNameNormalized,
    runner_base_name_input: runnerBaseNameInput,
    runner_name_derivation: runnerNameDerivation,
    runner_name_derived: runnerNameDerivation.derived_name,
    runner_image_id: runnerImageId,
    runner_image_source: runnerImageSource,
    runner_size: runnerSize,
    runner_group_name_input: runnerGroupNameInput,
    maximum_runners: maximumRunnersResult.value,
    maximum_runners_valid: maximumRunnersResult.valid,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

module.exports = {
  ALLOWED_IMAGE_SOURCES,
  RUNNER_NAME_MAX_LENGTH,
  buildTenantRunnerPrefix,
  deriveRunnerName,
  normalizeBoolean,
  normalizeMaximumRunners,
  normalizeRunnerBaseName,
  normalizeTenantName,
  parseHostedRunnerRequest,
};
