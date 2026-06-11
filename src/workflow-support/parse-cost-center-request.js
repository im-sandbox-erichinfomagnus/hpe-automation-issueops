'use strict';

const ALLOWED_ACTIONS = ['create', 'rename', 'delete'];
const COST_CENTER_NAME_MAX_LENGTH = 255;
const KNOWN_COLUMNS = ['cost_center', 'action', 'new_name', 'cost_center_id', 'force'];

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

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }
  return '';
}

function unwrapCodeFence(value) {
  const text = String(value || '');
  const fenced = text.match(/```(?:csv)?\s*\n?([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

// Minimal RFC4180-ish single-line splitter that honors double-quoted fields so
// cost center names may contain commas when quoted.
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function parseCostCenterCsv(rawCsv) {
  const text = unwrapCodeFence(rawCsv).replace(/\r\n/g, '\n');
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { header: [], rows: [], unsupported_columns: [], schema_status: 'empty' };
  }

  const header = splitCsvLine(lines[0]).map((column) => column.toLowerCase());
  const unsupportedColumns = header.filter((column) => !KNOWN_COLUMNS.includes(column));
  const columnIndex = (name) => header.indexOf(name);

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const get = (name) => {
      const idx = columnIndex(name);
      return idx >= 0 && idx < cells.length ? normalizeText(cells[idx]) : '';
    };
    rows.push({
      source_row_number: i, // 1-based data-row number (excludes the header)
      cost_center_input: get('cost_center'),
      action_input: get('action'),
      action: get('action').toLowerCase(),
      new_name_input: get('new_name'),
      cost_center_id: get('cost_center_id'),
      force: normalizeBoolean(get('force'), false),
    });
  }

  return {
    header,
    rows,
    unsupported_columns: unsupportedColumns,
    schema_status: header.includes('cost_center') && header.includes('action') ? 'valid' : 'invalid_header',
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const deduped = [];
  let duplicateCount = 0;
  for (const row of rows) {
    const key = JSON.stringify([
      row.cost_center_input.toLowerCase(),
      row.action,
      row.new_name_input.toLowerCase(),
      String(row.cost_center_id).toLowerCase(),
      Boolean(row.force),
    ]);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return { rows: deduped, duplicate_row_count: duplicateCount };
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseCostCenterRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const enterprise = normalizeText(readField(parsed, ['enterprise', 'parsed_enterprise']) || input.enterprise);
  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designatedApprover
  );
  const dryRun = normalizeBoolean(readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run, true);
  const justification = normalizeText(
    readField(parsed, ['justification', 'parsed_justification', 'business_justification']) || input.justification
  );
  const rawCsv = readField(parsed, ['cost_centers', 'parsed_cost_centers']) || input.cost_centers || '';
  const submittedAt = input.submittedAt || new Date().toISOString();
  const requestId = buildRequestId(
    repository,
    issueNumber,
    runContext.run_id || process.env.GITHUB_RUN_ID,
    runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
  );

  const csv = parseCostCenterCsv(rawCsv);
  const { rows, duplicate_row_count } = dedupeRows(csv.rows);

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    enterprise,
    enterprise_normalized: normalizeLogin(enterprise),
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
    csv_header: csv.header,
    csv_schema_status: csv.schema_status,
    unsupported_columns: csv.unsupported_columns,
    duplicate_row_count,
    requested_changes: rows,
  };
}

module.exports = {
  ALLOWED_ACTIONS,
  COST_CENTER_NAME_MAX_LENGTH,
  KNOWN_COLUMNS,
  parseCostCenterCsv,
  parseCostCenterRequest,
  splitCsvLine,
};
