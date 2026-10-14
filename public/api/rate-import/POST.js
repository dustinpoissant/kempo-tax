import { createMany } from '../../../server/utils/rates/store.js';
import { presentRate } from '../../../server/utils/rates/validate.js';
import { rowsFromCsv } from '../../../server/utils/rates/csv.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Add rates from CSV text: `{ csv }`. All or nothing — every row is validated before any is
  written, and the response names the row that was refused. It only ever *adds*; it never replaces
  or removes what is there, so a bad file cannot make a rate table worse than it was.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:rates');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const csv = typeof request.body === 'string' ? request.body : request.body?.csv;
  if(typeof csv !== 'string' || !csv.trim()) return response.status(400).json({ error: 'A csv is required' });

  const [parseError, rows] = rowsFromCsv(csv);
  if(parseError) return response.status(parseError.code).json({ error: parseError.msg });

  const [error, created] = await createMany(rows);
  if(error) return response.status(error.code).json({ error: error.msg });

  response.status(201).json({ added: created.length, rates: created.map(presentRate) });
};
