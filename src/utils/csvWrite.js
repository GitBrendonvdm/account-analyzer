/**
 * Write rows back out as a CSV the app can re-import.
 *
 * The master file the watcher maintains has to be readable by `parseCsv`, so it keeps the export's
 * own column order and quoting style rather than inventing a format. Fields the app added — the
 * row key, the account id, the vintage — are appended after the original columns, where the parser
 * ignores them harmlessly but a human reading the file can still see why a row is there.
 */

const SOURCE_COLUMNS = [
  'Date',
  'Description',
  'Account',
  'Spending Group',
  'Category',
  'Pay Month',
  'Split Transaction',
  'Currency',
  'Amount',
  'Original Currency',
  'Original Amount',
  'Type',
  'Status',
  'Tags',
  'Notes',
];

/**
 * `key` has to be written out. It is how a row is recognised on the next merge, and without it
 * re-ingesting the master file re-added every row it already contained.
 */
const EXTRA_COLUMNS = ['key', 'observedThrough'];

function quote(value) {
  const s = value == null ? '' : String(value);
  // Everything is quoted, exactly as the bank export does — no decisions about when to escape.
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows, columns = [...SOURCE_COLUMNS, ...EXTRA_COLUMNS]) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((c) => quote(row[c])).join(','));
  return [header, ...body].join('\n') + '\n';
}

export { SOURCE_COLUMNS };
