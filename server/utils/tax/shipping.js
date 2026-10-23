import { activeProvider } from '../../providers/index.js';
import { readConfig } from '../config/settings.js';
import { parseRequest } from './shape.js';

/*
  Whether shipping is taxed at an address: the same calculation the checkout uses, asked twice, once for a
  sample of goods and once for the same goods with a sample shipping charge, and the difference is the tax on
  the shipping. That covers a shipping charge taxed in full, one taxed in proportion to the goods, one not taxed,
  and whatever a connected provider decides from its own tax code.

  Nothing is saved: this is a question, not a quote, so it leaves no quote in the ledger. Returns [null, { taxable,
  tax }] with `tax` the tax on the sample shipping. An error (the address is not complete, a key is wrong) means
  unknown, which the caller should not treat as not taxable.
*/
const SAMPLE = 10000;

export const shippingTax = async ({ address, currency }) => {
  const config = await readConfig();
  const defaults = { currency: config.currency, includesTax: config.includesTax, taxClass: config.taxClass };
  const goods = [{ amount: SAMPLE, reference: 'sample-goods' }];

  const [goodsError, goodsRequest] = parseRequest({ address, currency, lines: goods }, defaults);
  if(goodsError) return [goodsError, null];
  const [withError, withRequest] = parseRequest({ address, currency, lines: goods, shipping: { amount: SAMPLE, reference: 'sample-shipping' } }, defaults);
  if(withError) return [withError, null];

  const [providerError, provider] = await activeProvider();
  if(providerError) return [providerError, null];

  const [alone, goodsOnly] = await provider.calculate(goodsRequest);
  if(alone) return [alone, null];
  const [both, withShipping] = await provider.calculate(withRequest);
  if(both) return [both, null];

  const tax = Math.max(0, withShipping.tax - goodsOnly.tax);
  return [null, { taxable: tax > 0, tax }];
};
