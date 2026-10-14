import { allocate, roundDiv } from '../tax/percent.js';

/*
  Turning a quote into a ledger entry, and a ledger entry into its reversal. Pure.

  The ledger never takes amounts from the caller. A sale is recorded *by quote id*, and these
  functions read the figures out of what this site itself calculated at the time — so a caller that
  is wrong, or lying, cannot make the record say something the site never worked out.
*/

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

export const entryFromResult = (result, { address = {}, reference, occurredAt, quoteId, provider, providerRef, livemode }) => {
  const lines = [...(result.lines || []), ...(result.shipping ? [result.shipping] : [])];
  const priced = lines.filter(line => line.status !== 'zero');

  const taxed = priced.filter(line => line.status === 'taxed');
  const exempt = priced.filter(line => line.status === 'exempt');
  const uncollected = priced.filter(line => line.status === 'not_collecting');

  return {
    kind: 'sale',
    reference,
    originalEntryId: null,
    provider: provider || result.provider,
    providerRef: providerRef || null,
    quoteId: quoteId || null,
    livemode: livemode ?? !!result.livemode,
    currency: result.currency,
    salesAmount: sum(priced, line => line.netAmount),
    taxableAmount: sum(taxed, line => line.netAmount),
    exemptAmount: sum(exempt, line => line.netAmount),
    uncollectedAmount: sum(uncollected, line => line.netAmount),
    taxAmount: result.tax,
    jurisdictions: (result.breakdown || [])
      .filter(entry => entry.reason !== 'not_collecting' && entry.reason !== 'not_supported')
      .map(entry => ({
        jurisdiction: entry.jurisdiction,
        level: entry.level,
        country: entry.country,
        state: entry.state,
        name: entry.name,
        rate: entry.rate,
        taxableAmount: entry.taxableAmount,
        amount: entry.amount,
        reason: entry.reason,
      })),
    country: String(address.country || '').toUpperCase(),
    state: String(address.state || '').toUpperCase(),
    postalCode: String(address.postal_code || address.postalCode || ''),
    occurredAt,
  };
};

/*
  A reversal: the same figures, negated. Whole, or in proportion to a refund of the tax-inclusive
  total. `amount` is that refund; omit it to reverse everything.

  Proportional, because a partial refund of a mixed order cannot be traced to particular lines from
  an amount alone, and a proportional reversal is the conventional treatment and the one a return
  can defend.

  The parts are made to add up. The tax is scaled and rounded first; the sales figure is whatever
  is left of the refund; and the sales figure is then split across taxable, exempt and uncollected
  by largest remainder. So a reversal always satisfies `sales + tax = -amount` exactly, which is
  what lets "how much of this sale is left to reverse" be answered with plain subtraction.
*/
export const reversalFromEntry = (original, { amount, reference, occurredAt, note }) => {
  const total = original.salesAmount + original.taxAmount;
  const whole = amount === undefined || amount === null;

  let taxAmount;
  let salesAmount;
  let split;

  if(whole){
    taxAmount = -original.taxAmount;
    salesAmount = -original.salesAmount;
    split = [-original.taxableAmount, -original.exemptAmount, -original.uncollectedAmount];
  } else {
    const share = value => roundDiv(BigInt(value) * BigInt(amount), total);
    taxAmount = total === 0 ? 0 : -share(original.taxAmount);
    salesAmount = -amount - taxAmount;

    const parts = [original.taxableAmount, original.exemptAmount, original.uncollectedAmount];
    split = allocate(
      parts.map(part => ({ numerator: BigInt(part) * BigInt(-salesAmount), denominator: BigInt(Math.max(original.salesAmount, 1)) })),
      -salesAmount,
    ).map(value => -value);
  }

  const scaleLine = value => (whole ? -value : total === 0 ? 0 : -roundDiv(BigInt(value) * BigInt(amount), total));

  /*
    A jurisdiction's tax is spread so the layers add up to the reversal's tax, for the same reason.
    Only when they added up to the original's tax to begin with; otherwise each is scaled alone.
  */
  const layers = original.jurisdictions || [];
  const layerTotal = layers.reduce((sum, entry) => sum + entry.amount, 0);
  const layerAmounts = !whole && layers.length && layerTotal === original.taxAmount && original.taxAmount !== 0
    ? allocate(layers.map(entry => ({ numerator: BigInt(entry.amount) * BigInt(-taxAmount), denominator: BigInt(original.taxAmount) })), -taxAmount).map(value => -value)
    : layers.map(entry => scaleLine(entry.amount));

  return {
    kind: 'reversal',
    reference,
    originalEntryId: original.id,
    provider: original.provider,
    providerRef: null,
    quoteId: original.quoteId,
    livemode: original.livemode,
    currency: original.currency,
    salesAmount,
    taxableAmount: split[0],
    exemptAmount: split[1],
    uncollectedAmount: split[2],
    taxAmount,
    jurisdictions: layers.map((entry, index) => ({
      ...entry,
      taxableAmount: scaleLine(entry.taxableAmount),
      amount: layerAmounts[index],
    })),
    country: original.country,
    state: original.state,
    postalCode: original.postalCode,
    note: note || null,
    occurredAt,
  };
};
