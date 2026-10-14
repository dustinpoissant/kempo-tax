import { triggerHook } from 'kempo/server/sdk.js';
import { getProvider } from '../../providers/index.js';
import { readConfig } from '../config/settings.js';
import { entryFromResult, reversalFromEntry } from '../ledger/entries.js';
import { getQuote } from '../ledger/quotes.js';
import {
  getEntry, getEntryByProviderRef, getEntryByQuoteId, getEntryByReference, insertEntry, reversedTotal,
} from '../ledger/store.js';

/*
  Recording a sale, and reversing one.

  A calculation is a quote. These are what make it count: a recorded sale is a row in this site's
  ledger — which is what its returns are built from — and, at Stripe, a transaction that appears in
  their reports and advances a registration threshold. Neither is called until the payment is
  final; recording a sale that then fails to take payment reports tax on money nobody paid.

  Both are idempotent on `reference`, so a webhook delivered twice, or a retry after a timeout,
  records once. Recording the same *calculation* under two different references is refused rather
  than counted twice, which is the mistake a caller makes when it loses track of an order.

  The figures always come from the stored calculation. The caller supplies an id and a reference;
  it cannot supply an amount, because a ledger that says whatever it was told is not a ledger.
*/

const REFERENCE_MAX = 500;

const cleanReference = value => {
  const reference = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if(!reference) return [{ code: 400, msg: 'A reference is required — your own id for the sale, unique to it' }, null];
  if(reference.length > REFERENCE_MAX) return [{ code: 400, msg: `A reference is at most ${REFERENCE_MAX} characters` }, null];
  return [null, reference];
};

/*
  The id the outside world holds for a ledger entry. Prefixed so it cannot be mistaken for a
  provider's id or a bare number.
*/
export const publicId = entry => `taxe_${entry.id}`;

const present = (entry, created) => ({
  transactionId: publicId(entry),
  entryId: entry.id,
  kind: entry.kind,
  reference: entry.reference,
  provider: entry.provider,
  providerTransactionId: entry.providerRef,
  currency: entry.currency,
  salesAmount: entry.salesAmount,
  taxableAmount: entry.taxableAmount,
  exemptAmount: entry.exemptAmount,
  uncollectedAmount: entry.uncollectedAmount,
  taxAmount: entry.taxAmount,
  occurredAt: entry.occurredAt instanceof Date ? entry.occurredAt.toISOString() : entry.occurredAt,
  created,
});

const fire = async (event, data) => {
  const [error] = await triggerHook(event, data);
  if(error) console.warn(`[kempo-tax] Could not fire ${event}: ${error.msg}`);
};

/*
  The thing that goes wrong silently: the site is based in a place, a sale is made *there*, and
  nothing was collected because no rate covers it. Without this, the first sign is a return that
  is short. Said at the moment it happens, to whoever listens.
*/
const warnIfHomeSale = async entry => {
  const config = await readConfig();
  if(!config.homeCountry || entry.country !== config.homeCountry) return;
  if(config.homeState && entry.state !== config.homeState) return;
  if(entry.uncollectedAmount <= 0) return;

  console.warn(`[kempo-tax] A sale to ${entry.state || entry.country} (your home) was recorded with no tax collected. Add a rate for it, or check your registration — reference ${entry.reference}.`);
  await fire('tax:uncollected-home-sale', { entry: present(entry, true) });
};

