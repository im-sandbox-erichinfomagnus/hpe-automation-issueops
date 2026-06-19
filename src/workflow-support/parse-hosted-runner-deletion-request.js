'use strict';

const {
  buildTenantRunnerPrefix,
  deriveRunnerName,
  normalizeBoolean,
  normalizeRunnerBaseName,
  normalizeTenantName,
} = require('./parse-hosted-runner-request');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLogin(value) {
  return normalizeText(value).toLowerCase();
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

function parseHostedRunnerDeletionRequest(input = {}) {
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
    runner_deletion_scope: 'organization',
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

module.exports = {
  buildTenantRunnerPrefix,
  normalizeRunnerBaseName,
  parseHostedRunnerDeletionRequest,
};
