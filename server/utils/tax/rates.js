import { ONE, allocate, formatPercent, roundDiv, taxExclusive, taxInclusive } from './percent.js';
import { TAX_CLASSES, lineResult } from './shape.js';

/*
  The rate table engine: given the rows a site maintains, work out the tax on a request.

  Pure — no database and no network. The provider module (server/providers/rates.js) fetches the
  rows and calls this, which is what lets every rule below be tested with plain objects.

  ## How a rate is chosen

  A place is taxed in **layers** that stack: a country, a state, a county, a city, a special
  district. Vermont's 6% state rate plus a 1% local option in some towns is two layers, and a
  customer in such a town pays both.

  So rows are not "the" rate for a place; each row is one layer's rate, and:

  1. Rows are filtered to those that match the destination (country, then state, locality, postal
     pattern, each blank meaning "any"), the line's class (or \`*\`), and the date.
  2. Within one \`level\`, the **most specific** matching row wins — a row for one postal code beats
     a row for a town beats a row for the whole state. At equal specificity a row for a named class
     beats a `*` row; then higher `priority`, then the later `effectiveFrom`, then the newer row.
  3. The winners, one per level, are the layers that apply, and their rates add.

  A level with no matching row contributes nothing. A line with no matching row at *any* level is
  \`not_collecting\`: the site has no rate for that place, which is how "I am not registered there"
  is expressed, and it is reported separately from "this is exempt".

  ## Money

  Rates are integer millionths (see percent.js). Tax is rounded half-up, per line per layer by
  default, or once per layer across the invoice (\`rounding: 'invoice'\`) and then spread back over
  the lines by largest remainder so each line still shows its own share and they sum to the total.
  Invoice rounding applies to tax-exclusive lines; a tax-inclusive line is always rounded by itself.
*/

export const LEVELS = ['country', 'state', 'county', 'city', 'district', 'special'];

export const KINDS = ['taxable', 'exempt'];

const SHIPPING = '__shipping__';

const normalise = value => String(value ?? '').trim().toUpperCase();

