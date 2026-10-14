/*
  The numbers a return asks for, built from ledger entries. Pure.

  A report is a **record, not a filing**: it says what this site recorded, and the person filing is
  still responsible for the return. What it is careful about is being reproducible and agreeing with
  its own CSV export, because those two disagreeing is the one thing a tax report must never do.

  Reversals are counted in the period they *occurred* in, not the period of the sale they reverse —
  a refund in April of a March sale reduces April's figures. That is how most returns treat it, and
  the report states so; it is not something to pick up from the data silently.

  Figures are grouped by currency first, because adding 100 JPY to 100 GBP produces 200 of nothing.
*/

const empty = () => ({
  sales: 0,
  taxable: 0,
  exempt: 0,
  uncollected: 0,
  taxCollected: 0,
  taxReversed: 0,
  taxNet: 0,
  salesCount: 0,
  reversalsCount: 0,
});

const monthOf = date => new Date(date).toISOString().slice(0, 7);

export const inPeriod = (entry, from, to) => {
  const at = new Date(entry.occurredAt).getTime();
  return (!from || at >= new Date(from).getTime()) && (!to || at < new Date(to).getTime());
};

export const buildReport = (entries, { from = null, to = null } = {}) => {
  const currencies = {};

  for(const entry of entries){
    if(!inPeriod(entry, from, to)) continue;

    const bucket = currencies[entry.currency] ||= { totals: empty(), jurisdictions: new Map(), months: new Map() };
    const isSale = entry.kind === 'sale';

    const apply = target => {
      target.sales += entry.salesAmount;
      target.taxable += entry.taxableAmount;
      target.exempt += entry.exemptAmount;
      target.uncollected += entry.uncollectedAmount;
      target.taxNet += entry.taxAmount;
      if(isSale){
        target.taxCollected += entry.taxAmount;
        target.salesCount += 1;
      } else {
        // Stored negative; shown as a positive amount reversed.
        target.taxReversed += -entry.taxAmount;
        target.reversalsCount += 1;
      }
    };

    apply(bucket.totals);

    const month = monthOf(entry.occurredAt);
    if(!bucket.months.has(month)) bucket.months.set(month, empty());
    apply(bucket.months.get(month));

    for(const part of entry.jurisdictions || []){
      const key = [part.country, part.state, part.level, part.jurisdiction, part.rate].join('|');
      if(!bucket.jurisdictions.has(key)){
        bucket.jurisdictions.set(key, {
          country: part.country,
          state: part.state,
          level: part.level,
          jurisdiction: part.jurisdiction,
          rate: part.rate,
          taxableAmount: 0,
          taxAmount: 0,
        });
      }
      const row = bucket.jurisdictions.get(key);
      row.taxableAmount += part.taxableAmount;
      row.taxAmount += part.amount;
    }
  }

  const sortKey = row => `${row.country || ''}|${row.state || ''}|${row.level || ''}|${row.jurisdiction || ''}`;

  return {
    from,
    to,
    currencies: Object.fromEntries(Object.entries(currencies).map(([currency, bucket]) => [currency, {
      totals: bucket.totals,
      jurisdictions: [...bucket.jurisdictions.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      months: [...bucket.months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, totals]) => ({ month, ...totals })),
    }])),
  };
};

/*
  Calendar quarters in UTC. A site that files on a fiscal calendar picks a custom range instead,
  which the report accepts as-is.
*/
export const quarterRange = (year, quarter) => {
  const startMonth = (quarter - 1) * 3;
  return {
    from: new Date(Date.UTC(year, startMonth, 1)).toISOString(),
    to: new Date(Date.UTC(year, startMonth + 3, 1)).toISOString(),
  };
};

/*
  The flat rows of the CSV export: one per (currency, jurisdiction), plus a totals row per currency.
  Built from the same report object as the screen, so the two cannot disagree.
*/
export const reportRows = report => {
  const rows = [];

  for(const [currency, data] of Object.entries(report.currencies)){
    for(const entry of data.jurisdictions){
      rows.push({
        currency,
        row: 'jurisdiction',
        country: entry.country,
        state: entry.state,
        level: entry.level,
        jurisdiction: entry.jurisdiction,
        rate: entry.rate,
        taxableAmount: entry.taxableAmount,
        taxAmount: entry.taxAmount,
        sales: '',
        exempt: '',
        uncollected: '',
        taxCollected: '',
        taxReversed: '',
      });
    }

    rows.push({
      currency,
      row: 'total',
      country: '',
      state: '',
      level: '',
      jurisdiction: 'All jurisdictions',
      rate: '',
      taxableAmount: data.totals.taxable,
      taxAmount: data.totals.taxNet,
      sales: data.totals.sales,
      exempt: data.totals.exempt,
      uncollected: data.totals.uncollected,
      taxCollected: data.totals.taxCollected,
      taxReversed: data.totals.taxReversed,
    });
  }

  return rows;
};
