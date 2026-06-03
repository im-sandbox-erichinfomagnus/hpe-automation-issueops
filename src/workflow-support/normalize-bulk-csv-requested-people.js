'use strict';

const {
  buildRequestedPersonDetail,
  classifyRequestedPerson,
  normalizeLogin,
  unwrapCodeFence,
} = require('./normalize-requested-people');

const REQUIRED_COLUMNS = ['username'];
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
    normalizedPeople: [],
    duplicatePeople: [],
    invalidPeople: [],
    requestedPeopleDetail: [],
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

function buildRowFinding(rowNumber, row, validationStatus, failureReason, username) {
  return {
    row_number: rowNumber,
    original_row: row.join(','),
    username: username || null,
    validation_status: validationStatus,
    failure_reason: failureReason || null,
  };
}

function describeBulkCsvRowIssue(finding) {
  switch (finding.failure_reason) {
    case 'missing_username':
      return `CSV row ${finding.row_number} is missing the required username value.`;
    case 'invalid_username':
      return `CSV row ${finding.row_number} contains an invalid GitHub username${finding.username ? `: ${finding.username}` : ''}.`;
    case 'inconsistent_shape':
      return `CSV row ${finding.row_number} does not match the header column count.`;
    default:
      return `CSV row ${finding.row_number} is invalid.`;
  }
}

function normalizeBulkCsvRequestedPeople(rawInput) {
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
  const usernameColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'username') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const unsupportedColumns = headerColumns.filter(
    (value) => value && !REQUIRED_COLUMNS.includes(value)
  );
  const schemaErrors = [];

  if (usernameColumnIndexes.length === 0) {
    schemaErrors.push('Bulk CSV input must include the required `username` header.');
  } else if (usernameColumnIndexes.length > 1) {
    schemaErrors.push('Bulk CSV input must include the `username` header exactly once.');
  }

  if (unsupportedColumns.length > 0) {
    schemaErrors.push(
      `Bulk CSV input contains unsupported columns: ${unsupportedColumns.join(', ')}.`
    );
  }

  const usernameColumnIndex = usernameColumnIndexes[0] ?? -1;
  const seen = new Set();
  const normalizedPeople = [];
  const duplicatePeople = [];
  const invalidPeople = [];
  const requestedPeopleDetail = [];
  const rowFindings = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 1;
    if (row.length === 1 && String(row[0] || '').trim() === '') {
      rowFindings.push(buildRowFinding(rowNumber, row, 'blank', 'blank_row'));
      requestedPeopleDetail.push(buildRequestedPersonDetail('', {
        source_row_number: rowNumber,
        validation_status: 'blank',
        failure_reason: 'blank_row',
      }));
      return;
    }

    if (row.length !== headerColumns.length) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'inconsistent_shape'));
      requestedPeopleDetail.push(buildRequestedPersonDetail(row.join(','), {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'inconsistent_shape',
      }));
      return;
    }

    const rawUsername = usernameColumnIndex >= 0 ? String(row[usernameColumnIndex] || '') : '';
    const username = normalizeLogin(rawUsername);

    if (!rawUsername.trim()) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'missing_username'));
      requestedPeopleDetail.push(buildRequestedPersonDetail(row.join(','), {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'missing_username',
      }));
      return;
    }

    const classification = classifyRequestedPerson(row.join(','), {
      username,
      seen,
      detail: {
        source_row_number: rowNumber,
      },
    });

    if (classification.status === 'invalid') {
      invalidPeople.push(username || rawUsername.trim());
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'invalid_username', username));
      requestedPeopleDetail.push({
        ...classification.detail,
        validation_status: 'invalid',
        failure_reason: 'invalid_username',
      });
      return;
    }

    if (classification.status === 'duplicate') {
      duplicatePeople.push(username);
      rowFindings.push(buildRowFinding(rowNumber, row, 'duplicate', 'duplicate_username', username));
      requestedPeopleDetail.push({
        ...classification.detail,
        validation_status: 'duplicate',
        failure_reason: 'duplicate_username',
      });
      return;
    }

    normalizedPeople.push(username);
    rowFindings.push(buildRowFinding(rowNumber, row, 'valid', null, username));
    requestedPeopleDetail.push({
      ...classification.detail,
      validation_status: 'valid',
      failure_reason: null,
    });
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
    normalizedPeople,
    duplicatePeople,
    invalidPeople,
    requestedPeopleDetail,
    csv_row_findings: rowFindings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
  };
}

module.exports = {
  CSV_ROW_NUMBERING_CONVENTION,
  REQUIRED_COLUMNS,
  createEmptyBulkCsvNormalization,
  describeBulkCsvRowIssue,
  normalizeBulkCsvRequestedPeople,
};