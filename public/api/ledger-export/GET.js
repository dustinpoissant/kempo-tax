import { entriesInPeriod } from '../../../server/utils/ledger/store.js';
import { ledgerColumns } from '../../../server/utils/ledger/exports.js';
import { toCsv } from '../../../server/utils/ledger/csv.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The whole ledger, or a period of it, as CSV. This is the file to take before uninstalling the
  extension: the ledger is a legal record, and removing the extension drops the table it is in.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:reports');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const { from, to } = request.query || {};

  const [error, entries] = await entriesInPeriod({ from, to });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="tax-ledger.csv"',
  });
  response.end(toCsv(ledgerColumns, entries));
};
