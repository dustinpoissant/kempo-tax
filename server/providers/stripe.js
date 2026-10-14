import Stripe from 'stripe';
import { getSetting } from 'kempo/server/sdk.js';
import { fromCalculation, toStripeParams } from '../utils/tax/shape.js';

/*
  The Stripe Tax module. Nothing outside this file knows Stripe exists.

  The contract a provider implements is documented in server/providers/index.js. This is the only
  one that ships; the shape is what makes TaxJar, Avalara or a rate table a new file here rather
  than a rewrite of everything that ever called `calculateTax`.

  One decision worth stating because it is the one somebody would otherwise undo: **no `apiVersion`
  is pinned.** The SDK sends the version it was built and tested against, which is the one this code
  was written for. Naming a different one is how you get a response shape the installed SDK does not
  expect.
*/

export const name = 'stripe';
export const label = 'Stripe Tax';

/*
  The settings holding this provider's credentials, in the order a settings screen renders them.
  Declared here rather than in the screen so a second provider's fields arrive with it. Every name
  must also exist in kempo-config.json — a static test checks that.
*/
export const credentialFields = [
  {
    name: 'stripe_secret_key',
    label: 'Secret key',
    type: 'secret',
    placeholder: 'sk_test_…',
    help: 'From Developers → API keys in Stripe. It is encrypted here and never sent back to a browser. A restricted key (rk_…) with read and write access to Tax is enough, and safer.',
  },
];

/*
  The key, and where it came from.

  This extension's own setting wins. If it is blank and kempo-payments is installed, that one is
  used instead — somebody running both has one Stripe account, and making them paste the same key
  twice is how the two drift apart the day one is rotated. Read at call time and never cached, for
  the same reason: a rotated key must take effect without a restart.

  kempo-payments is never *required*: a missing or unreadable setting is just an empty string.
*/
const secretKey = async () => {
  const read = async (owner, key) => {
    const [error, value] = await getSetting(owner, key, '');
    return error ? '' : String(value || '').trim();
  };

  const own = await read('kempo-tax', 'stripe_secret_key');
  if(own) return { key: own, source: 'own' };

  const shared = await read('kempo-payments', 'stripe_secret_key');
  if(shared) return { key: shared, source: 'payments' };

  return { key: '', source: null };
};

/*
  One client per secret key, kept between requests and rebuilt the moment the key changes.
*/
let cached = { key: null, client: null };

const clientFor = key => {
  if(cached.key !== key) cached = { key, client: new Stripe(key) };
  return cached.client;
};

const withClient = async () => {
  const { key } = await secretKey();
  if(!key) return [{ code: 409, msg: 'Stripe is not connected yet — add a secret key on the tax settings screen' }, null];
  return [null, clientFor(key)];
};

/*
  Errors

  Two kinds of message come back from Stripe. One is written for a person and passes through whole;
  everything else is written for whoever set the account up, can be a good deal longer than a caller
  should hand a customer, and is logged in full while only the first sentence goes back.

  `customer_tax_location_invalid` gets its own wording because it is the one a caller can actually
  fix and the stock message is about Stripe's internals: the address was understood but no taxing
  location could be derived from it.
*/
const MAX_MESSAGE = 200;

export const failure = error => {
  const code = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : 502;

  if(error?.code === 'customer_tax_location_invalid'){
    return [{ code: 422, msg: 'A tax location could not be worked out from that address — check the country, state and postal code' }, null];
  }

  const message = error?.message || 'The tax service rejected the request';
  console.warn(`[kempo-tax] Stripe ${error?.type || 'error'}: ${message}`);

  const firstSentence = message.split(/(?<=[.!?])\s/)[0];
  return [{ code, msg: firstSentence.length > MAX_MESSAGE ? `${firstSentence.slice(0, MAX_MESSAGE - 1)}…` : firstSentence }, null];
};

/*
  Status

  `mode` is read off the key's own prefix rather than kept as a toggle: a toggle can disagree with
  the key, a prefix cannot. A restricted key (rk_live_ / rk_test_) is handled the same way.
*/
export const status = async () => {
  const { key, source } = await secretKey();
  const mode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : null;

  return [null, {
    provider: name,
    label,
    configured: !!key,
    keySource: source,
    mode,
    livemode: mode === 'live',
    fields: { stripe_secret_key: source === 'own' },
  }];
};

