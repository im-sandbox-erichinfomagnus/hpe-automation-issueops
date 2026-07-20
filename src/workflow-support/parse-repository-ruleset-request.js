'use strict';

const ALLOWED_RULESET_OPERATIONS = ['create', 'delete'];
const ALLOWED_RULESET_TARGETS = ['branch', 'tag'];
const ALLOWED_RULESET_ENFORCEMENTS = ['active', 'evaluate', 'disabled'];
const DEFAULT_REF_NAME_PATTERN = '~DEFAULT_BRANCH';

// Column order for the spreadsheet/CSV batch textarea. A create row carries the
// full ruleset shape; a delete row only needs the repository and ruleset name.
const CREATE_CSV_COLUMNS = [
  'repository',
  'ruleset_name',
  'target',
  'ref_name_pattern',
  'enforcement',
  'require_pull_request',
  'block_force_pushes',
  'require_linear_history',
  'restrict_deletions',
];
const DELETE_CSV_COLUMNS = ['repository', 'ruleset_name'];

// Fields that only appear on a create request. Their presence in the raw parsed
// payload distinguishes a create issue (create-only dropdowns always emit
// defaults) from a delete issue, which carries none of them.
const CREATE_ONLY_FIELDS = [
  ['target', 'parsed_target'],
  ['ref_name_pattern', 'parsed_ref_name_pattern'],
  ['enforcement', 'parsed_enforcement'],
  ['require_pull_request', 'parsed_require_pull_request'],
  ['block_force_pushes', 'parsed_block_force_pushes'],
  ['require_linear_history', 'parsed_require_linear_history'],
  ['restrict_deletions', 'parsed_restrict_deletions'],
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

function normalizeRepositoryName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 100);
}

