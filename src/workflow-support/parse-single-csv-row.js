'use strict';

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function unwrapCodeFence(rawInput) {
  const text = String(rawInput == null ? '' : rawInput);
  const fenceMatch = text.match(/^\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```\s*$/);
  return fenceMatch ? fenceMatch[1] : text;
}

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
  return { cells, unterminated_quote: inQuotes };
}

function parseSingleCsvRow(rawValue, columns = []) {
  const rawText = unwrapCodeFence(rawValue).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const provided = rawText.trim() !== '';
  const rows = [];
  const errors = [];
  let headerSkipped = false;
  const expectedFirstColumn = columns[0] ? String(columns[0]).toLowerCase() : '';

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parsedLine = splitCsvLine(line);
    if (parsedLine.unterminated_quote) {
      errors.push('Spreadsheet input contains an unterminated quoted value.');
      continue;
    }

    const cells = parsedLine.cells.map((cell) => cell.trim());

    if (!headerSkipped && cells.length < 2 && columns.length > 1 && (!cells[0] || cells[0].toLowerCase() !== expectedFirstColumn)) {
      continue;
    }

    if (!headerSkipped && cells[0] && expectedFirstColumn && cells[0].toLowerCase() === expectedFirstColumn) {
      headerSkipped = true;
      continue;
    }
    headerSkipped = true;

    if (cells.length > columns.length) {
      errors.push(`Spreadsheet row has ${cells.length} columns; expected ${columns.length}.`);
    }

    const row = {};
    columns.forEach((column, index) => {
      row[column] = cells[index] != null ? cells[index] : '';
    });
    rows.push(row);
  }

  if (provided && rows.length !== 1) {
    errors.push(`Spreadsheet input must contain exactly one data row; found ${rows.length}.`);
  }

  return {
    provided,
    row_count: rows.length,
    row: rows[0] || {},
    errors: [...new Set(errors)],
  };
}

module.exports = {
  normalizeText,
  parseSingleCsvRow,
  splitCsvLine,
  unwrapCodeFence,
};
