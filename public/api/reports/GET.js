import { entriesInPeriod } from '../../../server/utils/ledger/store.js';
import { buildReport } from '../../../server/utils/ledger/report.js';
import { periodFromQuery } from '../../../server/utils/ledger/period.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Totals for a period, by currency and by jurisdiction, built from the ledger.

  A record, not a filing — the response says so, so a client rendering it cannot present it as
  anything else. Reversals are counted in the period they occurred.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:reports');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [periodError, period] = periodFromQuery(request.query);
  if(periodError) return response.status(periodError.code).json({ error: periodError.msg });

  const [error, entries] = await entriesInPeriod(period);
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({
    ...buildReport(entries, period),
    notice: 'This is a record of what this site collected, not a tax return. Reversals are counted in the period they happened in.',
  });
};
