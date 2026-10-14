import { parsePercent, formatPercent, roundDiv, taxExclusive, taxInclusive, allocate, ONE } from '../server/utils/tax/percent.js';

/*
  Money arithmetic, with no floats. A wrong cent here is a return that does not reconcile.
*/

export default {
  'percentages parse to millionths exactly, and round-trip': async ({ pass, fail }) => {
    const cases = { '6': 60000, '7.25': 72500, '6.625': 66250, '0': 0, '100': 1000000, '0.0001': 1, ' 7.25% ': 72500, '07': 70000 };
    for(const [input, micro] of Object.entries(cases)){
      if(parsePercent(input) !== micro) return fail(`${JSON.stringify(input)} gave ${parsePercent(input)}, expected ${micro}`);
    }
    for(const micro of [0, 1, 60000, 66250, 72500, 1000000]){
      if(parsePercent(formatPercent(micro)) !== micro) return fail(`${micro} did not round-trip through ${formatPercent(micro)}`);
    }
    pass('6.625 is 66250, not 66249.99999');
  },

  'anything that is not a plain percentage is refused': async ({ pass, fail }) => {
    for(const bad of ['', 'abc', '-1', '101', '6.12345', '1e2', '6,5', null, undefined, NaN, {}, '100.0001']){
      if(parsePercent(bad) !== null) return fail(`${JSON.stringify(bad)} should be refused`);
    }
    pass('');
  },

  'rounding is half-up, away from zero, and exact for large amounts': async ({ pass, fail }) => {
    if(roundDiv(5, 10) !== 1) return fail('0.5 should round to 1');
    if(roundDiv(4, 10) !== 0) return fail('0.4 should round to 0');
    if(roundDiv(-5, 10) !== -1) return fail('-0.5 should round away from zero');

    // 6.625% of $99,999,999.99 — a double would be off by a unit somewhere in here.
    const tax = taxExclusive(9999999999, 66250);
    if(tax !== 662500000) return fail(`large amount gave ${tax}`);
    pass('');
  },

  'tax on a cent amount matches hand calculation': async ({ pass, fail }) => {
    // 6% of $0.99 = 5.94 cents → 6; 6% of $0.50 = 3
    if(taxExclusive(99, 60000) !== 6) return fail('6% of 99 should be 6');
    if(taxExclusive(50, 60000) !== 3) return fail('6% of 50 should be 3');
    // 7.25% of $49.99 = 362.4275 → 362
    if(taxExclusive(4999, 72500) !== 362) return fail('7.25% of 4999 should be 362');
    pass('');
  },

  'inclusive tax is the share inside the amount, not the rate applied to it': async ({ pass, fail }) => {
    // $119.00 including 19%: tax inside is 19.00 (100 + 19).
    if(taxInclusive(11900, 190000, 190000) !== 1900) return fail(`got ${taxInclusive(11900, 190000, 190000)}`);

    // Two layers, 5% + 2% on $107: 5 and 2.
    const state = taxInclusive(10700, 50000, 70000);
    const local = taxInclusive(10700, 20000, 70000);
    if(state !== 500 || local !== 200) return fail(`layers gave ${state} and ${local}`);
    pass('');
  },

  'allocation sums exactly to the total and spreads by largest remainder': async ({ pass, fail }) => {
    // Three equal shares of 100 → 34, 33, 33 (first gets the extra).
    const shares = [1, 1, 1].map(() => ({ numerator: 1n, denominator: 3n }));
    const parts = allocate(shares.map(share => ({ numerator: share.numerator * 100n, denominator: share.denominator })), 100);
    if(parts.reduce((a, b) => a + b, 0) !== 100) return fail(`parts ${parts} do not sum to 100`);
    if(Math.max(...parts) - Math.min(...parts) > 1) return fail(`parts ${parts} are uneven`);

    // Total smaller than the floors: gets taken back down.
    const down = allocate([{ numerator: 5n, denominator: 1n }, { numerator: 5n, denominator: 1n }], 9);
    if(down.reduce((a, b) => a + b, 0) !== 9) return fail('did not reduce to the total');
    pass('');
  },

  'the unit is one million': async ({ pass, fail }) => {
    if(ONE !== 1000000) return fail('ONE should be 1,000,000');
    pass('');
  },
};
