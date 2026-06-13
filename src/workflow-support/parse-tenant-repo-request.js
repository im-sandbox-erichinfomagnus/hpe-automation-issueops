'use strict';

const { normalizeContact } = require('./normalize-contact');
const { normalizeRepositoryVisibility } = require('./repository-visibility');

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

function normalizeRepositoryName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 100);
}

function normalizeTenantName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
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

function parseTenantRepoRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const repositoryNameInput = normalizeText(
    readField(parsed, ['repository_name', 'parsed_repository_name']) || input.repositoryName
  );
  const tenantNameInput = normalizeText(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const repositoryNameNormalized = normalizeRepositoryName(repositoryNameInput);
  const tenantNameNormalized = normalizeTenantName(tenantNameInput);
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designatedApprover
  );
  const dryRun = normalizeBoolean(
    readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run,
    true
  );
  const repositoryVisibilityInput = readField(parsed, ['repository_visibility', 'parsed_repository_visibility']) || input.repositoryVisibility || input.repository_visibility;
  const { visibility: repositoryVisibility, source: repositoryVisibilitySource } = normalizeRepositoryVisibility(
    repositoryVisibilityInput,
    { allowDefault: false }
  );
  const primaryContactInput = normalizeText(
    readField(parsed, ['primary_contact', 'parsed_primary_contact']) || input.primaryContact || input.primary_contact
  );
  const { normalized: primaryContact, type: primaryContactType } = normalizeContact(primaryContactInput);
  const secondaryContactInput = normalizeText(
    readField(parsed, ['secondary_contact', 'parsed_secondary_contact']) || input.secondaryContact || input.secondary_contact
  );
  const { normalized: secondaryContact, type: secondaryContactType } = normalizeContact(secondaryContactInput);
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

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: tenantNameNormalized,
    repository_name_input: repositoryNameInput,
    repository_name_normalized: repositoryNameNormalized,
    repository_visibility: repositoryVisibility,
    repository_visibility_source: repositoryVisibilitySource,
    primary_contact: primaryContact,
    primary_contact_type: primaryContactType,
    secondary_contact: secondaryContact,
    secondary_contact_type: secondaryContactType,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

module.exports = {
  normalizeBoolean,
  normalizeRepositoryName,
  normalizeTenantName,
  parseTenantRepoRequest,
};