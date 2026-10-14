/*
  Turning what a caller hands in into what a provider needs, and what a provider answers into one
  vocabulary — with no network and no database anywhere in this file.

  That is the point of the split. Everything here is arithmetic and validation, which is the part
  that decides whether somebody is charged the right amount, and it can be tested with plain objects.
  The provider module (server/providers/stripe.js) is the thin part that actually talks to a service.

  All amounts are integers in the currency's minor unit — 4999 is $49.99 — exactly as in
  kempo-payments, so a total from here can be handed straight to `createPayment`.
*/

/*
  Tax classes

  A caller usually knows what *kind* of thing it sells, not a Stripe category id. These names are
  what an extension passes; a raw `txcd_…` id is also accepted for anything not listed.

  The ids are Stripe's published tax categories. Whether a category is taxable, and at what rate,
  is decided by Stripe per jurisdiction — a name here only chooses which row of their table is used.
  The admin screen lists Stripe's full set so a site can verify one before relying on it.
*/
export const TAX_CLASSES = {
  physical: 'txcd_99999999',
  digital: 'txcd_10000000',
  saas: 'txcd_10103000',
  'saas-business': 'txcd_10103001',
  nontaxable: 'txcd_00000000',
  shipping: 'txcd_92010001',
};

export const TAX_BEHAVIORS = ['exclusive', 'inclusive'];

const TAX_CODE = /^txcd_\d{8}$/;

/*
  `null` is a real answer, not a failure: it means "the caller did not say", and the configured
  default (or Stripe's own) applies. An unrecognised name is refused rather than passed through,
  because Stripe would reject it with a message about the account rather than about the typo.
*/
export const resolveTaxCode = value => {
  if(value === undefined || value === null || value === '') return [null, null];
  if(typeof value !== 'string') return [{ code: 400, msg: 'A tax class must be a string' }, null];

  const trimmed = value.trim();
  if(!trimmed) return [null, null];
  if(TAX_CODE.test(trimmed)) return [null, trimmed];
  if(Object.hasOwn(TAX_CLASSES, trimmed.toLowerCase())) return [null, TAX_CLASSES[trimmed.toLowerCase()]];

  return [{ code: 400, msg: `Unknown tax class "${trimmed.slice(0, 40)}". Use one of ${Object.keys(TAX_CLASSES).join(', ')}, or a Stripe tax code such as txcd_99999999` }, null];
};

/*
  Like `resolveTaxCode`, but keeps the *name*. A rate table is keyed by class name ("physical"),
  while Stripe wants the category id, so both have to survive parsing. A raw id that is one of the
  named classes comes back under its name; any other id is its own name.

  `[null, null]` still means "the caller did not say".
*/
const CLASS_BY_CODE = Object.fromEntries(Object.entries(TAX_CLASSES).map(([name, code]) => [code, name]));

export const resolveTaxClass = value => {
  const [error, code] = resolveTaxCode(value);
  if(error || code === null) return [error, null];

  const trimmed = value.trim();
  const named = Object.hasOwn(TAX_CLASSES, trimmed.toLowerCase()) ? trimmed.toLowerCase() : null;
  return [null, { name: named || CLASS_BY_CODE[code] || code, code }];
};

export const isTaxBehavior = value => TAX_BEHAVIORS.includes(value);

/*
  Currency and amounts
*/

export const normaliseCurrency = value => String(value || '').trim().toLowerCase();

export const isValidCurrency = value => /^[a-z]{3}$/.test(value);

const isMinorAmount = value => Number.isSafeInteger(value) && value >= 0;

