import { listRates } from '../../../server/utils/rates/store.js';
import { presentRate } from '../../../server/utils/rates/validate.js';
import { RATE_COLUMNS } from '../../../server/utils/rates/csv.js';
import { toCsv } from '../../../server/utils/ledger/csv.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The whole rate table as CSV, in the exact column order the import reads — so a table can be
  exported, edited in a spreadsheet and imported again.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:view');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, rows] = await listRates();
  if(error) return response.status(error.code).json({ error: error.msg });

  response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="tax-rates.csv"',
  });
  response.end(toCsv(RATE_COLUMNS, rows.map(presentRate)));
};
