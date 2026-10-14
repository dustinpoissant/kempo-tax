/*
  CSV, both ways, with no dependency.

  Written out rather than imported because both directions matter for correctness here: an export
  that mishandles a comma in a jurisdiction name produces a return nobody can read, and an import
  that does is a rate table with a wrong row in it.
*/

const needsQuoting = /[",\r\n]/;

/*
  A cell that begins with =, +, - or @ is executed as a formula by spreadsheet programs. A
  jurisdiction or note typed by a user must not be able to do that to whoever opens the export.
*/
const FORMULA = /^[=+\-@\t\r]/;

export const cell = value => {
  let text = value === null || value === undefined ? '' : String(value);
  if(typeof value === 'string' && FORMULA.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return needsQuoting.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns, rows) => [
  columns.map(column => cell(column.label ?? column.key)).join(','),
  ...rows.map(row => columns.map(column => cell(typeof column.value === 'function' ? column.value(row) : row[column.key])).join(',')),
].join('\r\n') + '\r\n';

/*
  RFC 4180 parsing: quoted fields, doubled quotes, newlines inside quotes. Returns an array of
  objects keyed by the header row. A BOM is ignored; blank lines are skipped.
*/
export const parseCsv = input => {
  const text = String(input ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for(let i = 0; i < text.length; i++){
    const char = text[i];

    if(quoted){
      if(char === '"' && text[i + 1] === '"'){
        field += '"';
        i++;
      } else if(char === '"'){
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if(char === '"') quoted = true;
    else if(char === ',') { row.push(field); field = ''; }
    else if(char === '\n' || char === '\r'){
      if(char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if(row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if(row.some(value => value !== '')) rows.push(row);
  if(quoted) return [{ code: 400, msg: 'The CSV has an unterminated quote' }, null];
  if(!rows.length) return [null, []];

  const header = rows[0].map(name => name.trim());
  return [null, rows.slice(1).map(values => Object.fromEntries(header.map((name, index) => [name, (values[index] ?? '').trim()])))];
};
