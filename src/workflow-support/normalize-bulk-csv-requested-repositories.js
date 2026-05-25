'use strict';

const {
  buildNormalizedRepositoryGrant,
  hasPopulatedInput,
  normalizeLogin,
  parseRepositoryReference,
  unwrapCodeFence,
} = require('./normalize-requested-repositories');

const REQUIRED_COLUMNS = ['repository'];
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
    normalizedRepositories: [],
    duplicateRepositories: [],
    conflictingRepositories: [],
    invalidRepositories: [],
    requestedRepositoryDetail: [],
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

function buildRequestedRepositoryDetail(parsed, options = {}) {
  return {
    requested_repository_name: parsed.requested_repository_name || '',
    repository_owner: parsed.repository_owner || '',
    repository_name: parsed.repository_name || '',
    repository_full_name: parsed.repository_full_name || '',
    source_row_number: options.source_row_number || null,
    validation_status: options.validation_status || 'valid',
    failure_reason: options.failure_reason || null,
  };
}

function buildRowFinding(rowNumber, row, validationStatus, failureReason, repositoryValue, fullName) {
  return {
    row_number: rowNumber,
    original_row: row.join(','),
    repository_value: repositoryValue || null,
    normalized_repository_full_name: fullName || null,
    validation_status: validationStatus,
    failure_reason: failureReason || null,
  };
}

