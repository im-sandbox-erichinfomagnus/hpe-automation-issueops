'use strict';

// Default operation set for org-wide variable management. Pending Uma's
// confirmation the op supports full CRUD; restricting it (e.g. to create and
// update only) is a one-line change here.
const ALLOWED_ORG_VARIABLE_OPERATIONS = ['create', 'update', 'delete'];
// 'selected' visibility needs repository ids and is deliberately unsupported in v1.
const ALLOWED_ORG_VARIABLE_VISIBILITIES = ['all', 'private'];
const ORG_VARIABLE_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

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

function normalizeDropdownValue(value) {
  return normalizeText(value).replace(/^\[|\]$/g, '').trim().toLowerCase();
}

function normalizeOrgVariableName(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeOrgVariableValue(value) {
  if (value == null) {
    return null;
  }
  const normalized = normalizeText(value);
  return normalized === '' ? null : normalized;
}

// Strict positional columns: name,value[,operation[,visibility]]. Trailing
// columns are optional and an optional header row is tolerated, keeping the
// shape easy to adjust once Uma confirms the final CSV contract.
function parseOrgVariablesCsv(rawValue) {
  const entries = [];
  const rawLines = String(rawValue || '').replace(/\r\n/g, '\n').split('\n');
  let seenDataRow = false;
  for (const rawLine of rawLines) {
    const line = normalizeText(rawLine);
    if (!line) {
      continue;
    }
    const parts = line.split(',').map((part) => normalizeText(part));
    const candidateName = normalizeOrgVariableName(parts[0]);
    if (!seenDataRow && candidateName === 'NAME') {
      seenDataRow = true;
      continue;
    }
    seenDataRow = true;
    entries.push({
      name: candidateName,
      value: parts.length > 1 ? normalizeOrgVariableValue(parts[1]) : null,
      operation: parts.length > 2 ? normalizeDropdownValue(parts[2]) : '',
      visibility: parts.length > 3 ? normalizeDropdownValue(parts[3]) : '',
      column_count: parts.length,
    });
  }
  return entries;
}

function mergeOrgVariableEntries(singleEntry, csvEntries) {
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
    merged.push({
      name: entry.name,
      value: entry.value == null ? null : entry.value,
      operation: entry.operation || '',
      visibility: entry.visibility || '',
      column_count: entry.column_count || 0,
    });
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

function parseOrgVariablesRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const orgVariableOperation = normalizeDropdownValue(
    readField(parsed, ['org_variable_operation', 'parsed_org_variable_operation']) || input.orgVariableOperation
  );
  const singleName = normalizeOrgVariableName(
    readField(parsed, ['org_variable_name', 'parsed_org_variable_name']) || input.orgVariableName
  );
  const singleValue = normalizeOrgVariableValue(
    readField(parsed, ['org_variable_value', 'parsed_org_variable_value']) || input.orgVariableValue
  );
  const csvEntries = parseOrgVariablesCsv(
    readField(parsed, ['org_variables_csv', 'parsed_org_variables_csv']) || input.orgVariablesCsv
  );
  const variableEntries = mergeOrgVariableEntries(
    { name: singleName, value: singleValue, operation: '', visibility: '', column_count: 0 },
    csvEntries
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
    org_variable_operation: orgVariableOperation,
    org_variable_name_input: singleName,
    org_variable_value_input: singleValue,
    org_variable_entries: variableEntries,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

module.exports = {
  ALLOWED_ORG_VARIABLE_OPERATIONS,
  ALLOWED_ORG_VARIABLE_VISIBILITIES,
  ORG_VARIABLE_NAME_PATTERN,
  normalizeOrgVariableName,
  parseOrgVariablesCsv,
  parseOrgVariablesRequest,
};
