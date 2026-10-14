/*
  Server-side entry point — what another extension imports to find out what tax to charge.

  ```js
  import { calculateTax, recordTransaction } from 'kempo-tax/sdk';

  const [error, quote] = await calculateTax({
    address: order.shippingAddress,           // { country, state, postalCode, city, line1 }
    lines: order.items.map(item => ({
      amount: item.price * item.quantity,     // minor units — 4999 is $49.99
      reference: item.sku,
      taxClass: item.taxClass,                // 'physical', 'digital', 'saas', … or a txcd_ id
    })),
    shipping: { amount: order.shippingCost },
  });

  // charge quote.total — then, once the payment has *succeeded*:
  await recordTransaction({ calculationId: quote.calculationId, reference: order.id });
  ```

  The caller supplies the classification: this extension does not know what a "product" is and has
  no catalog, which is what lets a subscription, a donation or an invoice use it exactly as a
  store checkout does.

  As in kempo's other extensions these are the *data* operations, with no permission checks of
  their own. The routes under public/api enforce who may do what; anything calling in here is
  server-side code that has already decided it is allowed.
*/

export { default as calculateTax } from './server/utils/tax/calculate.js';
export { recordTransaction, reverseTransaction } from './server/utils/tax/transactions.js';

export { TAX_CLASSES, TAX_BEHAVIORS, resolveTaxCode, parseAddress } from './server/utils/tax/shape.js';

export { readConfig, DEFAULTS, OWNER } from './server/utils/config/settings.js';
export { activeProvider, getProvider, listProviders } from './server/providers/index.js';