function normalizeBulkCsvRequestedRepositories(rawInput, options = {}) {
  const defaultOwner = normalizeLogin(options.defaultOwner || options.default_owner || '');
  const empty = createEmptyBulkCsvNormalization(rawInput);

  if (!hasPopulatedInput(rawInput)) {
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
  const repositoryColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'repository') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const unsupportedColumns = headerColumns.filter(
    (value) => value && !REQUIRED_COLUMNS.includes(value)
  );
  const schemaErrors = [];

  if (repositoryColumnIndexes.length === 0) {
    schemaErrors.push('Bulk CSV input must include the required `repository` header.');
  } else if (repositoryColumnIndexes.length > 1) {
    schemaErrors.push('Bulk CSV input must include the `repository` header exactly once.');
  }

  if (unsupportedColumns.length > 0) {
    schemaErrors.push(
      `Bulk CSV input contains unsupported columns: ${unsupportedColumns.join(', ')}.`
    );
  }

  const repositoryColumnIndex = repositoryColumnIndexes[0] ?? -1;
  const normalizedRepositories = [];
  const requestedRepositoryDetail = [];
  const rowFindings = [];
  const duplicateRepositories = [];
  const conflictingRepositories = [];
  const invalidRepositories = [];
  const seenRequestedNames = new Set();
  const seenFullNames = new Map();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 1;
    const isBlankRow = row.every((value) => String(value || '').trim() === '');
    if (isBlankRow) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'blank', 'blank_row'));
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail({}, {
        source_row_number: rowNumber,
        validation_status: 'blank',
        failure_reason: 'blank_row',
      }));
      return;
    }

    if (row.length !== headerColumns.length) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'inconsistent_shape'));
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail({
        requested_repository_name: row.join(','),
      }, {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'inconsistent_shape',
      }));
      return;
    }

    const rawRepositoryValue = repositoryColumnIndex >= 0 ? String(row[repositoryColumnIndex] || '') : '';
    if (!rawRepositoryValue.trim()) {
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'missing_repository'));
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail({
        requested_repository_name: rawRepositoryValue,
      }, {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'missing_repository',
      }));
      return;
    }

    const parsed = parseRepositoryReference(rawRepositoryValue, defaultOwner);
    if (!parsed || parsed.validation_status !== 'valid' || !parsed.repository_owner || !parsed.repository_name) {
      invalidRepositories.push(rawRepositoryValue.trim());
      rowFindings.push(buildRowFinding(rowNumber, row, 'invalid', 'invalid_repository', rawRepositoryValue.trim()));
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail(parsed || {
        requested_repository_name: rawRepositoryValue.trim(),
      }, {
        source_row_number: rowNumber,
        validation_status: 'invalid',
        failure_reason: 'invalid_repository',
      }));
      return;
    }

    if (defaultOwner && parsed.repository_owner !== defaultOwner) {
      conflictingRepositories.push({
        requested_repository_name: parsed.requested_repository_name,
        repository_full_name: parsed.repository_full_name,
        expected_owner: defaultOwner,
        actual_owner: parsed.repository_owner,
        conflict_reason: 'repository_outside_target_organization',
      });
      rowFindings.push(
        buildRowFinding(
          rowNumber,
          row,
          'invalid',
          'repository_outside_target_organization',
          parsed.requested_repository_name,
          parsed.repository_full_name
        )
      );
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail(parsed, {
        source_row_number: rowNumber,
        validation_status: 'conflicting',
        failure_reason: 'repository_outside_target_organization',
      }));
      return;
    }

    const requestedNameKey = String(parsed.requested_repository_name || '').trim().toLowerCase();
    if (seenRequestedNames.has(requestedNameKey)) {
      duplicateRepositories.push(parsed.requested_repository_name);
      rowFindings.push(
        buildRowFinding(
          rowNumber,
          row,
          'duplicate',
          'duplicate_repository',
          parsed.requested_repository_name,
          parsed.repository_full_name
        )
      );
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail(parsed, {
        source_row_number: rowNumber,
        validation_status: 'duplicate',
        failure_reason: 'duplicate_repository',
      }));
      return;
    }

    if (seenFullNames.has(parsed.repository_full_name)) {
      conflictingRepositories.push({
        requested_repository_name: parsed.requested_repository_name,
        repository_full_name: parsed.repository_full_name,
        expected_owner: defaultOwner || parsed.repository_owner,
        actual_owner: parsed.repository_owner,
        prior_requested_repository_name: seenFullNames.get(parsed.repository_full_name),
        conflict_reason: 'conflicting_repository_identifier',
      });
      rowFindings.push(
        buildRowFinding(
          rowNumber,
          row,
          'invalid',
          'conflicting_repository',
          parsed.requested_repository_name,
          parsed.repository_full_name
        )
      );
      requestedRepositoryDetail.push(buildRequestedRepositoryDetail(parsed, {
        source_row_number: rowNumber,
        validation_status: 'conflicting',
        failure_reason: 'conflicting_repository',
      }));
      return;
    }

    seenRequestedNames.add(requestedNameKey);
    seenFullNames.set(parsed.repository_full_name, parsed.requested_repository_name);
    normalizedRepositories.push(buildNormalizedRepositoryGrant(parsed, {
      source_row_number: rowNumber,
    }));
    rowFindings.push(
      buildRowFinding(
        rowNumber,
        row,
        'valid',
        null,
        parsed.requested_repository_name,
        parsed.repository_full_name
      )
    );
    requestedRepositoryDetail.push(buildRequestedRepositoryDetail(parsed, {
      source_row_number: rowNumber,
      validation_status: 'valid',
    }));
  });

  const invalidRowCount = rowFindings.filter((finding) => (
    finding.validation_status === 'invalid' &&
    finding.failure_reason !== 'conflicting_repository'
  )).length;
  const duplicateRowCount = rowFindings.filter((finding) => (
    finding.validation_status === 'duplicate' ||
    finding.failure_reason === 'conflicting_repository'
  )).length;
  const hasBlockingRows = invalidRowCount > 0 || duplicateRowCount > 0;

  return {
    encoding: 'utf-8',
    header_columns: headerColumns,
    required_columns: [...REQUIRED_COLUMNS],
    unsupported_columns: unsupportedColumns,
    row_count: rows.length - 1,
    valid_row_count: rowFindings.filter((finding) => finding.validation_status === 'valid').length,
    invalid_row_count: invalidRowCount,
    duplicate_row_count: duplicateRowCount,
    schema_status: schemaErrors.length === 0 && !hasBlockingRows ? 'valid' : 'invalid',
    schema_errors: schemaErrors,
    raw_input: rawInput,
    normalizedRepositories,
    duplicateRepositories,
    conflictingRepositories,
    invalidRepositories,
    requestedRepositoryDetail,
    csv_row_findings: rowFindings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
  };
}

module.exports = {
  CSV_ROW_NUMBERING_CONVENTION,
  REQUIRED_COLUMNS,
  createEmptyBulkCsvNormalization,
  normalizeBulkCsvRequestedRepositories,
  parseCsvRows,
};