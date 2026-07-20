'use strict';

const {
  deriveRunnerName,
  normalizeBoolean,
  normalizeTenantName,
} = require('./parse-hosted-runner-request');
const { parseSingleCsvRow } = require('./parse-single-csv-row');

const HOSTED_RUNNER_MOVE_CSV_COLUMNS = [
  'runner_name',
  'hosted_runner_id',
  'target_runner_group_name',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLogin(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOptionalId(value) {
  const text = normalizeText(value);
  if (!text) {
    return { value: null, valid: true };
  }

  const parsed = Number(text);
  return {
    value: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    valid: Number.isInteger(parsed) && parsed > 0,
  };
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

function parseHostedRunnerMoveRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const runnerCsv = parseSingleCsvRow(
    readField(parsed, ['runner_moves_csv', 'parsed_runner_moves_csv']) || input.runner_moves_csv || input.runnerMovesCsv,
    HOSTED_RUNNER_MOVE_CSV_COLUMNS
  );
  const csvRow = runnerCsv.row || {};
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const tenantNameInput = normalizeText(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const runnerBaseNameInput = normalizeText(
    csvRow.runner_name || readField(parsed, ['runner_name', 'parsed_runner_name']) || input.runnerName
  );
  const hostedRunnerId = normalizeOptionalId(
    csvRow.hosted_runner_id || readField(parsed, ['hosted_runner_id', 'parsed_hosted_runner_id']) || input.hostedRunnerId
  );
  const targetRunnerGroupNameInput = normalizeText(
    csvRow.target_runner_group_name || readField(parsed, ['target_runner_group_name', 'parsed_target_runner_group_name']) ||
      input.targetRunnerGroupName
  );
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designatedApprover
  );
  const dryRun = normalizeBoolean(
    readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run,
    true
  );
  const justification = normalizeText(
    readField(parsed, ['justification', 'parsed_justification', 'business_justification']) ||
      input.justification
  );
  const runnerNameDerivation = deriveRunnerName(tenantNameInput, runnerBaseNameInput);

  return {
    request_id: buildRequestId(
      repository,
      issueNumber,
      runContext.run_id || process.env.GITHUB_RUN_ID,
      runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
    ),
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: normalizeTenantName(tenantNameInput),
    runner_base_name_input: runnerBaseNameInput,
    runner_name_derivation: runnerNameDerivation,
    runner_name_derived: runnerNameDerivation.derived_name,
    hosted_runner_id_input: hostedRunnerId.value,
    hosted_runner_id_valid: hostedRunnerId.valid,
    target_runner_group_name_input: targetRunnerGroupNameInput,
    runner_move_scope: 'organization',
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: input.submittedAt || new Date().toISOString(),
    intake_mode: runnerCsv.provided ? 'csv' : 'manual',
    csv_input_provided: runnerCsv.provided,
    csv_row_count: runnerCsv.row_count,
    csv_input_errors: runnerCsv.errors,
    request_status: 'submitted',
  };
}

module.exports = {
  HOSTED_RUNNER_MOVE_CSV_COLUMNS,
  normalizeOptionalId,
  parseHostedRunnerMoveRequest,
};