/*
  Address

  Only the fields tax needs, and only a country is mandatory. A country alone gets an answer for
  most of the world; the United States needs a postal code (or at least a state) for a rate that
  means anything, and Stripe says so itself when it is missing — that message is passed back, so
  nothing here guesses which countries need which parts.

  `postal_code` and `zip` are accepted as spellings of `postalCode`, because the form a caller took
  the address from may have used any of them.
*/
export const parseAddress = input => {
  if(!input || typeof input !== 'object' || Array.isArray(input)){
    return [{ code: 400, msg: 'An address is required' }, null];
  }

  const text = value => (typeof value === 'string' ? value.trim() : '');
  const country = text(input.country).toUpperCase();

  if(!/^[A-Z]{2}$/.test(country)){
    return [{ code: 400, msg: 'The address needs a two-letter country code, such as US or GB' }, null];
  }

  const address = { country };
  const fields = {
    state: text(input.state),
    postal_code: text(input.postalCode || input.postal_code || input.zip),
    city: text(input.city),
    line1: text(input.line1),
    line2: text(input.line2),
  };

  for(const [name, value] of Object.entries(fields)){
    if(value) address[name] = value.slice(0, 200);
  }

  return [null, address];
};

/*
  Tax IDs

  What turns a sale to a business into a reverse-charge or exempt one. Stripe does not check that an
  id is *valid*, only that it is well-formed, so neither does this — a caller that needs validation
  has to do it before asking.
*/
export const parseTaxIds = input => {
  if(input === undefined || input === null) return [null, []];
  if(!Array.isArray(input)) return [{ code: 400, msg: 'taxIds must be a list' }, null];

  const ids = [];
  for(const entry of input){
    const type = typeof entry?.type === 'string' ? entry.type.trim() : '';
    const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
    if(!type || !value) return [{ code: 400, msg: 'Each tax ID needs a type (such as eu_vat) and a value' }, null];
    ids.push({ type, value });
  }

  return [null, ids];
};

