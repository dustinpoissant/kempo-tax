import { parseCsv } from '../ledger/csv.js';

/*
  The rate table's CSV: the columns, and turning a file into rows. The columns are the same set the
  export writes and the import reads, in that order.
*/

export const RATE_COLUMNS = [
  { key: 'country' },
  { key: 'state' },
  { key: 'locality' },
  { key: 'postalPattern' },
  { key: 'taxClass' },
  { key: 'level' },
  { key: 'kind' },
  { key: 'rate' },
  { key: 'appliesToShipping' },
  { key: 'taxType' },
  { key: 'jurisdiction' },
  { key: 'label' },
  { key: 'priority' },
  { key: 'enabled' },
  { key: 'effectiveFrom' },
  { key: 'effectiveTo' },
  { key: 'note' },
];

const REQUIRED = ['country', 'rate'];

const MAX_ROWS = 5000;

/*
  Headers are matched by name, so columns can be reordered or left out; unknown columns are an
  error rather than ignored, because a misspelt "efectiveFrom" silently dropped is a rate that
  applies from the beginning of time.
*/
export const rowsFromCsv = text => {
  const [error, rows] = parseCsv(text);
  if(error) return [error, null];
  if(!rows.length) return [{ code: 400, msg: 'The CSV has no rows' }, null];
  if(rows.length > MAX_ROWS) return [{ code: 413, msg: `A CSV import takes at most ${MAX_ROWS} rows` }, null];

  const known = new Set(RATE_COLUMNS.map(column => column.key));
  const headers = Object.keys(rows[0]);

  const unknown = headers.find(header => !known.has(header));
  if(unknown) return [{ code: 400, msg: `Unknown column "${unknown}". Columns are: ${[...known].join(', ')}` }, null];

  const missing = REQUIRED.find(name => !headers.includes(name));
  if(missing) return [{ code: 400, msg: `The CSV needs a "${missing}" column` }, null];

  return [null, rows];
};
