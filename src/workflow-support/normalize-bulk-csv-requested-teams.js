'use strict';

const {
  buildRequestedTeamDetail,
  normalizeTeamName,
  slugifyTeamName,
  unwrapCodeFence,
} = require('./normalize-requested-teams');

const REQUIRED_COLUMNS = ['team_name'];
const CSV_ROW_NUMBERING_CONVENTION = '1-based data-row numbers that exclude the header row';

function createEmptyBulkCsvNormalization(rawInput = '') {
  return {
    encoding: 'utf-8',
    header_columns: [],
    required_columns: [...REQUIRED_COLUMNS],
    unsupported_columns: [],
    row_count: 0,
    valid_row_count: 0,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'not_provided',
    schema_errors: [],
    raw_input: rawInput,
    normalizedTeams: [],
    duplicateTeamNames: [],
    conflictingSlugs: [],
    invalidTeamNames: [],
    requestedTeamDetail: [],
    csv_row_findings: [],
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
  };
}

function normalizeHeaderValue(value) {
  return String(value || '').trim().toLowerCase();
}

function parseCsvRows(rawInput) {
  const text = unwrapCodeFence(rawInput).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) {
    return [];
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === '') {
      inQuotes = true;
      continue;
    }

    if (character === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += character;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((currentRow) => currentRow.map((value) => String(value)));
}

function buildRowFinding(rowNumber, row, validationStatus, failureReason, teamName, normalizedSlug) {
  return {
    row_number: rowNumber,
    original_row: row.join(','),
    team_name: teamName || null,
    normalized_slug: normalizedSlug || null,
    validation_status: validationStatus,
    failure_reason: failureReason || null,
  };
}

function normalizeBulkCsvRequestedTeams(rawInput) {
  const empty = createEmptyBulkCsvNormalization(rawInput);
  if (!unwrapCodeFence(rawInput).trim()) {
    return empty;
  }

  const rows = parseCsvRows(rawInput);
  if (rows.length === 0) {
    return {
      ...empty,
      schema_status: 'invalid',
      schema_errors: ['Bulk CSV input must contain a header row.'],
    };
  }

  const headerColumns = rows[0].map(normalizeHeaderValue);
  const teamNameColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'team_name') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const unsupportedColumns = headerColumns.filter(
    (value) => value && !REQUIRED_COLUMNS.includes(value)
  );
  const schemaErrors = [];

  if (teamNameColumnIndexes.length === 0) {
    schemaErrors.push('Bulk CSV input must include the required `team_name` header.');
  } else if (teamNameColumnIndexes.length > 1) {
    schemaErrors.push('Bulk CSV input must include the `team_name` header exactly once.');
  }

  if (unsupportedColumns.length > 0) {
    schemaErrors.push(
      `Bulk CSV input contains unsupported columns: ${unsupportedColumns.join(', ')}.`
    );
  }

  const teamNameColumnIndex = teamNameColumnIndexes[0] ?? -1;
  const seenNames = new Set();
  const slugToName = new Map();
  const normalizedTeams = [];
  const duplicateTeamNames = [];
  const conflictingSlugs = [];
  const invalidTeamNames = [];
  const requestedTeamDetail = [];
  const rowFindings = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 1;
    if (row.length === 1 && String(row[0] || '').trim() === '') {
      rowFindings.push(buildRowFinding(rowNumber, row, 'blank', 'blank_row'));
      requestedTeamDetail.push(buildRequestedTeamDetail('', {
        source_row_number: rowNumber,
        validation_status: 'blank',
        failure_reason: 'blank_row',
      }));
      return;
    }

    if (row.length !== headerColumns.length) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'inconsistent_shape'));
      requestedTeamDetail.push(buildRequestedTeamDetail(row.join(','), {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'inconsistent_shape',
      }));
      return;
    }

    const rawTeamName = teamNameColumnIndex >= 0 ? String(row[teamNameColumnIndex] || '') : '';
    const teamName = normalizeTeamName(rawTeamName);
    const normalizedKey = teamName.toLowerCase();
    const normalizedSlug = slugifyTeamName(teamName);

    if (!rawTeamName.trim()) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'missing_team_name'));
      requestedTeamDetail.push(buildRequestedTeamDetail(row.join(','), {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'missing_team_name',
      }));
      return;
    }

    if (!normalizedSlug) {
      invalidTeamNames.push(teamName || rawTeamName.trim());
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'invalid_team_name', teamName));
      requestedTeamDetail.push(buildRequestedTeamDetail(teamName || rawTeamName.trim(), {
        normalized_slug: normalizedSlug,
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'invalid_team_name',
      }));
      return;
    }

    if (seenNames.has(normalizedKey)) {
      duplicateTeamNames.push(teamName);
      rowFindings.push(buildRowFinding(rowNumber, row, 'duplicate', 'duplicate_team_name', teamName, normalizedSlug));
      requestedTeamDetail.push(buildRequestedTeamDetail(teamName, {
        normalized_slug: normalizedSlug,
        source_row_number: rowNumber,
        validation_status: 'duplicate',
        failure_reason: 'duplicate_team_name',
      }));
      return;
    }

    if (slugToName.has(normalizedSlug) && slugToName.get(normalizedSlug) !== normalizedKey) {
      conflictingSlugs.push({
        slug: normalizedSlug,
        names: [slugToName.get(normalizedSlug), normalizedKey],
      });
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'conflicting_slug', teamName, normalizedSlug));
      requestedTeamDetail.push(buildRequestedTeamDetail(teamName, {
        normalized_slug: normalizedSlug,
        source_row_number: rowNumber,
        validation_status: 'conflicting',
        failure_reason: 'conflicting_slug',
      }));
      return;
    }

    seenNames.add(normalizedKey);
    slugToName.set(normalizedSlug, normalizedKey);
    normalizedTeams.push({
      requested_name: teamName,
      normalized_slug: normalizedSlug,
      source_row_number: rowNumber,
    });
    rowFindings.push(buildRowFinding(rowNumber, row, 'valid', null, teamName, normalizedSlug));
    requestedTeamDetail.push(buildRequestedTeamDetail(teamName, {
      normalized_slug: normalizedSlug,
      source_row_number: rowNumber,
      validation_status: 'valid',
    }));
  });

  const invalidRowCount = rowFindings.filter(
    (finding) => finding.validation_status === 'invalid'
  ).length;

  return {
    encoding: 'utf-8',
    header_columns: headerColumns,
    required_columns: [...REQUIRED_COLUMNS],
    unsupported_columns: unsupportedColumns,
    row_count: rows.length - 1,
    valid_row_count: rowFindings.filter((finding) => finding.validation_status === 'valid').length,
    invalid_row_count: invalidRowCount,
    duplicate_row_count: rowFindings.filter((finding) => finding.validation_status === 'duplicate').length,
    schema_status: schemaErrors.length === 0 && invalidRowCount === 0 ? 'valid' : 'invalid',
    schema_errors: schemaErrors,
    raw_input: rawInput,
    normalizedTeams,
    duplicateTeamNames,
    conflictingSlugs,
    invalidTeamNames,
    requestedTeamDetail,
    csv_row_findings: rowFindings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
  };
}

module.exports = {
  CSV_ROW_NUMBERING_CONVENTION,
  REQUIRED_COLUMNS,
  createEmptyBulkCsvNormalization,
  normalizeBulkCsvRequestedTeams,
  parseCsvRows,
};