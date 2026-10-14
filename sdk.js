/*
  Server-side entry point — what another extension imports to find out what tax to charge, and to
  record that it did.

  ```js
  import { calculateTax, recordTransaction, reverseTransaction } from 'kempo-tax/sdk';

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
  const [, sale] = await recordTransaction({ calculationId: quote.calculationId, reference: order.id });

  // and on a refund, whole or in part:
  await reverseTransaction({ transactionId: sale.transactionId, reference: `${order.id}-refund-1`, amount: 1000 });
  ```

  The caller supplies the classification: this extension does not know what a "product" is and has
  no catalog, which is what lets a subscription, a donation or an invoice use it exactly as a
  store checkout does.

  As in kempo's other extensions these are the *data* operations, with no permission checks of
  their own. The routes under public/api enforce who may do what; anything calling in here is
  server-side code that has already decided it is allowed.

  Hooks fired (notification mode, via kempo's triggerHook): `tax:recorded`, `tax:reversed`, and
  `tax:uncollected-home-sale`.
*/

export { default as calculateTax } from './server/utils/tax/calculate.js';
export { recordTransaction, reverseTransaction } from './server/utils/tax/transactions.js';

export { TAX_CLASSES, TAX_BEHAVIORS, resolveTaxCode, resolveTaxClass, parseAddress } from './server/utils/tax/shape.js';
export { parsePercent, formatPercent } from './server/utils/tax/percent.js';

export { listRates, createRate, updateRate, deleteRate } from './server/utils/rates/store.js';
export { cleanRate, presentRate } from './server/utils/rates/validate.js';

export { listEntries, entriesInPeriod, getEntry, getEntryByReference } from './server/utils/ledger/store.js';
export { buildReport, quarterRange } from './server/utils/ledger/report.js';

export { readConfig, DEFAULTS, OWNER } from './server/utils/config/settings.js';
export { activeProvider, getProvider, listProviders } from './server/providers/index.js';
