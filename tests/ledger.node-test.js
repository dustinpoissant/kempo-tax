import { entryFromResult, reversalFromEntry } from '../server/utils/ledger/entries.js';
import { buildReport, quarterRange, reportRows } from '../server/utils/ledger/report.js';
import { periodFromQuery } from '../server/utils/ledger/period.js';
import { toCsv, parseCsv, cell } from '../server/utils/ledger/csv.js';
import { formatMinor } from '../server/utils/ledger/money.js';
import { cleanRate } from '../server/utils/rates/validate.js';
import { rowsFromCsv, RATE_COLUMNS } from '../server/utils/rates/csv.js';
import { quickstartRows } from '../server/utils/rates/quickstart.js';

/*
  The ledger's arithmetic, the report, CSV and the rate validation — all pure.
*/

const result = overrides => ({
  provider: 'rates',
  currency: 'usd',
  livemode: true,
  tax: 600,
  lines: [
    { reference: 'a', amount: 10000, netAmount: 10000, tax: 600, status: 'taxed' },
    { reference: 'b', amount: 2000, netAmount: 2000, tax: 0, status: 'exempt' },
  ],
  shipping: { reference: '__shipping__', amount: 500, netAmount: 500, tax: 0, status: 'not_collecting' },
  breakdown: [
    { jurisdiction: 'Vermont', level: 'state', country: 'US', state: 'VT', name: 'Sales tax', rate: '6', taxableAmount: 10000, amount: 600, reason: 'standard_rated' },
  ],
  ...overrides,
});

const sale = (overrides = {}) => ({
  id: 1,
  ...entryFromResult(result(), { address: { country: 'us', state: 'vt', postal_code: '05401' }, reference: 'order-1', occurredAt: new Date('2026-04-10T12:00:00Z') }),
  ...overrides,
});

