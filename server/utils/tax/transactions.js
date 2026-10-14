import { activeProvider } from '../../providers/index.js';

/*
  Recording a sale, and reversing one.

  A calculation is a quote. These are what make it count: a recorded transaction is what appears in
  Stripe's tax reports, what advances a registration threshold, and what a return is filed from.
  Neither is called until the payment is final — recording a sale that then fails to take payment
  reports tax on money nobody paid.

  Both are idempotent on `reference`, so a webhook delivered twice, or a retry after a timeout,
  records once rather than twice.
*/

const REFERENCE_MAX = 500;

const cleanReference = value => {
  const reference = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if(!reference) return [{ code: 400, msg: 'A reference is required — your own id for the sale, unique to it' }, null];
  if(reference.length > REFERENCE_MAX) return [{ code: 400, msg: `A reference is at most ${REFERENCE_MAX} characters` }, null];
  return [null, reference];
};

/*
  A calculation expires — Stripe keeps one for 90 days — so a sale that completes later than that
  has to be calculated again first. The provider's own message says so when it happens.
*/
export const recordTransaction = async ({ calculationId, reference } = {}) => {
  if(typeof calculationId !== 'string' || !calculationId.trim()){
    return [{ code: 400, msg: 'A calculationId is required — the one calculateTax returned' }, null];
  }

  const [referenceError, cleaned] = cleanReference(reference);
  if(referenceError) return [referenceError, null];

  const [providerError, provider] = await activeProvider();
  if(providerError) return [providerError, null];

  return provider.recordTransaction({ calculationId: calculationId.trim(), reference: cleaned });
};

/*
  `amount` is optional and in the currency's minor unit, positive: omit it to reverse the whole
  sale, give it to reverse that much of the total (tax included) for a partial refund.

  `reference` here is the id of the *reversal*, not of the sale — a refund of its own, distinct from
  the original, or Stripe will treat the two as the same event.
*/
export const reverseTransaction = async ({ transactionId, reference, amount } = {}) => {
  if(typeof transactionId !== 'string' || !transactionId.trim()){
    return [{ code: 400, msg: 'A transactionId is required — the one recordTransaction returned' }, null];
  }

  const [referenceError, cleaned] = cleanReference(reference);
  if(referenceError) return [referenceError, null];

  if(amount !== undefined && amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)){
    return [{ code: 400, msg: 'A partial amount must be a positive whole number of the currency\'s smallest unit' }, null];
  }

  const [providerError, provider] = await activeProvider();
  if(providerError) return [providerError, null];

  return provider.reverseTransaction({ transactionId: transactionId.trim(), reference: cleaned, amount: amount || undefined });
};
