import {
  TAX_CLASSES,
  resolveTaxCode,
  parseAddress,
  parseTaxIds,
  parseRequest,
  toStripeParams,
  fromCalculation,
  emptyCalculation,
  hasBillableAmount,
} from '../server/utils/tax/shape.js';

/*
  The validation and the arithmetic, with no Stripe and no database. This is the part that decides
  whether a customer is charged the right amount, so it gets the most attention.
*/

const request = overrides => ({
  address: { country: 'US', state: 'CA', postalCode: '94103' },
  lines: [{ amount: 5000, reference: 'a' }],
  ...overrides,
});

const parse = (input, defaults) => {
  const [error, parsed] = parseRequest(input, defaults);
  if(error) throw new Error(`unexpected refusal: ${error.msg}`);
  return parsed;
};

export default {
  'a class name, any case, and a raw id all resolve; blank means "not said"': async ({ pass, fail }) => {
    if(resolveTaxCode('physical')[1] !== TAX_CLASSES.physical) return fail('physical did not resolve');
    if(resolveTaxCode('SaaS')[1] !== TAX_CLASSES.saas) return fail('class names should be case-insensitive');
    if(resolveTaxCode('txcd_10000000')[1] !== 'txcd_10000000') return fail('a raw id should pass through');

    for(const blank of [undefined, null, '', '   ']){
      const [error, code] = resolveTaxCode(blank);
      if(error || code !== null) return fail(`${JSON.stringify(blank)} should mean "not said", not an error`);
    }
    pass('');
  },

  'an unknown tax class is refused rather than passed on': async ({ pass, fail }) => {
    for(const bad of ['phsyical', 'txcd_12', 'toString', '__proto__', 42]){
      const [error] = resolveTaxCode(bad);
      if(!error || error.code !== 400) return fail(`${JSON.stringify(bad)} should be refused`);
    }
    pass('including names that exist on Object.prototype');
  },

  'an address needs a two-letter country and keeps only what tax uses': async ({ pass, fail }) => {
    for(const bad of [null, [], 'US', {}, { country: 'USA' }, { country: '1' }]){
      const [error] = parseAddress(bad);
      if(!error) return fail(`${JSON.stringify(bad)} should be refused`);
    }

    const [error, address] = parseAddress({ country: ' us ', zip: '94103', state: 'CA', name: 'ignored', city: '' });
    if(error) return fail(error.msg);
    if(address.country !== 'US') return fail('country should be upper-cased');
    if(address.postal_code !== '94103') return fail('zip should be read as the postal code');
    if('name' in address || 'city' in address) return fail('unrelated and empty fields should be dropped');
    pass('');
  },

  'tax ids must be well-formed, and absent is fine': async ({ pass, fail }) => {
    if(parseTaxIds(undefined)[1].length !== 0) return fail('absent should be an empty list');
    if(!parseTaxIds('eu_vat')[0]) return fail('a non-list should be refused');
    if(!parseTaxIds([{ type: 'eu_vat' }])[0]) return fail('an id with no value should be refused');
    if(parseTaxIds([{ type: 'eu_vat', value: 'DE123456789' }])[1][0].value !== 'DE123456789') return fail('a good id should pass');
    pass('');
  },

  'amounts must be whole minor units, never fractional or negative': async ({ pass, fail }) => {
    for(const amount of [49.99, -1, '5000', NaN, Infinity, null, undefined]){
      const [error] = parseRequest(request({ lines: [{ amount }] }));
      if(!error) return fail(`${String(amount)} should be refused`);
    }
    pass('a dollars-as-float mistake is the likeliest bug, and it is caught here');
  },

  'two lines may not share a reference, and an unnamed line gets one': async ({ pass, fail }) => {
    const [error] = parseRequest(request({ lines: [{ amount: 1, reference: 'x' }, { amount: 2, reference: 'x' }] }));
    if(!error) return fail('a duplicate reference should be refused');

    const parsed = parse(request({ lines: [{ amount: 1 }, { amount: 2 }] }));
    if(parsed.lines[0].reference !== 'line-1' || parsed.lines[1].reference !== 'line-2') return fail('lines should be named by position');
    pass('');
  },

  'prices-include-tax is the default behaviour and a line may override it': async ({ pass, fail }) => {
    const exclusive = parse(request());
    if(exclusive.lines[0].taxBehavior !== 'exclusive') return fail('the default should be exclusive');

    const inclusive = parse(request(), { includesTax: true });
    if(inclusive.lines[0].taxBehavior !== 'inclusive') return fail('the setting should make lines inclusive');

    const overridden = parse(request({ lines: [{ amount: 1, taxBehavior: 'exclusive' }] }), { includesTax: true });
    if(overridden.lines[0].taxBehavior !== 'exclusive') return fail('a line should override the setting');

    const [error] = parseRequest(request({ lines: [{ amount: 1, taxBehavior: 'sometimes' }] }));
    if(!error) return fail('an unknown behaviour should be refused');
    pass('');
  },

  'a line with no class falls back to the configured default': async ({ pass, fail }) => {
    const named = parse(request({ shipping: { amount: 500 } }), { taxClass: 'digital' });
    if(named.lines[0].taxClass !== 'digital' || named.lines[0].taxCode !== TAX_CLASSES.digital) return fail('a default class name should carry its category id');
    if(named.shipping.taxCode !== TAX_CLASSES.shipping || named.shipping.taxClass !== 'shipping') return fail('shipping should use its own class');

    const raw = parse(request(), { taxClass: 'txcd_10103000' });
    if(raw.lines[0].taxCode !== 'txcd_10103000' || raw.lines[0].taxClass !== 'saas') return fail('a default category id should come back under its class name');

    const [bad] = parseRequest(request(), { taxClass: 'phsyical' });
    if(!bad) return fail('an invalid default should be refused loudly, not ignored');
    pass('');
  },

  'the Stripe request carries the address, tax ids and shipping, and omits zero lines': async ({ pass, fail }) => {
    const parsed = parse(request({
      lines: [{ amount: 5000, reference: 'a', quantity: 2, taxClass: 'digital' }, { amount: 0, reference: 'free' }],
      shipping: { amount: 800 },
      taxIds: [{ type: 'eu_vat', value: 'DE123456789' }],
      addressSource: 'billing',
    }));
    const params = toStripeParams(parsed);

    if(params.line_items.length !== 1) return fail('the zero-amount line should not be sent');
    const [item] = params.line_items;
    if(item.amount !== 5000 || item.quantity !== 2 || item.tax_code !== TAX_CLASSES.digital) return fail(`wrong line: ${JSON.stringify(item)}`);
    if(params.customer_details.address.country !== 'US') return fail('address missing');
    if(params.customer_details.address_source !== 'billing') return fail('address source missing');
    if(params.customer_details.tax_ids[0].value !== 'DE123456789') return fail('tax id missing');
    if(params.shipping_cost.amount !== 800) return fail('shipping missing');
    if(!params.expand.includes('line_items')) return fail('line items must be expanded to read per-line tax');
    pass('');
  },

  'a free cart with no shipping is answered without being sent': async ({ pass, fail }) => {
    const parsed = parse(request({ lines: [{ amount: 0, reference: 'free' }] }));
    if(hasBillableAmount(parsed)) return fail('nothing here is billable');

    const empty = emptyCalculation(parsed);
    if(empty.tax !== 0 || empty.total !== 0 || empty.lines.length !== 1) return fail('the empty answer should keep every line, at zero');
    pass('');
  },

  'a Stripe calculation becomes one shape, with per-line tax matched by reference': async ({ pass, fail }) => {
    const parsed = parse(request({ lines: [{ amount: 5000, reference: 'a' }, { amount: 1000, reference: 'b' }], shipping: { amount: 800 } }));

    const result = fromCalculation({
      id: 'taxcalc_1',
      currency: 'usd',
      amount_total: 7154,
      tax_amount_exclusive: 354,
      tax_amount_inclusive: 0,
      expires_at: 1900000000,
      livemode: false,
      line_items: { data: [{ reference: 'b', amount_tax: 73 }, { reference: 'a', amount_tax: 363 }] },
      shipping_cost: { amount_tax: 0 },
      tax_breakdown: [{
        amount: 354,
        inclusive: false,
        taxable_amount: 4000,
        taxability_reason: 'standard_rated',
        jurisdiction: { display_name: 'California', level: 'state', country: 'US', state: 'CA' },
        tax_rate_details: { display_name: 'Sales tax', percentage_decimal: '7.25', tax_type: 'sales_tax' },
      }],
    }, parsed);

    if(result.calculationId !== 'taxcalc_1') return fail('calculation id missing');
    if(result.tax !== 354 || result.total !== 7154) return fail(`wrong totals: ${result.tax} / ${result.total}`);
    if(result.lines[0].reference !== 'a' || result.lines[0].tax !== 363) return fail('line a should carry its own tax even when returned out of order');
    if(result.lines[1].tax !== 73) return fail('line b tax wrong');
    if(!result.collecting) return fail('a standard-rated breakdown means tax is being collected');
    if(result.breakdown[0].rate !== '7.25' || result.breakdown[0].jurisdiction !== 'California') return fail('breakdown not mapped');
    if(!/^\d{4}-/.test(result.expiresAt)) return fail('expiry should be an ISO date');
    pass('');
  },

  'a Stripe result becomes a ledger entry with the same three-way split': async ({ pass, fail }) => {
    const { entryFromResult } = await import('../server/utils/ledger/entries.js');
    const parsed = parse(request({ lines: [{ amount: 5000, reference: 'a' }, { amount: 1000, reference: 'b' }], shipping: { amount: 800 } }));

    const result = fromCalculation({
      id: 'taxcalc_9',
      currency: 'usd',
      amount_total: 6800 + 363,
      tax_amount_exclusive: 363,
      tax_amount_inclusive: 0,
      line_items: { data: [{ reference: 'a', amount_tax: 363 }, { reference: 'b', amount_tax: 0 }] },
      shipping_cost: { amount_tax: 0 },
      tax_breakdown: [{
        amount: 363,
        taxable_amount: 5000,
        taxability_reason: 'standard_rated',
        jurisdiction: { display_name: 'California', level: 'state', country: 'US', state: 'CA' },
        tax_rate_details: { display_name: 'Sales tax', percentage_decimal: '7.25', tax_type: 'sales_tax' },
      }],
    }, parsed);

    // Where the site collects, a line with no tax on it was exempt — not "not collecting".
    if(result.lines[1].status !== 'exempt') return fail(`zero-tax line status was ${result.lines[1].status}`);
    if(result.lines[0].status !== 'taxed' || result.lines[0].netAmount !== 5000) return fail('taxed line wrong');

    const entry = entryFromResult(result, { address: { country: 'US', state: 'CA', postal_code: '94103' }, reference: 'o1', occurredAt: new Date() });
    if(entry.taxableAmount !== 5000 || entry.exemptAmount !== 1800 || entry.uncollectedAmount !== 0) return fail(`split ${entry.taxableAmount}/${entry.exemptAmount}/${entry.uncollectedAmount}`);
    if(entry.salesAmount + entry.taxAmount !== result.total) return fail('sales + tax should equal the total charged');
    pass('');
  },

  'a breakdown that is all not_collecting is reported as not collecting': async ({ pass, fail }) => {
    const parsed = parse(request());
    const result = fromCalculation({
      id: 'taxcalc_2',
      amount_total: 5000,
      tax_amount_exclusive: 0,
      tax_amount_inclusive: 0,
      line_items: { data: [{ reference: 'a', amount_tax: 0 }] },
      tax_breakdown: [{ amount: 0, taxable_amount: 0, taxability_reason: 'not_collecting', jurisdiction: { display_name: 'California' } }],
    }, parsed);

    if(result.collecting) return fail('not_collecting must not read as collecting');
    if(result.tax !== 0) return fail('there should be no tax');
    pass('a caller can tell "0% rate" from "not registered here"');
  },
};
