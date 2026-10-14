/*
  Rates, without floating point.

  A tax rate is a percentage with up to four decimal places — 6%, 7.25%, 6.625% — and the amounts
  it is applied to are integers in a currency's minor unit. Doing that in floats is how a total ends
  up one cent off, and one cent off on a tax return is a number that does not reconcile.

  So a rate is held as an integer count of **millionths** (parts per 1,000,000): 6% is 60000,
  7.25% is 72500, 6.625% is 66250. "Micro" in every name below means exactly that. Applying one is
  `amount * micro / 1_000_000`, done in BigInt so the product cannot lose precision however large
  the amount, then rounded half-up.
*/

export const ONE = 1_000_000;

const DECIMAL = /^(\d{1,3})(?:\.(\d{1,4}))?$/;

/*
  "7.25", "7.25%", " 6.625 " → 72500, 66250. Anything that is not a plain non-negative percentage
  of at most 100 with at most four decimals is `null`, never a guess.
*/
export const parsePercent = value => {
  if(typeof value === 'number'){
    if(!Number.isFinite(value) || value < 0 || value > 100) return null;
    value = String(value);
  }
  if(typeof value !== 'string') return null;

  const match = DECIMAL.exec(value.trim().replace(/%$/, '').trim());
  if(!match) return null;

  const micro = Number(match[1]) * 10_000 + Number((match[2] || '').padEnd(4, '0'));
  return micro > 100 * 10_000 ? null : micro;
};

/*
  The inverse: 72500 → "7.25", 60000 → "6", 66250 → "6.625".
*/
export const formatPercent = micro => {
  const whole = Math.floor(micro / 10_000);
  const fraction = String(micro % 10_000).padStart(4, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};

/*
  numerator / denominator, rounded half away from zero, for integers. Both are handed to BigInt so
  an amount times a rate cannot overflow a double.
*/
export const roundDiv = (numerator, denominator) => {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const negative = (n < 0n) !== (d < 0n);
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  const quotient = (2n * absN + absD) / (2n * absD);
  return Number(negative ? -quotient : quotient);
};

/*
  Tax on an amount that does not include it.
*/
export const taxExclusive = (amount, micro) => roundDiv(BigInt(amount) * BigInt(micro), ONE);

/*
  This layer's share of the tax *inside* an amount that already includes tax at a combined rate of
  `totalMicro`. Each layer is `amount * rate / (1 + total)`, which is why layers can be rounded
  independently: they are shares of one number, not rates applied to a shrinking base.
*/
export const taxInclusive = (amount, micro, totalMicro) => roundDiv(BigInt(amount) * BigInt(micro), ONE + totalMicro);

/*
  Spread `total` across `exacts` (each a { numerator, denominator } or plain number of the exact,
  unrounded share) so the parts are integers and add up to `total` exactly — largest remainder.
  Used when tax is rounded once for the whole invoice but each line still has to show its own.
*/
export const allocate = (shares, total) => {
  const floors = shares.map(share => {
    const n = BigInt(share.numerator);
    const d = BigInt(share.denominator);
    return { floor: n / d, remainder: n % d, denominator: d };
  });

  const result = floors.map(entry => Number(entry.floor));
  let leftover = total - result.reduce((sum, value) => sum + value, 0);

  const order = floors
    .map((entry, index) => ({ index, ratio: Number(entry.remainder) / Number(entry.denominator) }))
    .sort((a, b) => b.ratio - a.ratio || a.index - b.index);

  for(let i = 0; leftover > 0 && order.length; i = (i + 1) % order.length, leftover--){
    result[order[i].index] += 1;
  }
  for(let i = order.length - 1; leftover < 0 && order.length; i = (i - 1 + order.length) % order.length, leftover++){
    result[order[i].index] -= 1;
  }

  return result;
};