/*
  A postal pattern is a comma-separated list; each item is one of an exact code, a prefix ending in
  \`*\`, or an inclusive range \`05401-05499\` (compared as strings of equal length, which is right for
  fixed-width postal codes and is the only reading that is not a guess).
*/
export const postalMatches = (pattern, postal) => {
  const patterns = String(pattern ?? '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
  if(!patterns.length) return true;

  const code = normalise(postal).replace(/\s+/g, '');
  if(!code) return false;

  return patterns.some(item => {
    const wanted = item.replace(/\s+/g, '');
    if(wanted.endsWith('*')) return code.startsWith(wanted.slice(0, -1));

    const range = wanted.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
    if(range && range[1].length === range[2].length){
      const head = code.slice(0, range[1].length);
      return head.length === range[1].length && head >= range[1] && head <= range[2];
    }

    return code === wanted;
  });
};

const specificity = row => (row.postalPattern ? 3 : row.locality ? 2 : row.state ? 1 : 0);

export const levelOf = row => row.level || (row.locality ? 'city' : row.state ? 'state' : 'country');

const inForce = (row, date) => (!row.effectiveFrom || row.effectiveFrom <= date) && (!row.effectiveTo || row.effectiveTo > date);

/*
  The class names a line answers to: its own name, and the category id behind it if it has one, so
  a row written as "physical" and a line sent as txcd_99999999 find each other.
*/
const classKeys = line => {
  const keys = new Set(['*']);
  if(line.taxClass) keys.add(String(line.taxClass).toLowerCase());
  if(line.taxCode) keys.add(String(line.taxCode).toLowerCase());
  if(line.taxClass && Object.hasOwn(TAX_CLASSES, String(line.taxClass).toLowerCase())){
    keys.add(TAX_CLASSES[String(line.taxClass).toLowerCase()].toLowerCase());
  }
  return keys;
};

/*
  The layers that apply to one line: at most one row per level.
*/
export const layersFor = (rows, { address, line, shipping, date }) => {
  const keys = classKeys(line);
  const country = normalise(address.country);
  const state = normalise(address.state);
  const city = normalise(address.city);

  const matching = rows.filter(row => {
    if(row.enabled === false) return false;
    if(normalise(row.country) !== country) return false;
    if(row.state && normalise(row.state) !== state) return false;
    if(row.locality && normalise(row.locality) !== city) return false;
    if(!postalMatches(row.postalPattern, address.postal_code)) return false;
    if(!keys.has(String(row.taxClass || '*').toLowerCase())) return false;
    if(shipping && !row.appliesToShipping) return false;
    return inForce(row, date);
  });

  /*
    Which of two rows at the same level wins: the more specific place, then a named class over
    `*` (a wildcard is a default, a class row is an override), then priority, then the later
    effective date, then the newer row.
  */
  const rank = row => [
    specificity(row),
    row.taxClass && row.taxClass !== '*' ? 1 : 0,
    row.priority || 0,
    String(row.effectiveFrom || ''),
    row.id || 0,
  ];

  const beats = (a, b) => {
    const left = rank(a);
    const right = rank(b);
    for(let i = 0; i < left.length; i++){
      if(left[i] > right[i]) return true;
      if(left[i] < right[i]) return false;
    }
    return false;
  };

  const best = new Map();
  for(const row of matching){
    const level = levelOf(row);
    const current = best.get(level);
    if(!current || beats(row, current)) best.set(level, row);
  }

  return LEVELS.filter(level => best.has(level)).map(level => best.get(level));
};

/*
  The date a request is taxed on, as YYYY-MM-DD in UTC. Rates are looked up by date so a sale
  quoted on the last day of a rate and recorded on the first of the next is taxed at the rate it
  was quoted at.
*/
export const dateOf = taxDate => new Date((taxDate ? taxDate * 1000 : Date.now())).toISOString().slice(0, 10);

/*
  Calculate.

  \`request\` is the output of \`parseRequest\`; \`rows\` are the rate rows (already limited to the
  destination country by the store, though matching re-checks it); \`options\` is
  \`{ rounding, date }\`.
*/
export const calculateWithRates = (request, rows, options = {}) => {
  const rounding = options.rounding === 'invoice' ? 'invoice' : 'line';
  const date = options.date || dateOf(request.taxDate);

  const items = request.lines.map(line => ({ ...line, isShipping: false }));
  if(request.shipping) items.push({ ...request.shipping, reference: SHIPPING, quantity: 1, isShipping: true });

  // 1. Resolve each item's layers, and whether it is taxed at all.
  const resolved = items.map(item => {
    const layers = item.amount > 0
      ? layersFor(rows, { address: request.address, line: item, shipping: item.isShipping, date })
      : [];
    const taxable = layers.filter(row => row.kind !== 'exempt');
    return { item, layers, taxable, totalMicro: taxable.reduce((sum, row) => sum + row.rateMicro, 0) };
  });

  // 2. The tax for each (item, layer).
  const shares = resolved.map(entry => entry.taxable.map(row => {
    const inclusive = entry.item.taxBehavior === 'inclusive';
    return {
      row,
      inclusive,
      exact: inclusive
        ? { numerator: BigInt(entry.item.amount) * BigInt(row.rateMicro), denominator: BigInt(ONE + entry.totalMicro) }
        : { numerator: BigInt(entry.item.amount) * BigInt(row.rateMicro), denominator: BigInt(ONE) },
      tax: inclusive
        ? taxInclusive(entry.item.amount, row.rateMicro, entry.totalMicro)
        : taxExclusive(entry.item.amount, row.rateMicro),
    };
  }));

  // 3. Invoice rounding: one rounded figure per layer, spread back over the lines that used it.
  if(rounding === 'invoice'){
    const byLayer = new Map();
    shares.forEach((entry, itemIndex) => entry.forEach((share, shareIndex) => {
      if(share.inclusive) return;
      const key = share.row.id ?? `${levelOf(share.row)}:${share.row.jurisdiction}:${share.row.rateMicro}`;
      if(!byLayer.has(key)) byLayer.set(key, []);
      byLayer.get(key).push({ itemIndex, shareIndex, share });
    }));

    for(const group of byLayer.values()){
      const numerator = group.reduce((sum, member) => sum + member.share.exact.numerator, 0n);
      const total = roundDiv(numerator, ONE);
      const parts = allocate(group.map(member => member.share.exact), total);
      group.forEach((member, index) => {
        shares[member.itemIndex][member.shareIndex].tax = parts[index];
      });
    }
  }

  // 4. Results, per line and per layer.
  const layerTotals = new Map();
  let collecting = false;

  const lines = resolved.map((entry, index) => {
    const tax = shares[index].reduce((sum, share) => sum + share.tax, 0);
    const lineCollecting = entry.layers.length > 0;
    if(lineCollecting) collecting = true;

    const result = lineResult(entry.item, tax, lineCollecting);
    result.taxClass = entry.item.taxClass || null;

    for(const row of entry.layers){
      const key = row.id ?? `${levelOf(row)}:${row.jurisdiction}:${row.rateMicro}`;
      if(!layerTotals.has(key)){
        layerTotals.set(key, {
          jurisdiction: row.jurisdiction || row.label || null,
          level: levelOf(row),
          country: row.country || null,
          state: row.state || null,
          taxType: row.taxType || 'sales_tax',
          name: row.label || row.jurisdiction || null,
          rate: formatPercent(row.rateMicro),
          taxableAmount: 0,
          amount: 0,
          inclusive: entry.item.taxBehavior === 'inclusive',
          reason: row.kind === 'exempt' ? 'product_exempt' : 'standard_rated',
        });
      }

      const total = layerTotals.get(key);
      if(row.kind === 'exempt') continue;

      const share = shares[index].find(candidate => candidate.row === row);
      total.amount += share.tax;
      total.taxableAmount += result.netAmount;
    }

    return result;
  });

  const shippingIndex = request.shipping ? lines.length - 1 : -1;
  const itemLines = shippingIndex >= 0 ? lines.slice(0, -1) : lines;
  const shippingLine = shippingIndex >= 0 ? lines[shippingIndex] : null;

  const taxAmountExclusive = lines.filter(line => line.taxBehavior !== 'inclusive').reduce((sum, line) => sum + line.tax, 0);
  const taxAmountInclusive = lines.filter(line => line.taxBehavior === 'inclusive').reduce((sum, line) => sum + line.tax, 0);

  const breakdown = [...layerTotals.values()];
  if(!collecting){
    breakdown.push({
      jurisdiction: request.address.state || request.address.country,
      level: request.address.state ? 'state' : 'country',
      country: request.address.country,
      state: request.address.state || null,
      taxType: null,
      name: null,
      rate: null,
      taxableAmount: 0,
      amount: 0,
      inclusive: false,
      reason: 'not_collecting',
    });
  }

  return {
    provider: 'rates',
    calculationId: null,
    expiresAt: null,
    livemode: true,
    currency: request.currency,
    taxAmountExclusive,
    taxAmountInclusive,
    tax: taxAmountExclusive + taxAmountInclusive,
    // The charge: amounts, plus tax that was added on top. Inclusive tax is already in the amounts.
    total: lines.reduce((sum, line) => sum + line.amount, 0) + taxAmountExclusive,
    collecting,
    lines: itemLines,
    shipping: shippingLine,
    breakdown,
    rounding,
    taxDate: date,
  };
};
