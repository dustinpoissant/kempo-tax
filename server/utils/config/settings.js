import { getSetting } from 'kempo/server/sdk.js';
import { isValidCurrency, normaliseCurrency } from '../tax/shape.js';

/*
  Reading the settings, and validating them, in one place.

  Everything on the settings screen is editable, and a value that is not what it claims to be must
  not reach Stripe: a tax code that is not a tax code produces an error about the account rather
  than about the typo. So every value the rest of the extension sees has been through a `normalise*`
  below and is known-good, with a working default behind it rather than an error.

  The credential is deliberately not here. The provider module reads its own, because its name and
  number are the provider's business — see server/providers/stripe.js.
*/

export const OWNER = 'kempo-tax';

export const DEFAULTS = {
  provider: 'stripe',
  currency: 'usd',
  includesTax: false,
  taxCode: '',
  shippingTaxCode: '',
};

export const TAX_CODE = /^txcd_\d{8}$/;

/*
  A blank tax code is a legitimate stored value ("use Stripe's own default"), so it passes. Anything
  else must be a real-looking id, or it falls back to blank rather than being sent.
*/
export const normaliseTaxCode = value => {
  const trimmed = String(value || '').trim();
  return TAX_CODE.test(trimmed) ? trimmed : '';
};

export const normaliseDefaultCurrency = value => {
  const currency = normaliseCurrency(value);
  return isValidCurrency(currency) ? currency : DEFAULTS.currency;
};

const asBoolean = value => value === true || value === 'true';

export const readConfig = async () => {
  const read = async (name, fallback) => {
    const [error, value] = await getSetting(OWNER, name, fallback);
    return error ? fallback : value;
  };

  const [provider, currency, includesTax, taxCode, shippingTaxCode] = await Promise.all([
    read('provider', DEFAULTS.provider),
    read('currency', DEFAULTS.currency),
    read('prices_include_tax', DEFAULTS.includesTax),
    read('default_tax_code', DEFAULTS.taxCode),
    read('shipping_tax_code', DEFAULTS.shippingTaxCode),
  ]);

  return {
    provider: String(provider || DEFAULTS.provider),
    currency: normaliseDefaultCurrency(currency),
    includesTax: asBoolean(includesTax),
    taxCode: normaliseTaxCode(taxCode),
    shippingTaxCode: normaliseTaxCode(shippingTaxCode),
  };
};
