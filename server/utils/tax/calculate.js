import { activeProvider } from '../../providers/index.js';
import { readConfig } from '../config/settings.js';
import { saveQuote } from '../ledger/quotes.js';
import { emptyCalculation, hasBillableAmount, parseRequest } from './shape.js';

/*
  Work out the tax on a set of items shipped or billed to an address.

  ```js
  import { calculateTax } from 'kempo-tax/sdk';

  const [error, result] = await calculateTax({
    address: { country: 'US', state: 'VT', postalCode: '05401' },
    lines: [
      { amount: 4999, reference: 'sku-1', taxClass: 'physical' },
      { amount: 1500, reference: 'sku-2', quantity: 3, taxClass: 'digital' },
    ],
    shipping: { amount: 800 },
  });
  // result.tax    — what to add (or, for inclusive prices, what is already inside)
  // result.total  — the amount to charge, which is what createPayment takes
  ```

  This is a *quote*. It is safe to call as often as the page changes, and nothing is reported
  anywhere until the sale is recorded with `recordTransaction`. The result's `calculationId` is
  what that call takes: this site keeps what it worked out, and records from that, never from
  figures handed back to it.

  A provider that is not connected gets a 409 rather than a silent zero. A silent zero is the worse
  failure: a checkout that quietly stops charging tax for a week because a key expired is a
  liability that grows with every order, while a loud one is fixed the same afternoon.
*/
export default async input => {
  const config = await readConfig();

  const [requestError, request] = parseRequest(input, {
    currency: config.currency,
    includesTax: config.includesTax,
    taxClass: config.taxClass,
  });
  if(requestError) return [requestError, null];

  const [providerError, provider] = await activeProvider();
  if(providerError) return [providerError, null];

  if(!hasBillableAmount(request)) return [null, emptyCalculation(request)];

  const [error, result] = await provider.calculate(request);
  if(error) return [error, null];

  const providerRef = result.calculationId;

  const [saveError, quoteId] = await saveQuote({
    provider: result.provider,
    providerRef,
    currency: result.currency,
    result,
    address: request.address,
    expiresAt: result.expiresAt ? new Date(result.expiresAt) : undefined,
  });
  if(saveError) return [saveError, null];

  return [null, { ...result, calculationId: quoteId, providerCalculationId: providerRef || null }];
};
