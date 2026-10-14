import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import db from 'kempo/server/db/index.js';
import { setSetting } from 'kempo/server/sdk.js';
import { kempoTaxEntry, kempoTaxQuote, kempoTaxRate } from '../server/db/schema.js';
import calculateTax from '../server/utils/tax/calculate.js';
import { recordTransaction, reverseTransaction } from '../server/utils/tax/transactions.js';
import { createMany } from '../server/utils/rates/store.js';
import { quickstartRows } from '../server/utils/rates/quickstart.js';
import { entriesInPeriod, insertEntry, getEntryByReference } from '../server/utils/ledger/store.js';
import { buildReport } from '../server/utils/ledger/report.js';
import { getQuote } from '../server/utils/ledger/quotes.js';
import { databaseReachable, skipReason } from './testDatabase.js';

/*
  The whole path against a real (in-memory) database: rate table → quote → record → reverse →
  report. Everything above this in the stack is pure and tested without one; this proves the
  parts are wired together and that the database enforces what the code relies on.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const reset = async () => {
  await db.execute(sql`delete from "kempoTaxEntry"`);
  await db.execute(sql`delete from "kempoTaxQuote"`);
  await db.execute(sql`delete from "kempoTaxRate"`);
};

const configure = async values => {
  for(const [name, value] of Object.entries(values)){
    await setSetting('kempo-tax', name, value, typeof value === 'boolean' ? 'boolean' : 'string', false, null);
  }
};

const seedVermont = async () => {
  const [, rows] = quickstartRows({
    country: 'US',
    state: 'VT',
    stateRate: '6',
    taxableClasses: ['physical'],
    exemptClasses: ['nontaxable'],
    shippingTaxable: false,
    localRates: [{ locality: 'Burlington', rate: '1' }],
  });
  const [error] = await createMany(rows);
  if(error) throw new Error(error.msg);
};

const order = (overrides = {}) => ({
  address: { country: 'US', state: 'VT', postalCode: '05401', city: 'Burlington' },
  lines: [
    { amount: 10000, reference: 'car', taxClass: 'physical' },
    { amount: 2000, reference: 'gift', taxClass: 'nontaxable' },
  ],
  ...overrides,
});

const suite = {
  'the schema and install.js create the same indexes': async ({ pass, fail }) => {
    const install = await readFile(path.join(root, 'install.js'), 'utf8');
    for(const table of [kempoTaxRate, kempoTaxQuote, kempoTaxEntry]){
      for(const index of getTableConfig(table).indexes){
        const name = index.config.name;
        if(!install.includes(`"${name}"`)) return fail(`schema declares ${name} but install.js never creates it`);
      }
    }
    pass('an index missing from install.js exists only in development');
  },
};

if(!databaseReachable){
  suite['database suites'] = async ({ pass }) => pass(`skipped: ${skipReason}`);
} else {
  Object.assign(suite, {
    'calculate, record, reverse and report through the rate table': async ({ pass, fail }) => {
      await reset();
      await configure({ provider: 'rates', home_country: 'US', home_state: 'VT', rounding: 'line' });
      await seedVermont();

      const [error, quote] = await calculateTax(order());
      if(error) return fail(error.msg);

      // 6% + 1% Burlington on 10000 = 700; the exempt line carries none.
      if(quote.tax !== 700) return fail(`tax ${quote.tax}`);
      if(quote.total !== 12700) return fail(`total ${quote.total}`);
      if(!quote.collecting) return fail('should be collecting');
      if(!/^taxq_[0-9a-f]{24}$/.test(quote.calculationId)) return fail(`calculationId ${quote.calculationId}`);
      if(quote.lines[1].status !== 'exempt') return fail('the nontaxable line should be exempt');

      const [recordError, sale] = await recordTransaction({ calculationId: quote.calculationId, reference: 'order-1' });
      if(recordError) return fail(recordError.msg);
      if(!sale.created || sale.taxAmount !== 700 || sale.taxableAmount !== 10000 || sale.exemptAmount !== 2000) return fail(`sale ${JSON.stringify(sale)}`);

      // Recording again is a no-op that returns the same entry.
      const [, again] = await recordTransaction({ calculationId: quote.calculationId, reference: 'order-1' });
      if(again.created || again.entryId !== sale.entryId) return fail('recording twice must return the first entry');

      // The same calculation under a different reference is refused.
      const [dupError] = await recordTransaction({ calculationId: quote.calculationId, reference: 'order-1-copy' });
      if(!dupError || dupError.code !== 409) return fail('one calculation records one sale');

      // A partial refund, then the remainder, then too much.
      const [, partial] = await reverseTransaction({ transactionId: sale.transactionId, reference: 'refund-a', amount: 5000 });
      if(partial.salesAmount + partial.taxAmount !== -5000) return fail(`partial ${JSON.stringify(partial)}`);

      const [, again2] = await reverseTransaction({ transactionId: sale.transactionId, reference: 'refund-a', amount: 5000 });
      if(again2.created) return fail('the same refund reference must not be recorded twice');

      const [tooMuch] = await reverseTransaction({ transactionId: sale.transactionId, reference: 'refund-big', amount: 99999 });
      if(!tooMuch) return fail('reversing more than is left should be refused');

      const [, rest] = await reverseTransaction({ transactionId: sale.transactionId, reference: 'refund-rest' });
      const reversedTotal = -(partial.salesAmount + partial.taxAmount) - (rest.salesAmount + rest.taxAmount);
      if(reversedTotal !== 12700) return fail(`everything reversed should be 12700, got ${reversedTotal}`);

      const [nothingLeft] = await reverseTransaction({ transactionId: sale.transactionId, reference: 'refund-again' });
      if(!nothingLeft || nothingLeft.code !== 409) return fail('a fully reversed sale cannot be reversed again');

      const [, entries] = await entriesInPeriod({});
      const report = buildReport(entries, {});
      const totals = report.currencies.usd.totals;
      if(totals.taxNet !== 0) return fail(`net tax after a full refund should be 0, got ${totals.taxNet}`);
      if(totals.taxCollected !== 700 || totals.taxReversed !== 700) return fail(`collected/reversed ${totals.taxCollected}/${totals.taxReversed}`);
      if(totals.sales !== 0) return fail(`net sales should be 0, got ${totals.sales}`);
      pass('');
    },

    'a place with no rate is quoted as not collecting and recorded as uncollected': async ({ pass, fail }) => {
      await reset();
      await configure({ provider: 'rates', home_country: 'US', home_state: 'VT' });
      await seedVermont();

      const [error, quote] = await calculateTax(order({ address: { country: 'US', state: 'TX', postalCode: '78701' } }));
      if(error) return fail(error.msg);
      if(quote.collecting || quote.tax !== 0) return fail('Texas has no rate here');

      const [, sale] = await recordTransaction({ calculationId: quote.calculationId, reference: 'tx-order' });
      if(sale.uncollectedAmount !== 12000 || sale.taxAmount !== 0) return fail(`sale ${JSON.stringify(sale)}`);

      const report = buildReport((await entriesInPeriod({}))[1], {});
      if(report.currencies.usd.jurisdictions.length !== 0) return fail('an uncollected sale must not appear on a return');
      pass('');
    },

    'a free cart is answered without a quote, and cannot be recorded': async ({ pass, fail }) => {
      await reset();
      await configure({ provider: 'rates' });
      await seedVermont();

      const [error, quote] = await calculateTax(order({ lines: [{ amount: 0, reference: 'free', taxClass: 'physical' }] }));
      if(error) return fail(error.msg);
      if(quote.calculationId !== null || quote.tax !== 0) return fail('nothing to quote');

      const [recordError] = await recordTransaction({ calculationId: String(quote.calculationId), reference: 'free-1' });
      if(!recordError) return fail('there is nothing to record');
      pass('');
    },

    'the ledger refuses a duplicate reference at the database, not only in code': async ({ pass, fail }) => {
      await reset();
      const base = {
        kind: 'sale', reference: 'dup', provider: 'rates', currency: 'usd', livemode: true,
        jurisdictions: [], occurredAt: new Date(),
      };
      const [firstError, first] = await insertEntry(base);
      if(firstError) return fail(firstError.msg);
      const [secondError, second] = await insertEntry(base);
      if(secondError) return fail(secondError.msg);
      if(second.created || second.entry.id !== first.entry.id) return fail('the second insert should return the first row');

      const [, found] = await getEntryByReference('sale', 'dup');
      if(found.id !== first.entry.id) return fail('lookup by reference');
      pass('');
    },

    'an unknown or expired calculation is refused': async ({ pass, fail }) => {
      await reset();
      const [unknown] = await getQuote('taxq_doesnotexist');
      if(!unknown || unknown.code !== 404) return fail('unknown quote should be a 404');

      await db.execute(sql`insert into "kempoTaxQuote" ("id", "provider", "currency", "result", "createdAt", "expiresAt")
        values ('taxq_old', 'rates', 'usd', '{}'::jsonb, now() - interval '100 days', now() - interval '10 days')`);
      const [expired] = await getQuote('taxq_old');
      if(!expired || expired.code !== 410) return fail('an expired quote should be a 410');
      pass('');
    },

    'rates are stored and returned exactly, with no float drift': async ({ pass, fail }) => {
      await reset();
      const [error] = await createMany([{ country: 'US', state: 'NJ', taxClass: 'physical', rate: '6.625' }]);
      if(error) return fail(error.msg);

      await configure({ provider: 'rates' });
      const [calcError, quote] = await calculateTax({ address: { country: 'US', state: 'NJ', postalCode: '07001' }, lines: [{ amount: 9999999999, reference: 'big', taxClass: 'physical' }] });
      if(calcError) return fail(calcError.msg);
      if(quote.tax !== 662500000) return fail(`tax ${quote.tax}`);
      pass('');
    },

    'an import with one bad row writes nothing': async ({ pass, fail }) => {
      await reset();
      const [error] = await createMany([
        { country: 'US', state: 'VT', taxClass: 'physical', rate: '6' },
        { country: 'US', state: 'NH', taxClass: 'physical', rate: 'oops' },
      ]);
      if(!error) return fail('should be refused');
      if(!/Row 2/.test(error.msg)) return fail(`message should name the row: ${error.msg}`);

      const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(kempoTaxRate);
      if(count !== 0) return fail(`${count} rows were written`);
      pass('');
    },
  });
}

export default suite;