/*
  The request

  `defaults` is what the settings say: { currency, includesTax, taxCode, shippingTaxCode }.

  A line with an amount of 0 is kept in the answer — a caller zipping results back onto its cart by
  position must not find one missing — but is never sent, because Stripe rejects a zero amount and
  a free item has no tax on it anyway.
*/
export const parseRequest = (input, defaults = {}) => {
  if(!input || typeof input !== 'object' || Array.isArray(input)){
    return [{ code: 400, msg: 'A calculation request is required' }, null];
  }

  const currency = normaliseCurrency(input.currency || defaults.currency || 'usd');
  if(!isValidCurrency(currency)){
    return [{ code: 400, msg: 'Currency must be a three-letter ISO code, such as usd or gbp' }, null];
  }

  const [addressError, address] = parseAddress(input.address);
  if(addressError) return [addressError, null];

  const [idsError, taxIds] = parseTaxIds(input.taxIds);
  if(idsError) return [idsError, null];

  if(!Array.isArray(input.lines) || !input.lines.length){
    return [{ code: 400, msg: 'At least one line is required' }, null];
  }

  if(input.lines.length > 250){
    return [{ code: 400, msg: 'A calculation takes at most 250 lines' }, null];
  }

  const defaultBehavior = defaults.includesTax ? 'inclusive' : 'exclusive';
  const lines = [];
  const seen = new Set();

  for(const [index, line] of input.lines.entries()){
    if(!line || typeof line !== 'object') return [{ code: 400, msg: `Line ${index + 1} is not an object` }, null];

    if(!isMinorAmount(line.amount)){
      return [{ code: 400, msg: `Line ${index + 1}: amount must be a whole number of the currency's smallest unit` }, null];
    }

    const quantity = line.quantity === undefined ? 1 : line.quantity;
    if(!Number.isSafeInteger(quantity) || quantity < 1){
      return [{ code: 400, msg: `Line ${index + 1}: quantity must be a positive whole number` }, null];
    }

    const reference = line.reference === undefined || line.reference === null || line.reference === ''
      ? `line-${index + 1}`
      : String(line.reference).slice(0, 200);
    if(seen.has(reference)) return [{ code: 400, msg: `Line ${index + 1}: reference "${reference}" is used twice` }, null];
    seen.add(reference);

    const [codeError, resolved] = resolveTaxClass(line.taxClass ?? line.taxCode);
    if(codeError) return [{ code: codeError.code, msg: `Line ${index + 1}: ${codeError.msg}` }, null];

    const taxBehavior = line.taxBehavior === undefined ? defaultBehavior : line.taxBehavior;
    if(!isTaxBehavior(taxBehavior)){
      return [{ code: 400, msg: `Line ${index + 1}: taxBehavior must be one of ${TAX_BEHAVIORS.join(', ')}` }, null];
    }

    lines.push({
      index,
      reference,
      amount: line.amount,
      quantity,
      taxCode: resolved?.code || defaults.taxCode || null,
      taxClass: resolved?.name || defaults.taxClass || null,
      taxBehavior,
    });
  }

  let shipping = null;
  if(input.shipping !== undefined && input.shipping !== null){
    if(!isMinorAmount(input.shipping.amount)){
      return [{ code: 400, msg: "Shipping amount must be a whole number of the currency's smallest unit" }, null];
    }

    const [codeError, resolved] = resolveTaxClass(input.shipping.taxClass ?? input.shipping.taxCode);
    if(codeError) return [{ code: codeError.code, msg: `Shipping: ${codeError.msg}` }, null];

    const taxBehavior = input.shipping.taxBehavior === undefined ? defaultBehavior : input.shipping.taxBehavior;
    if(!isTaxBehavior(taxBehavior)) return [{ code: 400, msg: `Shipping: taxBehavior must be one of ${TAX_BEHAVIORS.join(', ')}` }, null];

    shipping = {
      amount: input.shipping.amount,
      taxCode: resolved?.code || defaults.shippingTaxCode || null,
      taxClass: resolved?.name || 'shipping',
      taxBehavior,
    };
  }

  const taxDate = input.taxDate === undefined ? null : Number(input.taxDate);
  if(taxDate !== null && !Number.isSafeInteger(taxDate)){
    return [{ code: 400, msg: 'taxDate must be a Unix timestamp in seconds' }, null];
  }

  return [null, {
    currency,
    address,
    addressSource: input.addressSource === 'billing' ? 'billing' : 'shipping',
    taxIds,
    lines,
    shipping,
    taxDate,
    customer: typeof input.customer === 'string' && input.customer ? input.customer : null,
  }];
};

/*
  Whether there is anything to ask a provider at all. A cart of free items with no shipping has no
  tax on it by definition, and asking would only spend an API call on a known answer.
*/
export const hasBillableAmount = request => request.lines.some(line => line.amount > 0) || !!(request.shipping && request.shipping.amount > 0);

/*
  What Stripe is sent
*/
export const toStripeParams = request => ({
  currency: request.currency,
  line_items: request.lines.filter(line => line.amount > 0).map(line => ({
    amount: line.amount,
    quantity: line.quantity,
    reference: line.reference,
    tax_behavior: line.taxBehavior,
    ...(line.taxCode ? { tax_code: line.taxCode } : {}),
  })),
  customer_details: {
    address: request.address,
    address_source: request.addressSource,
    ...(request.taxIds.length ? { tax_ids: request.taxIds } : {}),
  },
  ...(request.shipping && request.shipping.amount > 0 ? {
    shipping_cost: {
      amount: request.shipping.amount,
      tax_behavior: request.shipping.taxBehavior,
      ...(request.shipping.taxCode ? { tax_code: request.shipping.taxCode } : {}),
    },
  } : {}),
  ...(request.taxDate ? { tax_date: request.taxDate } : {}),
  ...(request.customer ? { customer: request.customer } : {}),
  expand: ['line_items'],
});