/*
  What Stripe itself says about the account's tax setup: whether Stripe Tax has been switched on,
  and what is still missing if not. Asked live, since it is the answer to "why is nothing being
  collected" and a stale one would send somebody looking in the wrong place.
*/
export const accountSettings = async () => {
  const [error, stripe] = await withClient();
  if(error) return [error, null];

  try {
    const settings = await stripe.tax.settings.retrieve();

    return [null, {
      active: settings.status === 'active',
      status: settings.status,
      missingFields: settings.status_details?.pending?.missing_fields || [],
      headOfficeCountry: settings.head_office?.address?.country || null,
      defaultTaxCode: settings.defaults?.tax_code || null,
      defaultTaxBehavior: settings.defaults?.tax_behavior || null,
      livemode: !!settings.livemode,
    }];
  } catch(err) {
    return failure(err);
  }
};

/*
  Calculate

  The request has already been through `parseRequest`, so everything reaching here is the right
  shape; this only translates and calls.
*/
export const calculate = async request => {
  const [error, stripe] = await withClient();
  if(error) return [error, null];

  try {
    const calculation = await stripe.tax.calculations.create(toStripeParams(request));
    return [null, fromCalculation(calculation, request)];
  } catch(err) {
    return failure(err);
  }
};

/*
  Record

  A calculation is only an estimate. Nothing appears in Stripe's tax reports, and nothing counts
  toward a registration threshold, until it is turned into a transaction — which is what the
  merchant files from. Calls for it should be made when the sale is *final* (the payment has
  succeeded), not when it was merely quoted.

  The reference is the caller's own id for the sale and must be unique: Stripe refuses a second
  transaction with the same one, which is also what makes recording the same order twice harmless.
  It doubles as the idempotency key for the same reason.
*/
export const recordTransaction = async ({ calculationId, reference }) => {
  const [error, stripe] = await withClient();
  if(error) return [error, null];

  try {
    const transaction = await stripe.tax.transactions.createFromCalculation({
      calculation: calculationId,
      reference,
    }, { idempotencyKey: `kempo-tax:record:${reference}` });

    return [null, {
      transactionId: transaction.id,
      reference: transaction.reference,
      type: transaction.type,
      livemode: !!transaction.livemode,
    }];
  } catch(err) {
    return failure(err);
  }
};

/*
  Reverse

  For a refund. Without `amount` the whole sale is reversed; with it, that much of the *tax-inclusive*
  total is — Stripe works out the tax portion. Its API takes a partial reversal as a negative flat
  amount, which is an implementation detail callers should not have to know, so a positive amount is
  accepted here and signed on the way out.
*/
export const reverseTransaction = async ({ transactionId, reference, amount }) => {
  const [error, stripe] = await withClient();
  if(error) return [error, null];

  try {
    const reversal = await stripe.tax.transactions.createReversal({
      original_transaction: transactionId,
      reference,
      ...(amount ? { mode: 'partial', flat_amount: -Math.abs(amount) } : { mode: 'full' }),
    }, { idempotencyKey: `kempo-tax:reverse:${reference}` });

    return [null, {
      transactionId: reversal.id,
      reference: reversal.reference,
      type: reversal.type,
      livemode: !!reversal.livemode,
    }];
  } catch(err) {
    return failure(err);
  }
};

/*
  Where tax is actually being collected: the registrations on the Stripe account. Read-only, on
  purpose. Registering with a tax authority is a legal act with deadlines and filing obligations
  attached, and Stripe's dashboard walks through that properly; this extension only reports.
*/
export const listRegistrations = async () => {
  const [error, stripe] = await withClient();
  if(error) return [error, null];

  try {
    const registrations = await stripe.tax.registrations.list({ status: 'all', limit: 100 }).autoPagingToArray({ limit: 500 });

    return [null, registrations.map(registration => {
      const options = registration.country_options?.[String(registration.country).toLowerCase()] || {};

      return {
        id: registration.id,
        country: registration.country,
        state: options.state || null,
        type: options.type || null,
        status: registration.status,
        activeFrom: registration.active_from ? new Date(registration.active_from * 1000).toISOString() : null,
        expiresAt: registration.expires_at ? new Date(registration.expires_at * 1000).toISOString() : null,
      };
    })];
  } catch(err) {
    return failure(err);
  }
};

/*
  Stripe's tax categories. About six hundred of them and they change rarely, so one fetch is kept
  for an hour — the admin screen's picker would otherwise spend several API calls per page load.
*/
let taxCodes = { at: 0, list: null, key: null };

export const listTaxCodes = async () => {
  const { key } = await secretKey();
  if(taxCodes.list && taxCodes.key === key && Date.now() - taxCodes.at < 60 * 60 * 1000) return [null, taxCodes.list];

  const [error, stripe] = await withClient();
  if(error) return [error, null];

  try {
    const codes = await stripe.taxCodes.list({ limit: 100 }).autoPagingToArray({ limit: 2000 });
    const list = codes.map(code => ({ id: code.id, name: code.name, description: code.description }));
    taxCodes = { at: Date.now(), list, key };
    return [null, list];
  } catch(err) {
    return failure(err);
  }
};
