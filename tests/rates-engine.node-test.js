import { calculateWithRates, postalMatches, layersFor } from '../server/utils/tax/rates.js';
import { parseRequest } from '../server/utils/tax/shape.js';
import { parsePercent } from '../server/utils/tax/percent.js';

/*
  The rate table engine with plain rows and no database. Every rule documented in
  server/utils/tax/rates.js has a case here.
*/

let nextId = 1;
const row = overrides => ({
  id: nextId++,
  country: 'US',
  state: 'VT',
  locality: '',
  postalPattern: '',
  taxClass: '*',
  level: 'state',
  kind: 'taxable',
  rateMicro: parsePercent('6'),
  appliesToShipping: false,
  taxType: 'sales_tax',
  jurisdiction: 'Vermont',
  label: 'Vermont sales tax',
  priority: 0,
  enabled: true,
  effectiveFrom: '',
  effectiveTo: '',
  ...overrides,
});

const request = (overrides = {}) => {
  const [error, parsed] = parseRequest({
    address: { country: 'US', state: 'VT', postalCode: '05401', city: 'Burlington' },
    lines: [{ amount: 10000, reference: 'a', taxClass: 'physical' }],
    ...overrides,
  }, { includesTax: false, taxClass: 'physical' });
  if(error) throw new Error(`refused: ${error.msg}`);
  return parsed;
};

const calc = (rows, overrides, options) => calculateWithRates(request(overrides), rows, { date: '2026-06-15', ...options });