/*
  What comes back

  `collecting` is the answer to "is this site actually charging tax here, or only being told what
  the rate would be". Stripe calculates a rate for every address, and reports `not_collecting` for
  the places the account has no registration — tax there is 0, correctly, and a caller deciding
  whether to show a tax line wants to know the difference between "0% rate" and "not registered".
*/
const NOT_COLLECTING = new Set(['not_collecting', 'not_supported']);

const breakdownFrom = entry => ({
  jurisdiction: entry.jurisdiction?.display_name || null,
  level: entry.jurisdiction?.level || null,
  country: entry.jurisdiction?.country || null,
  state: entry.jurisdiction?.state || null,
  taxType: entry.tax_rate_details?.tax_type || null,
  name: entry.tax_rate_details?.display_name || null,
  rate: entry.tax_rate_details?.percentage_decimal ?? null,
  taxableAmount: entry.taxable_amount ?? 0,
  amount: entry.amount ?? 0,
  inclusive: !!entry.inclusive,
  reason: entry.taxability_reason || null,
});

/*
  One line of a result, in the same shape whichever provider produced it.

  `netAmount` is the amount *without* tax in it: for a tax-inclusive line that is the amount less
  the tax inside it. It is what a return reports as sales, so it is computed here once rather than
  by every report.

  `status` is the part a return cares about. A line with tax on it was `taxed`. One with none, in a
  place the site collects, was `exempt` (zero-rated, or an exempt product) and is reported as such.
  One in a place the site is not registered was `not_collecting`, and appears on no return at all.
*/
export const lineResult = (line, tax, collecting) => ({
  reference: line.reference ?? '__shipping__',
  amount: line.amount,
  quantity: line.quantity ?? 1,
  tax,
  netAmount: line.taxBehavior === 'inclusive' ? line.amount - tax : line.amount,
  taxBehavior: line.taxBehavior,
  taxCode: line.taxCode || null,
  taxClass: line.taxClass || null,
  status: line.amount === 0 ? 'zero' : tax > 0 ? 'taxed' : collecting ? 'exempt' : 'not_collecting',
});

export const fromCalculation = (calculation, request) => {
  const returned = new Map((calculation.line_items?.data || []).map(item => [item.reference, item]));
  const breakdown = (calculation.tax_breakdown || []).map(breakdownFrom);
  const collecting = breakdown.length > 0 && breakdown.some(entry => !NOT_COLLECTING.has(entry.reason));

  return {
    provider: 'stripe',
    calculationId: calculation.id || null,
    expiresAt: calculation.expires_at ? new Date(calculation.expires_at * 1000).toISOString() : null,
    livemode: !!calculation.livemode,
    currency: calculation.currency || request.currency,
    taxAmountExclusive: calculation.tax_amount_exclusive ?? 0,
    taxAmountInclusive: calculation.tax_amount_inclusive ?? 0,
    tax: (calculation.tax_amount_exclusive ?? 0) + (calculation.tax_amount_inclusive ?? 0),
    total: calculation.amount_total ?? 0,
    collecting,
    lines: request.lines.map(line => {
      const item = returned.get(line.reference);
      return lineResult(line, item?.amount_tax ?? 0, collecting);
    }),
    shipping: request.shipping ? {
      ...lineResult({ ...request.shipping, quantity: 1 }, calculation.shipping_cost?.amount_tax ?? 0, collecting),
    } : null,
    breakdown,
  };
};

/*
  The answer for a request that was never sent, in the same shape as one that was.
*/
export const emptyCalculation = request => ({
  provider: 'stripe',
  calculationId: null,
  expiresAt: null,
  livemode: false,
  currency: request.currency,
  taxAmountExclusive: 0,
  taxAmountInclusive: 0,
  tax: 0,
  total: request.lines.reduce((sum, line) => sum + line.amount, 0) + (request.shipping?.amount || 0),
  collecting: false,
  lines: request.lines.map(line => lineResult(line, 0, false)),
  shipping: request.shipping ? lineResult({ ...request.shipping, quantity: 1 }, 0, false) : null,
  breakdown: [],
});
