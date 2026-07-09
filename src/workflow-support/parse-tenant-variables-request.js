'use strict';

const ALLOWED_VARIABLE_OPERATIONS = ['create', 'update', 'delete'];
const VARIABLE_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

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

function normalizeVariableName(value) {
  return normalizeText(value).toUpperCase();
}

// The tenant namespace prefix keeps every tenant's org variables isolated. It is
// derived from the canonical tenant key (uppercased, variable-name-safe) so that
// re-runs converge and tenants cannot collide in the shared org variable namespace.
function deriveTenantVariablePrefix(tenantKey) {
  const normalized = String(tenantKey || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  return normalized ? `${normalized}_` : '';
}

function applyTenantVariablePrefix(prefix, name) {
  const normalizedName = normalizeVariableName(name);
  if (!prefix) {
    return normalizedName;
  }
  return normalizedName.startsWith(prefix) ? normalizedName : `${prefix}${normalizedName}`;
}

function normalizeVariableValue(value) {
  if (value == null) {
    return null;
  }
  const normalized = normalizeText(value);
  return normalized === '' ? null : normalized;
}

function parseVariablesCsv(rawValue) {
  const entries = [];
  const rawLines = String(rawValue || '').replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of rawLines) {
    const line = normalizeText(rawLine);
    if (!line) {
      continue;
    }
    const separatorIndex = line.indexOf(',');
    if (separatorIndex === -1) {
      entries.push({ name: normalizeVariableName(line), value: null });
      continue;
    }
    const name = normalizeVariableName(line.slice(0, separatorIndex));
    const value = normalizeVariableValue(line.slice(separatorIndex + 1));
    entries.push({ name, value });
  }
  return entries;
}

function mergeVariableEntries(singleEntry, csvEntries) {
  const merged = [];
  const seen = new Set();
  const candidates = [];
  if (singleEntry && singleEntry.name) {
    candidates.push(singleEntry);
  }
  for (const entry of csvEntries) {
    if (entry && entry.name) {
      candidates.push(entry);
    }
  }
  for (const entry of candidates) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    merged.push({ name: entry.name, value: entry.value == null ? null : entry.value });
  }
  return merged;
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

function parseTenantVariablesRequest(input = {}) {
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
  const variableOperation = normalizeDropdownValue(
    readField(parsed, ['variable_operation', 'parsed_variable_operation']) || input.variableOperation
  );
  const singleName = normalizeVariableName(
    readField(parsed, ['variable_name', 'parsed_variable_name']) || input.variableName
  );
  const singleValue = normalizeVariableValue(
    readField(parsed, ['variable_value', 'parsed_variable_value']) || input.variableValue
  );
  const csvEntries = parseVariablesCsv(
    readField(parsed, ['variables_csv', 'parsed_variables_csv', 'bulk_csv_requested_variables']) || input.variablesCsv
  );
  const variableEntries = mergeVariableEntries({ name: singleName, value: singleValue }, csvEntries);
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

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: tenantNameNormalized,
    variable_operation: variableOperation,
    variable_name_input: singleName,
    variable_value_input: singleValue,
    variable_entries: variableEntries,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

module.exports = {
  ALLOWED_VARIABLE_OPERATIONS,
  VARIABLE_NAME_PATTERN,
  applyTenantVariablePrefix,
  deriveTenantVariablePrefix,
  normalizeVariableName,
  parseTenantVariablesRequest,
};
