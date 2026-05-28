'use strict';

const {
  isPlausibleGitHubLogin,
  normalizeLogin,
  unwrapCodeFence,
} = require('./normalize-requested-people');

const REQUIRED_COLUMNS = ['cost_center', 'login'];
const OPTIONAL_COLUMNS = ['action'];
const SUPPORTED_ACTIONS = ['add', 'remove'];
const DEFAULT_ACTION = 'add';
const CSV_ROW_NUMBERING_CONVENTION = '1-based data-row numbers that exclude the header row';

function createEmptyCostCenterAssignmentNormalization(rawInput = '') {
  return {
    encoding: 'utf-8',
    header_columns: [],
    required_columns: [...REQUIRED_COLUMNS],
    optional_columns: [...OPTIONAL_COLUMNS],
    unsupported_columns: [],
    row_count: 0,
    valid_row_count: 0,
    invalid_row_count: 0,
    duplicate_row_count: 0,
    schema_status: 'not_provided',
    schema_errors: [],
    raw_input: rawInput,
    normalizedAssignments: [],
    duplicateAssignments: [],
    invalidAssignments: [],
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

function buildRowFinding(rowNumber, row, costCenter, login, action, validationStatus, failureReason) {
  return {
    row_number: rowNumber,
    original_row: row.join(','),
    cost_center: costCenter || null,
    login: login || null,
    action: action || null,
    validation_status: validationStatus,
    failure_reason: failureReason || null,
  };
}

function normalizeCostCenterAssignments(rawInput) {
  const empty = createEmptyCostCenterAssignmentNormalization(rawInput);
  if (!unwrapCodeFence(rawInput).trim()) {
    return empty;
  }

  const rows = parseCsvRows(rawInput);
  if (rows.length === 0) {
    return {
      ...empty,
      schema_status: 'invalid',
      schema_errors: ['Cost center CSV must contain a header row.'],
    };
  }

  const headerColumns = rows[0].map(normalizeHeaderValue);
  const costCenterColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'cost_center') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const loginColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'login') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const actionColumnIndexes = headerColumns.reduce((indexes, value, index) => {
    if (value === 'action') {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const supportedColumns = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
  const unsupportedColumns = headerColumns.filter(
    (value) => value && !supportedColumns.includes(value)
  );
  const schemaErrors = [];

  if (costCenterColumnIndexes.length === 0) {
    schemaErrors.push('Cost center CSV must include the required `cost_center` header.');
  } else if (costCenterColumnIndexes.length > 1) {
    schemaErrors.push('Cost center CSV must include the `cost_center` header exactly once.');
  }

  if (loginColumnIndexes.length === 0) {
    schemaErrors.push('Cost center CSV must include the required `login` header.');
  } else if (loginColumnIndexes.length > 1) {
    schemaErrors.push('Cost center CSV must include the `login` header exactly once.');
  }

  if (actionColumnIndexes.length > 1) {
    schemaErrors.push('Cost center CSV must include the `action` header exactly once.');
  }

  if (unsupportedColumns.length > 0) {
    schemaErrors.push(
      `Cost center CSV contains unsupported columns: ${unsupportedColumns.join(', ')}.`
    );
  }

  const costCenterColumnIndex = costCenterColumnIndexes[0] ?? -1;
  const loginColumnIndex = loginColumnIndexes[0] ?? -1;
  const actionColumnIndex = actionColumnIndexes[0] ?? -1;
  const seen = new Set();
  const normalizedAssignments = [];
  const duplicateAssignments = [];
  const invalidAssignments = [];
  const rowFindings = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 1;

    if (row.length === 1 && String(row[0] || '').trim() === '') {
      rowFindings.push(buildRowFinding(rowNumber, row, null, null, null, 'blank', 'blank_row'));
      return;
    }

    if (row.length !== headerColumns.length) {
      rowFindings.push(
        buildRowFinding(rowNumber, row, null, null, null, 'invalid', 'inconsistent_shape')
      );
      invalidAssignments.push({
        cost_center: null,
        login: null,
        action: null,
        source_row_number: rowNumber,
        failure_reason: 'inconsistent_shape',
      });
      return;
    }

    const rawCostCenter = costCenterColumnIndex >= 0 ? String(row[costCenterColumnIndex] || '') : '';
    const rawLogin = loginColumnIndex >= 0 ? String(row[loginColumnIndex] || '') : '';
    const rawAction = actionColumnIndex >= 0 ? String(row[actionColumnIndex] || '') : '';

    const costCenter = rawCostCenter.trim();
    const login = normalizeLogin(rawLogin);
    const actionProvided = rawAction.trim() !== '';
    const action = actionProvided ? rawAction.trim().toLowerCase() : DEFAULT_ACTION;

    if (!costCenter) {
      rowFindings.push(
        buildRowFinding(rowNumber, row, null, login || null, action, 'invalid', 'missing_cost_center')
      );
      invalidAssignments.push({
        cost_center: null,
        login: login || null,
        action,
        source_row_number: rowNumber,
        failure_reason: 'missing_cost_center',
      });
      return;
    }

    if (!rawLogin.trim()) {
      rowFindings.push(
        buildRowFinding(rowNumber, row, costCenter, null, action, 'invalid', 'missing_login')
      );
      invalidAssignments.push({
        cost_center: costCenter,
        login: null,
        action,
        source_row_number: rowNumber,
        failure_reason: 'missing_login',
      });
      return;
    }

    if (!isPlausibleGitHubLogin(login)) {
      rowFindings.push(
        buildRowFinding(rowNumber, row, costCenter, login, action, 'invalid', 'invalid_login')
      );
      invalidAssignments.push({
        cost_center: costCenter,
        login,
        action,
        source_row_number: rowNumber,
        failure_reason: 'invalid_login',
      });
      return;
    }

    if (actionProvided && !SUPPORTED_ACTIONS.includes(action)) {
      rowFindings.push(
        buildRowFinding(rowNumber, row, costCenter, login, action, 'invalid', 'invalid_action')
      );
      invalidAssignments.push({
        cost_center: costCenter,
        login,
        action,
        source_row_number: rowNumber,
        failure_reason: 'invalid_action',
      });
      return;
    }

    const dedupKey = `${costCenter.toLowerCase()}|${login}|${action}`;
    if (seen.has(dedupKey)) {
      rowFindings.push(
        buildRowFinding(rowNumber, row, costCenter, login, action, 'duplicate', 'duplicate_assignment')
      );
      duplicateAssignments.push({
        cost_center: costCenter,
        login,
        action,
        source_row_number: rowNumber,
      });
      return;
    }

    seen.add(dedupKey);
    normalizedAssignments.push({
      cost_center: costCenter,
      login,
      action,
      source_row_number: rowNumber,
    });
    rowFindings.push(buildRowFinding(rowNumber, row, costCenter, login, action, 'valid', null));
  });

  const invalidRowCount = rowFindings.filter(
    (finding) => finding.validation_status === 'invalid'
  ).length;

  return {
    encoding: 'utf-8',
    header_columns: headerColumns,
    required_columns: [...REQUIRED_COLUMNS],
    optional_columns: [...OPTIONAL_COLUMNS],
    unsupported_columns: unsupportedColumns,
    row_count: rows.length - 1,
    valid_row_count: rowFindings.filter((finding) => finding.validation_status === 'valid').length,
    invalid_row_count: invalidRowCount,
    duplicate_row_count: rowFindings.filter(
      (finding) => finding.validation_status === 'duplicate'
    ).length,
    schema_status: schemaErrors.length === 0 && invalidRowCount === 0 ? 'valid' : 'invalid',
    schema_errors: schemaErrors,
    raw_input: rawInput,
    normalizedAssignments,
    duplicateAssignments,
    invalidAssignments,
    csv_row_findings: rowFindings,
    csv_row_numbering_convention: CSV_ROW_NUMBERING_CONVENTION,
  };
}

module.exports = {
  CSV_ROW_NUMBERING_CONVENTION,
  OPTIONAL_COLUMNS,
  REQUIRED_COLUMNS,
  createEmptyCostCenterAssignmentNormalization,
  normalizeCostCenterAssignments,
};