function normalizeRulesetName(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function unwrapCodeFence(rawInput) {
  const text = String(rawInput == null ? '' : rawInput);
  const fenceMatch = text.match(/^\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```\s*$/);
  return fenceMatch ? fenceMatch[1] : text;
}

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return '';
}

function hasAnyField(source, fieldPairs) {
  for (const keys of fieldPairs) {
    if (readField(source, keys) !== '') {
      return true;
    }
  }
  return false;
}

// Minimal quoted-CSV row splitter (supports "" escapes inside quotes).
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell === '') {
      inQuotes = true;
      continue;
    }
    if (character === ',') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell);
  return cells;
}

function buildCreateEntry(fields, source) {
  return {
    repository_input: normalizeText(fields.repository),
    repository: normalizeRepositoryName(fields.repository),
    ruleset_name: normalizeRulesetName(fields.ruleset_name),
    target: normalizeDropdownValue(fields.target) || 'branch',
    ref_name_pattern: normalizeText(fields.ref_name_pattern) || DEFAULT_REF_NAME_PATTERN,
    enforcement: normalizeDropdownValue(fields.enforcement) || 'active',
    require_pull_request: normalizeBoolean(fields.require_pull_request, false),
    block_force_pushes: normalizeBoolean(fields.block_force_pushes, false),
    require_linear_history: normalizeBoolean(fields.require_linear_history, false),
    restrict_deletions: normalizeBoolean(fields.restrict_deletions, false),
    source,
  };
}

function buildDeleteEntry(fields, source) {
  return {
    repository_input: normalizeText(fields.repository),
    repository: normalizeRepositoryName(fields.repository),
    ruleset_name: normalizeRulesetName(fields.ruleset_name),
    source,
  };
}

function parseRulesetsCsv(rawValue, operation) {
  const columns = operation === 'delete' ? DELETE_CSV_COLUMNS : CREATE_CSV_COLUMNS;
  const text = unwrapCodeFence(rawValue).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const entries = [];
  const rawLines = text.split('\n');
  let seenDataRow = false;
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const cells = splitCsvLine(line).map((cell) => cell.trim());
    // Skip an optional header row.
    if (!seenDataRow && cells[0] && cells[0].toLowerCase() === 'repository') {
      seenDataRow = true;
      continue;
    }
    seenDataRow = true;
    const fields = {};
    columns.forEach((column, index) => {
      fields[column] = cells[index] != null ? cells[index] : '';
    });
    entries.push(operation === 'delete' ? buildDeleteEntry(fields, 'csv') : buildCreateEntry(fields, 'csv'));
  }
  return entries;
}

function mergeRulesetEntries(singleEntry, csvEntries) {
  const merged = [];
  const seen = new Set();
  const candidates = [];
  if (singleEntry && singleEntry.repository && singleEntry.ruleset_name) {
    candidates.push(singleEntry);
  }
  for (const entry of csvEntries) {
    if (entry && entry.repository && entry.ruleset_name) {
      candidates.push(entry);
    }
  }
  for (const entry of candidates) {
    const key = `${entry.repository} ${entry.ruleset_name.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseRepositoryRulesetRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const explicitOperation = normalizeDropdownValue(input.rulesetOperation || input.ruleset_operation);
  const rulesetOperation = ALLOWED_RULESET_OPERATIONS.includes(explicitOperation)
    ? explicitOperation
    : hasAnyField(parsed, CREATE_ONLY_FIELDS)
      ? 'create'
      : 'delete';

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const tenantNameInput = normalizeText(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const tenantNameNormalized = normalizeTenantName(tenantNameInput);

  const singleFields = {
    repository: readField(parsed, ['repository', 'parsed_repository']) || input.repositoryTarget,
    ruleset_name: readField(parsed, ['ruleset_name', 'parsed_ruleset_name']) || input.rulesetName,
    target: readField(parsed, ['target', 'parsed_target']) || input.target,
    ref_name_pattern: readField(parsed, ['ref_name_pattern', 'parsed_ref_name_pattern']) || input.refNamePattern,
    enforcement: readField(parsed, ['enforcement', 'parsed_enforcement']) || input.enforcement,
    require_pull_request: readField(parsed, ['require_pull_request', 'parsed_require_pull_request']) || input.requirePullRequest,
    block_force_pushes: readField(parsed, ['block_force_pushes', 'parsed_block_force_pushes']) || input.blockForcePushes,
    require_linear_history: readField(parsed, ['require_linear_history', 'parsed_require_linear_history']) || input.requireLinearHistory,
    restrict_deletions: readField(parsed, ['restrict_deletions', 'parsed_restrict_deletions']) || input.restrictDeletions,
  };
  const singleEntry = rulesetOperation === 'delete'
    ? buildDeleteEntry(singleFields, 'form')
    : buildCreateEntry(singleFields, 'form');

  const csvRaw = readField(parsed, ['rulesets_csv', 'parsed_rulesets_csv', 'bulk_csv_requested_rulesets']) || input.rulesetsCsv;
  const csvEntries = parseRulesetsCsv(csvRaw, rulesetOperation);
  const rulesetEntries = mergeRulesetEntries(singleEntry, csvEntries);

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
    ruleset_operation: rulesetOperation,
    ruleset_entries: rulesetEntries,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

function buildRepositoryRulesetPayload(entry = {}) {
  const rules = [];

  if (entry.require_pull_request) {
    rules.push({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  }

  if (entry.block_force_pushes) {
    rules.push({ type: 'non_fast_forward' });
  }

  if (entry.require_linear_history) {
    rules.push({ type: 'required_linear_history' });
  }

  if (entry.restrict_deletions) {
    rules.push({ type: 'deletion' });
  }

  return {
    name: entry.ruleset_name || '',
    target: entry.target || 'branch',
    enforcement: entry.enforcement || 'active',
    conditions: {
      ref_name: {
        include: [entry.ref_name_pattern || DEFAULT_REF_NAME_PATTERN],
        exclude: [],
      },
    },
    rules,
  };
}

module.exports = {
  ALLOWED_RULESET_OPERATIONS,
  ALLOWED_RULESET_TARGETS,
  ALLOWED_RULESET_ENFORCEMENTS,
  CREATE_CSV_COLUMNS,
  DELETE_CSV_COLUMNS,
  DEFAULT_REF_NAME_PATTERN,
  buildRepositoryRulesetPayload,
  mergeRulesetEntries,
  normalizeRepositoryName,
  normalizeRulesetName,
  parseRulesetsCsv,
  parseRepositoryRulesetRequest,
};
