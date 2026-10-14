import { entriesInPeriod } from '../../../server/utils/ledger/store.js';
import { buildReport, reportRows } from '../../../server/utils/ledger/report.js';
import { periodFromQuery } from '../../../server/utils/ledger/period.js';
import { reportColumns } from '../../../server/utils/ledger/exports.js';
import { toCsv } from '../../../server/utils/ledger/csv.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The report as CSV, from the same report object the screen shows, so the two cannot disagree.

  One file holds one currency's rows with that currency's decimal places. A site selling in two
  currencies gets one file per `currency` — adding them together is meaningless, and formatting
  yen with cents would be wrong.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:reports');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [periodError, period] = periodFromQuery(request.query);
  if(periodError) return response.status(periodError.code).json({ error: periodError.msg });

  const [error, entries] = await entriesInPeriod(period);
  if(error) return response.status(error.code).json({ error: error.msg });

  const report = buildReport(entries, period);
  const currencies = Object.keys(report.currencies);
  const currency = String(request.query?.currency || currencies[0] || 'usd').toLowerCase();

  const rows = reportRows({ ...report, currencies: report.currencies[currency] ? { [currency]: report.currencies[currency] } : {} });

  response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="tax-report-${currency}.csv"`,
  });
  response.end(toCsv(reportColumns(currency), rows));
};
