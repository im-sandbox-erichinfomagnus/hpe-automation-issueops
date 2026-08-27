'use strict';

const { normalizeContact } = require('./normalize-contact');
const { normalizeRepositoryVisibility } = require('./repository-visibility');

// Column order for the spreadsheet/CSV batch textarea. One row per repository to
// create within the resolved tenant boundary.
const REPOSITORIES_CSV_COLUMNS = [
  'repository_name',
  'repository_visibility',
  'primary_contact',
  'secondary_contact',
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

function deriveTenantRepositoryPrefix(tenantName) {
  const raw = normalizeText(tenantName);
  if (!raw) {
    return '';
  }

  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureTenantRepositoryPrefix(repositoryName, tenantName) {
  const normalizedRepositoryName = normalizeRepositoryName(repositoryName);
  const prefix = deriveTenantRepositoryPrefix(tenantName);
  if (!normalizedRepositoryName || !prefix) {
    return normalizedRepositoryName;
  }

  const normalizedPrefix = prefix.toLowerCase();
  const repoLower = normalizedRepositoryName.toLowerCase();
  if (repoLower === normalizedPrefix || repoLower.startsWith(`${normalizedPrefix}_`)) {
    return normalizedRepositoryName;
  }

  return `${normalizedPrefix}_${normalizedRepositoryName}`;
}

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return '';
}

function unwrapCodeFence(rawInput) {
  const text = String(rawInput == null ? '' : rawInput);
  const fenceMatch = text.match(/^\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```\s*$/);
  return fenceMatch ? fenceMatch[1] : text;
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

// Build a normalized repository entry from raw single/CSV fields. Visibility and
// contacts are normalized per entry so each row carries its own metadata.
function buildRepositoryEntry(fields, source) {
  const repositoryNameInput = normalizeText(fields.repository_name);
  const repositoryNameNormalized = normalizeRepositoryName(repositoryNameInput);
  const { visibility: repositoryVisibility, source: repositoryVisibilitySource } = normalizeRepositoryVisibility(
    fields.repository_visibility,
    { allowDefault: false }
  );
  const primaryContactInput = normalizeText(fields.primary_contact);
  const { normalized: primaryContact, type: primaryContactType } = normalizeContact(primaryContactInput);
  const secondaryContactInput = normalizeText(fields.secondary_contact);
  const { normalized: secondaryContact, type: secondaryContactType } = normalizeContact(secondaryContactInput);

  return {
    repository_name_input: repositoryNameInput,
    repository_name_normalized: repositoryNameNormalized,
    repository_visibility: repositoryVisibility,
    repository_visibility_source: repositoryVisibilitySource,
    primary_contact: primaryContact,
    primary_contact_type: primaryContactType,
    secondary_contact: secondaryContact,
    secondary_contact_type: secondaryContactType,
    source,
  };
}

function parseRepositoriesCsv(rawValue) {
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
    if (!seenDataRow && cells[0] && cells[0].toLowerCase() === 'repository_name') {
      seenDataRow = true;
      continue;
    }
    seenDataRow = true;
    const fields = {};
    REPOSITORIES_CSV_COLUMNS.forEach((column, index) => {
      fields[column] = cells[index] != null ? cells[index] : '';
    });
    entries.push(buildRepositoryEntry(fields, 'csv'));
  }
  return entries;
}

// Merge the single-item entry (when present) with the CSV rows, then dedupe by
// normalized repository name so the same repo is never provisioned twice.
function mergeRepositoryEntries(singleEntry, csvEntries) {
  const merged = [];
  const seen = new Set();
  const candidates = [];
  if (singleEntry && singleEntry.repository_name_input) {
    candidates.push(singleEntry);
  }
  for (const entry of csvEntries) {
    if (entry && entry.repository_name_input) {
      candidates.push(entry);
    }
  }
  for (const entry of candidates) {
    const key = entry.repository_name_normalized || normalizeRepositoryName(entry.repository_name_input);
    if (!key) {
      continue;
    }
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

function normalizeIntakeMode(value) {
  const normalized = normalizeText(value).replace(/[\[\]"'\s,]/g, '').toLowerCase();
  if (normalized === 'csv_attachment') {
    return 'csv_attachment';
  }
  if (normalized === 'bulk_csv') {
    return 'bulk_csv';
  }
  if (normalized === 'single') {
    return 'single';
  }
  return 'manual';
}

// Empty attachment scaffolds mirror the team-ops csv_attachment intake so the
// audit artifact and downstream approval gate see the same shape.
function createEmptyAttachmentSubmission() {
  return {
    comment_id: null,
    comment_created_at: null,
    uploader_login: null,
    attachment_url: null,
    filename: null,
    extension: null,
    content_hash: null,
    downloaded_at: null,
    byte_size: 0,
    acceptance_status: 'waiting',
    rejection_reason: null,
  };
}

function createEmptyAttachmentValidationAttempt() {
  return {
    attempt_id: null,
    request_id: null,
    candidate_comment_id: null,
    attempt_status: 'waiting',
    selection_rule: 'newest requester attachment comment after the latest failed CSV attachment validation result',
    evaluated_at: null,
    errors: [],
    warnings: [],
    supersedes_attempt_id: null,
  };
}

function parseTenantRepoRequest(input = {}) {
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
  const intakeMode = normalizeIntakeMode(
    readField(parsed, ['intake_mode', 'parsed_intake_mode']) || input.intakeMode
  );

  const comment = input.comment || input.comment_context || {};
  const issueComments = input.issueComments || input.issue_comments || [];
  const commentId = input.commentId || comment.id || comment.comment_id || null;
  const commentAuthorLogin = normalizeLogin(
    input.commentAuthorLogin || comment.author_login || (comment.user && comment.user.login) || ''
  );

  // Secondary single-item path (used when the CSV batch is empty).
  const singleFields = {
    repository_name: readField(parsed, ['repository_name', 'parsed_repository_name']) || input.repositoryName,
    repository_visibility: readField(parsed, ['repository_visibility', 'parsed_repository_visibility'])
      || input.repositoryVisibility || input.repository_visibility,
    primary_contact: readField(parsed, ['primary_contact', 'parsed_primary_contact'])
      || input.primaryContact || input.primary_contact,
    secondary_contact: readField(parsed, ['secondary_contact', 'parsed_secondary_contact'])
      || input.secondaryContact || input.secondary_contact,
  };
  const singleEntry = buildRepositoryEntry(singleFields, 'form');

  // Primary batch path.
  const csvRaw = readField(parsed, ['repositories_csv', 'parsed_repositories_csv', 'bulk_csv_requested_repositories'])
    || input.repositoriesCsv;
  const csvEntries = parseRepositoriesCsv(csvRaw);
  const repositoryEntries = mergeRepositoryEntries(singleEntry, csvEntries);

  // The first merged entry drives the backward-compatible single-item request
  // fields so downstream single-repo consumers and audits keep their shape.
  const primaryEntry = repositoryEntries[0] || singleEntry;
  const tenantRepositoryPrefix = deriveTenantRepositoryPrefix(tenantNameNormalized || tenantNameInput);
  const primaryEntryRepositoryName = ensureTenantRepositoryPrefix(
    primaryEntry.repository_name_normalized || primaryEntry.repository_name_input,
    tenantRepositoryPrefix || tenantNameNormalized || tenantNameInput
  );

  if (primaryEntryRepositoryName) {
    primaryEntry.repository_name_normalized = primaryEntryRepositoryName;
    primaryEntry.repository_name_input = primaryEntry.repository_name_input || primaryEntryRepositoryName;
  }

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
    repository_name_input: primaryEntry.repository_name_input,
    repository_name_normalized: primaryEntry.repository_name_normalized,
    repository_visibility: primaryEntry.repository_visibility,
    repository_visibility_source: primaryEntry.repository_visibility_source,
    primary_contact: primaryEntry.primary_contact,
    primary_contact_type: primaryEntry.primary_contact_type,
    secondary_contact: primaryEntry.secondary_contact,
    secondary_contact_type: primaryEntry.secondary_contact_type,
    repository_entries: repositoryEntries,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: intakeMode,
    comment_context: {
      comment_id: commentId,
      comment_author_login: commentAuthorLogin || null,
      comment_body: comment.body || input.commentBody || '',
      issue_comment_count: Array.isArray(issueComments) ? issueComments.length : 0,
    },
    accepted_attachment_submission: createEmptyAttachmentSubmission(),
    attachment_validation_attempt: createEmptyAttachmentValidationAttempt(),
    request_status: intakeMode === 'csv_attachment' ? 'waiting_for_attachment' : 'submitted',
  };
}

module.exports = {
  REPOSITORIES_CSV_COLUMNS,
  buildRepositoryEntry,
  deriveTenantRepositoryPrefix,
  ensureTenantRepositoryPrefix,
  mergeRepositoryEntries,
  normalizeBoolean,
  normalizeIntakeMode,
  normalizeRepositoryName,
  normalizeTenantName,
  parseRepositoriesCsv,
  parseTenantRepoRequest,
};