export default {
  'a sale entry splits sales three ways and keeps the breakdown': async ({ pass, fail }) => {
    const entry = sale();
    if(entry.salesAmount !== 12500) return fail(`sales ${entry.salesAmount}`);
    if(entry.taxableAmount !== 10000 || entry.exemptAmount !== 2000 || entry.uncollectedAmount !== 500) return fail('three-way split wrong');
    if(entry.taxAmount !== 600) return fail('tax wrong');
    if(entry.country !== 'US' || entry.state !== 'VT') return fail('place should be upper-cased');
    if(entry.jurisdictions.length !== 1 || entry.jurisdictions[0].rate !== '6') return fail('breakdown lost');
    pass('');
  },

  'not_collecting entries are not carried into the jurisdictions': async ({ pass, fail }) => {
    const entry = entryFromResult(result({
      tax: 0,
      breakdown: [{ jurisdiction: 'Texas', level: 'state', reason: 'not_collecting', amount: 0, taxableAmount: 0 }],
      lines: [{ reference: 'a', amount: 100, netAmount: 100, tax: 0, status: 'not_collecting' }],
      shipping: null,
    }), { reference: 'x', occurredAt: new Date() });
    if(entry.jurisdictions.length !== 0) return fail('a place we do not collect in must not appear on a return');
    if(entry.uncollectedAmount !== 100) return fail('uncollected amount missing');
    pass('');
  },

  'a whole reversal is the exact negative': async ({ pass, fail }) => {
    const original = sale();
    const reversal = reversalFromEntry(original, { reference: 'refund-1', occurredAt: new Date('2026-05-01T00:00:00Z') });
    for(const field of ['salesAmount', 'taxableAmount', 'exemptAmount', 'uncollectedAmount', 'taxAmount']){
      if(reversal[field] !== -original[field]) return fail(`${field}: ${reversal[field]} vs ${-original[field]}`);
    }
    if(reversal.jurisdictions[0].amount !== -600) return fail('jurisdiction amount not negated');
    if(reversal.originalEntryId !== 1) return fail('should point at the sale');
    pass('');
  },

  'a partial reversal always satisfies sales + tax = -amount': async ({ pass, fail }) => {
    const original = sale();
    const total = original.salesAmount + original.taxAmount;
    for(const amount of [1, 7, 333, 1000, 4999, total - 1, total]){
      const reversal = reversalFromEntry(original, { amount, reference: `r-${amount}`, occurredAt: new Date() });
      if(reversal.salesAmount + reversal.taxAmount !== -amount) return fail(`amount ${amount}: parts add to ${-(reversal.salesAmount + reversal.taxAmount)}`);
      const split = reversal.taxableAmount + reversal.exemptAmount + reversal.uncollectedAmount;
      if(split !== reversal.salesAmount) return fail(`amount ${amount}: three-way split ${split} vs ${reversal.salesAmount}`);
      const layers = reversal.jurisdictions.reduce((sum, part) => sum + part.amount, 0);
      if(layers !== reversal.taxAmount) return fail(`amount ${amount}: layers ${layers} vs tax ${reversal.taxAmount}`);
    }
    pass('so what is left to reverse is plain subtraction');
  },

  'a report totals sales and reversals, by currency, in the period they occurred': async ({ pass, fail }) => {
    const march = sale({ id: 1, reference: 'o1', occurredAt: new Date('2026-03-20T10:00:00Z') });
    const april = sale({ id: 2, reference: 'o2', occurredAt: new Date('2026-04-02T10:00:00Z') });
    const refundOfMarch = {
      ...reversalFromEntry(march, { amount: 1060, reference: 'ref', occurredAt: new Date('2026-04-15T10:00:00Z') }),
      id: 3,
    };
    const yen = sale({ id: 4, reference: 'jp', currency: 'jpy', occurredAt: new Date('2026-04-03T10:00:00Z') });

    const q2 = buildReport([march, april, refundOfMarch, yen], quarterRange(2026, 2));
    const usd = q2.currencies.usd;
    if(usd.totals.salesCount !== 1) return fail(`Q2 sales: ${usd.totals.salesCount}`);
    if(usd.totals.reversalsCount !== 1) return fail('the April refund belongs to Q2');
    if(usd.totals.taxCollected !== 600) return fail(`collected ${usd.totals.taxCollected}`);
    if(usd.totals.taxReversed !== 49) return fail(`reversed ${usd.totals.taxReversed}`);
    if(usd.totals.taxNet !== 551) return fail(`net ${usd.totals.taxNet}`);
    if(!q2.currencies.jpy) return fail('a second currency should have its own bucket');
    if(q2.currencies.usd.totals.sales === q2.currencies.jpy.totals.sales + q2.currencies.usd.totals.sales) return fail('currencies must not be added together');

    const q1 = buildReport([march, april, refundOfMarch, yen], quarterRange(2026, 1));
    if(q1.currencies.usd.totals.salesCount !== 1 || q1.currencies.usd.totals.reversalsCount !== 0) return fail('Q1 should hold the March sale and not the April refund');
    pass('a refund in April of a March sale reduces April');
  },

  'the jurisdiction rows add up to the totals': async ({ pass, fail }) => {
    const entries = [1, 2, 3].map(index => sale({ id: index, reference: `o${index}`, occurredAt: new Date('2026-05-01T00:00:00Z') }));
    const report = buildReport(entries, {});
    const data = report.currencies.usd;
    const fromRows = data.jurisdictions.reduce((sum, row) => sum + row.taxAmount, 0);
    if(fromRows !== data.totals.taxNet) return fail(`rows ${fromRows} vs totals ${data.totals.taxNet}`);

    const csv = reportRows(report);
    const total = csv.find(row => row.row === 'total');
    if(total.taxAmount !== data.totals.taxNet) return fail('the export total should equal the screen total');
    pass('');
  },

  'quarters are calendar quarters in UTC with an exclusive end': async ({ pass, fail }) => {
    const q = quarterRange(2026, 4);
    if(q.from !== '2026-10-01T00:00:00.000Z' || q.to !== '2027-01-01T00:00:00.000Z') return fail(`Q4 was ${q.from} to ${q.to}`);

    const edge = sale({ occurredAt: new Date('2027-01-01T00:00:00.000Z') });
    if(buildReport([edge], q).currencies.usd) return fail('midnight at the end belongs to the next period');
    pass('');
  },

  'period parsing is strict': async ({ pass, fail }) => {
    for(const bad of [{ quarter: '2026-Q5' }, { from: '2026-13-01' }, { from: 'yesterday' }, { from: '2026-04-01', to: '2026-03-01' }, { quarter: 'Q2' }]){
      const [error] = periodFromQuery(bad);
      if(!error) return fail(`${JSON.stringify(bad)} should be refused`);
    }
    const [, ok] = periodFromQuery({ from: '2026-03-01', to: '2026-04-01' });
    if(ok.to !== '2026-04-01T00:00:00.000Z') return fail('to should parse as given');
    const [, q] = periodFromQuery({ quarter: '2026-Q3' });
    if(q.from !== '2026-07-01T00:00:00.000Z') return fail('quarter shortcut wrong');
    pass('');
  },

  'csv quotes what needs quoting, and neutralises spreadsheet formulas': async ({ pass, fail }) => {
    if(cell('a,b') !== '"a,b"') return fail('comma not quoted');
    if(cell('say "hi"') !== '"say ""hi"""') return fail('quote not doubled');
    if(cell('=HYPERLINK("x")').startsWith('=')) return fail('a leading = would run as a formula');
    if(cell('+1 555').startsWith('+')) return fail('a leading + would run as a formula');
    if(cell('-12.50') !== '-12.50') return fail('a negative number must stay a number');
    if(cell(-5) !== '-5') return fail('a numeric -5 should be untouched');
    pass('');
  },

  'csv round-trips including commas, quotes and newlines in cells': async ({ pass, fail }) => {
    const columns = [{ key: 'a' }, { key: 'b' }];
    const rows = [{ a: 'x,y', b: 'say "hi"' }, { a: 'line\nbreak', b: '' }];
    const [error, parsed] = parseCsv(toCsv(columns, rows));
    if(error) return fail(error.msg);
    if(parsed.length !== 2 || parsed[0].a !== 'x,y' || parsed[0].b !== 'say "hi"' || parsed[1].a !== 'line\nbreak') return fail(JSON.stringify(parsed));
    if(!parseCsv('a,b\n"unterminated')[0]) return fail('an unterminated quote should be an error');
    pass('');
  },

  'minor units format with the currency\'s own decimals': async ({ pass, fail }) => {
    if(formatMinor(1234, 'usd') !== '12.34') return fail('usd');
    if(formatMinor(5, 'usd') !== '0.05') return fail('small usd');
    if(formatMinor(-1234, 'usd') !== '-12.34') return fail('negative');
    if(formatMinor(1234, 'jpy') !== '1234') return fail('yen has no decimals');
    if(formatMinor(1234, 'kwd') !== '1.234') return fail('dinar has three');
    pass('');
  },

  'a rate row is validated and nothing is silently repaired': async ({ pass, fail }) => {
    const [, ok] = cleanRate({ country: 'us', state: 'vt', taxClass: 'Physical', rate: '6' });
    if(ok.country !== 'US' || ok.state !== 'VT' || ok.taxClass !== 'physical' || ok.rateMicro !== 60000) return fail(JSON.stringify(ok));
    if(ok.level !== 'state') return fail('level should be inferred');

    const bad = [
      { country: 'USA', rate: '6' },
      { country: 'US', rate: 'six' },
      { country: 'US', rate: '150' },
      { country: 'US', rate: '6', taxClass: 'phsyical' },
      { country: 'US', rate: '6', effectiveFrom: '2026-02-30' },
      { country: 'US', rate: '6', effectiveFrom: '2026-06-01', effectiveTo: '2026-05-01' },
      { country: 'US', rate: '6', kind: 'maybe' },
      { country: 'US', rate: '6', priority: 5000 },
    ];
    for(const input of bad){
      if(!cleanRate(input)[0]) return fail(`${JSON.stringify(input)} should be refused`);
    }
    pass('');
  },

  'an exempt row needs no rate': async ({ pass, fail }) => {
    const [error, row] = cleanRate({ country: 'US', state: 'VT', taxClass: 'nontaxable', kind: 'exempt' });
    if(error) return fail(error.msg);
    if(row.rateMicro !== 0) return fail('exempt should be 0');
    pass('');
  },

  'a rate CSV refuses unknown columns and missing required ones': async ({ pass, fail }) => {
    if(!rowsFromCsv('country,rate,efectiveFrom\nUS,6,2026-01-01')[0]) return fail('a misspelt column must be an error, not ignored');
    if(!rowsFromCsv('state,rate\nVT,6')[0]) return fail('country is required');
    if(!rowsFromCsv('')[0]) return fail('empty should be refused');
    const [error, rows] = rowsFromCsv(`${RATE_COLUMNS.map(column => column.key).join(',')}\nUS,VT,,,physical,state,taxable,6,false,sales_tax,Vermont,,0,true,,,`);
    if(error) return fail(error.msg);
    if(rows.length !== 1 || rows[0].country !== 'US') return fail('good row not read');
    pass('');
  },

  'quick start produces visible rows and refuses to guess a rate': async ({ pass, fail }) => {
    if(!quickstartRows({ country: 'US', state: 'VT', taxableClasses: ['physical'] })[0]) return fail('a missing rate must be refused');
    if(!quickstartRows({ country: 'US', state: 'VT', stateRate: '6', taxableClasses: ['physical'], exemptClasses: ['physical'] })[0]) return fail('taxable and exempt together should be refused');

    const [error, rows] = quickstartRows({
      country: 'US',
      state: 'VT',
      stateRate: '6',
      taxableClasses: ['physical', 'digital'],
      exemptClasses: ['nontaxable'],
      shippingTaxable: true,
      localRates: [{ locality: 'Burlington', rate: '1' }],
    });
    if(error) return fail(error.msg);

    // 2 classes × (state + local) + 1 exempt + shipping (state + local)
    if(rows.length !== 7) return fail(`expected 7 rows, got ${rows.length}`);
    if(!rows.some(row => row.kind === 'exempt' && row.taxClass === 'nontaxable')) return fail('exempt class row missing');
    if(!rows.some(row => row.taxClass === 'shipping' && row.appliesToShipping)) return fail('shipping row missing');
    if(!rows.every(row => row.note.startsWith('Created by the quick start'))) return fail('rows should say where they came from');
    pass('');
  },
};