export const recordTransaction = async ({ calculationId, reference, occurredAt } = {}) => {
  if(typeof calculationId !== 'string' || !calculationId.trim()){
    return [{ code: 400, msg: 'A calculationId is required — the one calculateTax returned' }, null];
  }

  const [referenceError, cleaned] = cleanReference(reference);
  if(referenceError) return [referenceError, null];

  const [lookupError, existing] = await getEntryByReference('sale', cleaned);
  if(lookupError) return [lookupError, null];
  if(existing) return [null, present(existing, false)];

  const [quoteError, quote] = await getQuote(calculationId.trim());
  if(quoteError) return [quoteError, null];

  const [usedError, used] = await getEntryByQuoteId(quote.id);
  if(usedError) return [usedError, null];
  if(used){
    return [{ code: 409, msg: `That calculation was already recorded as "${used.reference}" — a calculation records one sale` }, null];
  }

  let providerRef = null;
  if(quote.provider !== 'rates'){
    const [providerError, provider] = getProvider(quote.provider);
    if(providerError) return [providerError, null];

    const [error, recorded] = await provider.recordTransaction({ calculationId: quote.providerRef, reference: cleaned });
    if(error) return [error, null];
    providerRef = recorded.transactionId;
  }

  const entry = entryFromResult(quote.result, {
    address: quote.address || {},
    reference: cleaned,
    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    quoteId: quote.id,
    provider: quote.provider,
    providerRef,
    livemode: quote.result.livemode,
  });

  const [insertError, saved] = await insertEntry(entry);
  if(insertError) return [insertError, null];

  if(saved.created){
    await fire('tax:recorded', { entry: present(saved.entry, true) });
    await warnIfHomeSale(saved.entry);
  }

  return [null, present(saved.entry, saved.created)];
};

/*
  `transactionId` is what `recordTransaction` returned. A provider's own id is accepted too, since a
  caller that stored that is not wrong to use it.

  `amount` is optional and in the currency's minor unit, positive: omit it to reverse whatever is
  left of the sale, give it to reverse that much of the total (tax included) for a partial refund.

  `reference` is the id of the *reversal* — a refund of its own, distinct from the sale's.
*/
export const reverseTransaction = async ({ transactionId, reference, amount, occurredAt, note } = {}) => {
  if(typeof transactionId !== 'string' || !transactionId.trim()){
    return [{ code: 400, msg: 'A transactionId is required — the one recordTransaction returned' }, null];
  }

  const [referenceError, cleaned] = cleanReference(reference);
  if(referenceError) return [referenceError, null];

  if(amount !== undefined && amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)){
    return [{ code: 400, msg: 'A partial amount must be a positive whole number of the currency\'s smallest unit' }, null];
  }

  const [existingError, existing] = await getEntryByReference('reversal', cleaned);
  if(existingError) return [existingError, null];
  if(existing) return [null, present(existing, false)];

  const id = transactionId.trim();
  const match = /^taxe_(\d+)$/.exec(id);
  const [originalError, original] = match
    ? await getEntry(Number(match[1]))
    : await getEntryByProviderRef(id);
  if(originalError) return [originalError, null];
  if(!original) return [{ code: 404, msg: 'No such recorded sale' }, null];
  if(original.kind !== 'sale') return [{ code: 400, msg: 'Only a sale can be reversed, not another reversal' }, null];

  const [reversedError, reversed] = await reversedTotal(original.id);
  if(reversedError) return [reversedError, null];

  const total = original.salesAmount + original.taxAmount;
  const remaining = total - reversed;

  if(remaining <= 0) return [{ code: 409, msg: 'That sale has already been fully reversed' }, null];
  if(amount && amount > remaining){
    return [{ code: 400, msg: `Only ${remaining} of that sale is left to reverse` }, null];
  }

  /*
    "Everything" means everything that is left. When nothing has been reversed that is the whole
    sale and is recorded as such; after a partial refund it is the remainder, as an amount.
  */
  const reverseAmount = amount || (reversed > 0 ? remaining : undefined);

  if(original.provider !== 'rates' && original.providerRef){
    const [providerError, provider] = getProvider(original.provider);
    if(providerError) return [providerError, null];

    const [error] = await provider.reverseTransaction({
      transactionId: original.providerRef,
      reference: cleaned,
      amount: reverseAmount,
    });
    if(error) return [error, null];
  }

  const entry = reversalFromEntry(original, {
    amount: reverseAmount,
    reference: cleaned,
    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    note,
  });

  const [insertError, saved] = await insertEntry(entry);
  if(insertError) return [insertError, null];

  if(saved.created) await fire('tax:reversed', { entry: present(saved.entry, true), original: present(original, false) });

  return [null, present(saved.entry, saved.created)];
};
