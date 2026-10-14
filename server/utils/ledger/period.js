import { quarterRange } from './report.js';

/*
  A report's period from a request's query: either `quarter=2026-Q3`, or `from` and/or `to` as
  dates. `to` is exclusive, as everywhere else, so "the month of March" is
  `from=2026-03-01&to=2026-04-01` and cannot lose the last day or double-count the first.

  Parsing is strict. A report over a period the caller did not mean is a return filed on the wrong
  numbers, so an unreadable value is refused, not defaulted to "everything".
*/

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;

const asDate = value => {
  if(!DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date.toISOString();
};

export const periodFromQuery = (query = {}) => {
  if(query.quarter){
    const match = QUARTER.exec(String(query.quarter));
    if(!match) return [{ code: 400, msg: 'quarter must look like 2026-Q3' }, null];
    return [null, quarterRange(Number(match[1]), Number(match[2]))];
  }

  const from = query.from ? asDate(String(query.from)) : null;
  const to = query.to ? asDate(String(query.to)) : null;

  if(query.from && !from) return [{ code: 400, msg: 'from must be a date, YYYY-MM-DD' }, null];
  if(query.to && !to) return [{ code: 400, msg: 'to must be a date, YYYY-MM-DD' }, null];
  if(from && to && to <= from) return [{ code: 400, msg: 'to must be after from' }, null];

  return [null, { from, to }];
};
