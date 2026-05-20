'use strict';

const {
  classifyRequestedChildTeam,
  createChildTeamNormalizationState,
  normalizeTeamName,
  unwrapCodeFence,
} = require('./normalize-requested-child-teams');

const REQUIRED_COLUMNS = ['child_team'];
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
    normalizedChildTeams: [],
    duplicateChildTeams: [],
    conflictingChildSlugs: [],
    invalidChildTeams: [],
    requestedChildTeamDetail: [],
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

function buildRequestedChildTeamDetail(requestedName, options = {}) {
  return {
    requested_name: requestedName,
    normalized_slug: options.normalized_slug || '',
    source_row_number: options.source_row_number || null,
    validation_status: options.validation_status || 'valid',
    failure_reason: options.failure_reason || null,
  };
}

function buildRowFinding(rowNumber, row, validationStatus, failureReason, childTeamName, normalizedSlug) {
  return {
    row_number: rowNumber,
    original_row: row.join(','),
    child_team_name: childTeamName || null,
    normalized_slug: normalizedSlug || null,
    validation_status: validationStatus,
    failure_reason: failureReason || null,
  };
}

function normalizeBulkCsvRequestedChildTeams(rawInput) {
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
  const childTeamColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'child_team') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const unsupportedColumns = headerColumns.filter(
    (value) => value && !REQUIRED_COLUMNS.includes(value)
  );
  const schemaErrors = [];

  if (childTeamColumnIndexes.length === 0) {
    schemaErrors.push('Bulk CSV input must include the required `child_team` header.');
  } else if (childTeamColumnIndexes.length > 1) {
    schemaErrors.push('Bulk CSV input must include the `child_team` header exactly once.');
  }

  if (unsupportedColumns.length > 0) {
    schemaErrors.push(
      `Bulk CSV input contains unsupported columns: ${unsupportedColumns.join(', ')}.`
    );
  }

  const childTeamColumnIndex = childTeamColumnIndexes[0] ?? -1;
  const state = createChildTeamNormalizationState();
  const normalizedChildTeams = [];
  const requestedChildTeamDetail = [];
  const rowFindings = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 1;
    if (row.length === 1 && String(row[0] || '').trim() === '') {
      rowFindings.push(buildRowFinding(rowNumber, row, 'blank', 'blank_row'));
      requestedChildTeamDetail.push(buildRequestedChildTeamDetail('', {
        source_row_number: rowNumber,
        validation_status: 'blank',
        failure_reason: 'blank_row',
      }));
      return;
    }

    if (row.length !== headerColumns.length) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'inconsistent_shape'));
      requestedChildTeamDetail.push(buildRequestedChildTeamDetail(row.join(','), {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'inconsistent_shape',
      }));
      return;
    }

    const rawChildTeamName = childTeamColumnIndex >= 0 ? String(row[childTeamColumnIndex] || '') : '';

    if (!rawChildTeamName.trim()) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'missing_child_team'));
      requestedChildTeamDetail.push(buildRequestedChildTeamDetail(row.join(','), {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'missing_child_team',
      }));
      return;
    }

    const normalizedChildTeam = classifyRequestedChildTeam(rawChildTeamName, state);
    const childTeamName = normalizedChildTeam.requested_name;
    const normalizedSlug = normalizedChildTeam.normalized_slug;

    if (normalizedChildTeam.validation_status === 'invalid') {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'invalid_child_team', childTeamName));
      requestedChildTeamDetail.push(buildRequestedChildTeamDetail(childTeamName || rawChildTeamName.trim(), {
        normalized_slug: normalizedSlug,
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'invalid_child_team',
      }));
      return;
    }

    if (normalizedChildTeam.validation_status === 'duplicate') {
      rowFindings.push(buildRowFinding(rowNumber, row, 'duplicate', 'duplicate_child_team', childTeamName, normalizedSlug));
      requestedChildTeamDetail.push(buildRequestedChildTeamDetail(childTeamName, {
        normalized_slug: normalizedSlug,
        source_row_number: rowNumber,
        validation_status: 'duplicate',
        failure_reason: 'duplicate_child_team',
      }));
      return;
    }

    if (normalizedChildTeam.validation_status === 'conflicting') {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'conflicting_slug', childTeamName, normalizedSlug));
      requestedChildTeamDetail.push(buildRequestedChildTeamDetail(childTeamName, {
        normalized_slug: normalizedSlug,
        source_row_number: rowNumber,
        validation_status: 'conflicting',
        failure_reason: 'conflicting_slug',
      }));
      return;
    }

    normalizedChildTeams.push({
      requested_name: childTeamName,
      child_team_slug: normalizedSlug,
      source_row_number: rowNumber,
    });
    rowFindings.push(buildRowFinding(rowNumber, row, 'valid', null, childTeamName, normalizedSlug));
    requestedChildTeamDetail.push(buildRequestedChildTeamDetail(childTeamName, {
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
    normalizedChildTeams,
    duplicateChildTeams: state.duplicateChildTeams,
    conflictingChildSlugs: state.conflictingChildSlugs,
    invalidChildTeams: state.invalidChildTeams,
    requestedChildTeamDetail,
    csv_row_findings: rowFindings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
  };
}

module.exports = {
  CSV_ROW_NUMBERING_CONVENTION,
  REQUIRED_COLUMNS,
  createEmptyBulkCsvNormalization,
  normalizeBulkCsvRequestedChildTeams,
  parseCsvRows,
};