export default {
  'a state rate applies to a matching line': async ({ pass, fail }) => {
    const result = calc([row({ taxClass: 'physical' })]);
    if(result.tax !== 600) return fail(`tax was ${result.tax}, expected 600`);
    if(result.total !== 10600) return fail(`total was ${result.total}`);
    if(!result.collecting) return fail('should be collecting');
    if(result.lines[0].status !== 'taxed' || result.lines[0].netAmount !== 10000) return fail('line not reported as taxed');
    pass('');
  },

  'a local option stacks on the state rate': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical' }),
      row({ taxClass: 'physical', level: 'city', locality: 'Burlington', rateMicro: parsePercent('1'), jurisdiction: 'Burlington local option' }),
    ];
    const result = calc(rows);
    if(result.tax !== 700) return fail(`tax was ${result.tax}, expected 700 (6% + 1%)`);
    if(result.breakdown.length !== 2) return fail('should report two layers');

    const elsewhere = calc(rows, { address: { country: 'US', state: 'VT', postalCode: '05601', city: 'Montpelier' } });
    if(elsewhere.tax !== 600) return fail('a town with no local option should pay the state rate only');
    pass('both layers appear on the breakdown, each as its own jurisdiction');
  },

  'the most specific row at a level wins, it does not stack with a less specific one': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: '*', rateMicro: parsePercent('6') }),
      row({ taxClass: '*', locality: 'Burlington', level: 'state', rateMicro: parsePercent('5') }),
    ];
    const result = calc(rows);
    if(result.tax !== 500) return fail(`expected the locality row (5%), got ${result.tax}`);
    pass('');
  },

  'an exact class beats a wildcard at the same level, and priority breaks ties': async ({ pass, fail }) => {
    const exact = calc([row({ taxClass: '*', rateMicro: parsePercent('6') }), row({ taxClass: 'physical', rateMicro: parsePercent('0.5') })]);
    if(exact.tax !== 50) return fail(`the named class should beat *, got ${exact.tax}`);

    const tie = calc([
      row({ taxClass: 'physical', rateMicro: parsePercent('6'), priority: 1 }),
      row({ taxClass: 'physical', rateMicro: parsePercent('4'), priority: 5 }),
    ]);
    if(tie.tax !== 400) return fail(`priority should decide, got ${tie.tax}`);
    pass('');
  },

  'no matching row means not collecting, which is not the same as exempt': async ({ pass, fail }) => {
    const none = calc([row({ state: 'NH', taxClass: 'physical' })]);
    if(none.collecting) return fail('a place with no rate must not read as collecting');
    if(none.lines[0].status !== 'not_collecting') return fail(`status was ${none.lines[0].status}`);
    if(none.breakdown[0].reason !== 'not_collecting') return fail('breakdown should say not_collecting');
    if(none.tax !== 0) return fail('tax should be 0');

    const exempt = calc([row({ taxClass: 'physical', kind: 'exempt', rateMicro: 0 })]);
    if(!exempt.collecting) return fail('an exempt row is a place the site collects');
    if(exempt.lines[0].status !== 'exempt') return fail(`status was ${exempt.lines[0].status}`);
    pass('');
  },

  'a class only gets the rows for its own class': async ({ pass, fail }) => {
    const rows = [row({ taxClass: 'digital', rateMicro: parsePercent('6') })];
    const result = calc(rows, { lines: [{ amount: 10000, reference: 'a', taxClass: 'physical' }] });
    if(result.tax !== 0 || result.collecting) return fail('a physical line must not take a digital rate');
    pass('');
  },

  'a raw tax code finds the row written with its class name': async ({ pass, fail }) => {
    const result = calc([row({ taxClass: 'physical' })], { lines: [{ amount: 10000, reference: 'a', taxClass: 'txcd_99999999' }] });
    if(result.tax !== 600) return fail(`expected 600, got ${result.tax}`);
    pass('');
  },

  'shipping is taxed only by rows that say so': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical' }),
      row({ taxClass: 'shipping', appliesToShipping: true }),
    ];
    const taxed = calc(rows, { shipping: { amount: 1000 } });
    if(taxed.tax !== 660) return fail(`expected 660 (600 + 60), got ${taxed.tax}`);
    if(taxed.shipping.tax !== 60) return fail('shipping tax missing');

    const untaxed = calc([row({ taxClass: 'physical' })], { shipping: { amount: 1000 } });
    if(untaxed.tax !== 600) return fail(`shipping should not be taxed with no shipping row, got ${untaxed.tax}`);
    pass('');
  },

  'effective dates are respected, and a quote is taxed at the rate in force on its date': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical', rateMicro: parsePercent('5'), effectiveTo: '2026-07-01' }),
      row({ taxClass: 'physical', rateMicro: parsePercent('6'), effectiveFrom: '2026-07-01' }),
    ];
    const before = calc(rows, {}, { date: '2026-06-30' });
    const after = calc(rows, {}, { date: '2026-07-01' });
    if(before.tax !== 500) return fail(`before the change: ${before.tax}`);
    if(after.tax !== 600) return fail(`on the day of the change: ${after.tax}`);
    pass('effectiveTo is exclusive, so there is no day with both or neither');
  },

  'a disabled row is ignored': async ({ pass, fail }) => {
    const result = calc([row({ taxClass: 'physical', enabled: false })]);
    if(result.collecting) return fail('a disabled row should not apply');
    pass('');
  },

  'postal patterns: exact, prefix and range': async ({ pass, fail }) => {
    const cases = [
      ['05401', '05401', true],
      ['05401', '05402', false],
      ['054*', '05499', true],
      ['054*', '05301', false],
      ['05400-05499', '05455', true],
      ['05400-05499', '05500', false],
      ['05401, 05402', '05402', true],
      ['', 'anything', true],
      ['05401', '', false],
      ['H2X 1Y4', 'h2x1y4', true],
    ];
    for(const [pattern, postal, expected] of cases){
      if(postalMatches(pattern, postal) !== expected) return fail(`${JSON.stringify(pattern)} vs ${JSON.stringify(postal)} should be ${expected}`);
    }
    pass('');
  },

  'a postal-code row beats a town row beats a state row': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical', rateMicro: parsePercent('6') }),
      row({ taxClass: 'physical', locality: 'Burlington', rateMicro: parsePercent('7') }),
      row({ taxClass: 'physical', postalPattern: '05401', rateMicro: parsePercent('8') }),
    ];
    const winners = layersFor(rows, {
      address: { country: 'US', state: 'VT', city: 'Burlington', postal_code: '05401' },
      line: { taxClass: 'physical' },
      shipping: false,
      date: '2026-06-15',
    });
    if(winners.length !== 1 || winners[0].rateMicro !== parsePercent('8')) return fail('the postal row should win');
    pass('');
  },

  'proportional shipping taxes the share of shipping that matches the taxable goods — the same figure Stripe returned': async ({ pass, fail }) => {
    // Captured from a live Stripe test-mode calculation for exactly this cart: Vermont, 7% combined,
    // $49.99 taxable goods + $10.00 exempt goods + $8.00 shipping gave 350 + 0 + 47.
    const rows = [
      row({ taxClass: 'physical', rateMicro: parsePercent('7') }),
      row({ taxClass: 'nontaxable', kind: 'exempt', rateMicro: 0 }),
      row({ taxClass: 'shipping', rateMicro: parsePercent('7'), appliesToShipping: true, shippingProportional: true }),
    ];
    const result = calc(rows, {
      lines: [
        { amount: 4999, reference: 'car', taxClass: 'physical' },
        { amount: 1000, reference: 'gift', taxClass: 'nontaxable' },
      ],
      shipping: { amount: 800 },
    });

    if(result.lines[0].tax !== 350) return fail(`goods tax ${result.lines[0].tax}`);
    if(result.shipping.tax !== 47) return fail(`shipping tax ${result.shipping.tax}, Stripe said 47`);
    if(result.tax !== 397) return fail(`total tax ${result.tax}, Stripe said 397`);
    pass('the two providers agree to the cent on this cart');
  },

  'proportional shipping is full when every good is taxable and nothing when none is': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical' }),
      row({ taxClass: 'nontaxable', kind: 'exempt', rateMicro: 0 }),
      row({ taxClass: 'shipping', appliesToShipping: true, shippingProportional: true }),
    ];

    const all = calc(rows, { lines: [{ amount: 10000, reference: 'a', taxClass: 'physical' }], shipping: { amount: 1000 } });
    if(all.shipping.tax !== 60) return fail(`all taxable: shipping tax ${all.shipping.tax}, expected the full 60`);

    const none = calc(rows, { lines: [{ amount: 10000, reference: 'a', taxClass: 'nontaxable' }], shipping: { amount: 1000 } });
    if(none.shipping.tax !== 0) return fail(`nothing taxable: shipping tax ${none.shipping.tax}, expected 0`);
    pass('');
  },

  'a row without the proportional flag still taxes shipping in full': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical' }),
      row({ taxClass: 'nontaxable', kind: 'exempt', rateMicro: 0 }),
      row({ taxClass: 'shipping', appliesToShipping: true }),
    ];
    const result = calc(rows, {
      lines: [{ amount: 4999, reference: 'car', taxClass: 'physical' }, { amount: 1000, reference: 'gift', taxClass: 'nontaxable' }],
      shipping: { amount: 800 },
    });
    if(result.shipping.tax !== 48) return fail(`full-rate shipping tax was ${result.shipping.tax}, expected 48`);
    pass('');
  },

  'a tax-inclusive line has its tax taken out of the amount, not added': async ({ pass, fail }) => {
    const result = calc([row({ taxClass: 'physical', rateMicro: parsePercent('20') })], {
      lines: [{ amount: 12000, reference: 'a', taxClass: 'physical', taxBehavior: 'inclusive' }],
    });
    if(result.taxAmountInclusive !== 2000) return fail(`inclusive tax was ${result.taxAmountInclusive}`);
    if(result.total !== 12000) return fail(`total should stay 12000, got ${result.total}`);
    if(result.lines[0].netAmount !== 10000) return fail(`net was ${result.lines[0].netAmount}`);
    pass('');
  },

  'invoice rounding rounds once per layer and the lines still add up': async ({ pass, fail }) => {
    // Three lines of 33 cents at 6%: 1.98 each. Per line: 2+2+2 = 6. Per invoice: 5.94 → 6.
    // Use amounts where the two methods differ: three lines of $0.25 at 6% = 1.5 each.
    const lines = [0, 1, 2].map(i => ({ amount: 25, reference: `l${i}`, taxClass: 'physical' }));
    const rows = [row({ taxClass: 'physical' })];

    const perLine = calc(rows, { lines }, { rounding: 'line' });
    const perInvoice = calc(rows, { lines }, { rounding: 'invoice' });

    // 3 × round(1.5) = 6 per line; one rounding of 4.5 = 5 per invoice.
    if(perLine.tax !== 6) return fail(`per line gave ${perLine.tax}`);
    if(perInvoice.tax !== 5) return fail(`per invoice gave ${perInvoice.tax}`);
    const lineSum = perInvoice.lines.reduce((sum, line) => sum + line.tax, 0);
    if(lineSum !== 5) return fail(`lines sum to ${lineSum}, not the invoice figure`);
    pass('');
  },

  'a zero-amount line is kept and costs nothing': async ({ pass, fail }) => {
    const result = calc([row({ taxClass: 'physical' })], {
      lines: [{ amount: 10000, reference: 'a', taxClass: 'physical' }, { amount: 0, reference: 'free', taxClass: 'physical' }],
    });
    if(result.lines.length !== 2) return fail('every line should be returned');
    if(result.lines[1].status !== 'zero' || result.lines[1].tax !== 0) return fail('free line wrong');
    pass('');
  },

  'tax adds up: the lines, the shipping and the breakdown agree': async ({ pass, fail }) => {
    const rows = [
      row({ taxClass: 'physical' }),
      row({ taxClass: 'physical', level: 'city', locality: 'Burlington', rateMicro: parsePercent('1'), jurisdiction: 'Burlington' }),
      row({ taxClass: 'shipping', appliesToShipping: true }),
    ];
    const result = calc(rows, {
      lines: [{ amount: 4999, reference: 'a', taxClass: 'physical' }, { amount: 1999, reference: 'b', quantity: 2, taxClass: 'physical' }],
      shipping: { amount: 800 },
    });
    const fromLines = result.lines.reduce((sum, line) => sum + line.tax, 0) + result.shipping.tax;
    if(fromLines !== result.tax) return fail(`lines ${fromLines} vs tax ${result.tax}`);
    if(result.total !== 4999 + 1999 + 800 + result.tax) return fail('total does not add up');
    pass('');
  },
};
