import { getSetting } from 'kempo/server/sdk.js';
import { TAX_CLASSES, isValidCurrency, normaliseCurrency } from '../tax/shape.js';

/*
  Reading the settings, and validating them, in one place.

  Everything on the settings screen is editable, and a value that is not what it claims to be must
  not reach a calculation: a tax code that is not a tax code produces an error about the account
  rather than about the typo. So every value the rest of the extension sees has been through a
  `normalise*` below and is known-good, with a working default behind it rather than an error.

  The Stripe key is deliberately not here. The provider module reads its own, because its name and
  number are the provider's business — see server/providers/stripe.js.
*/

export const OWNER = 'kempo-tax';

export const ROUNDING = ['line', 'invoice'];

export const DEFAULTS = {
  provider: 'stripe',
  currency: 'usd',
  includesTax: false,
  taxClass: 'physical',
  homeCountry: '',
  homeState: '',
  homeCity: '',
  homePostal: '',
  rounding: 'line',
  originSourcingStates: [],
};

export const TAX_CODE = /^txcd_\d{8}$/;

/*
  A class name, or a raw category id. Anything else falls back to the default rather than being
  passed on, because Stripe would reject an unknown id with a message about the account instead of
  about the typo.
*/
export const normaliseDefaultClass = value => {
  const cleaned = String(value || '').trim().toLowerCase();
  return Object.hasOwn(TAX_CLASSES, cleaned) || TAX_CODE.test(cleaned) ? cleaned : DEFAULTS.taxClass;
};

export const normaliseDefaultCurrency = value => {
  const currency = normaliseCurrency(value);
  return isValidCurrency(currency) ? currency : DEFAULTS.currency;
};

const asBoolean = value => value === true || value === 'true';

const upper = (value, max) => String(value || '').trim().toUpperCase().slice(0, max);

export const normaliseCountry = value => {
  const country = upper(value, 2);
  return /^[A-Z]{2}$/.test(country) ? country : '';
};

export const normaliseRounding = value => (ROUNDING.includes(String(value)) ? String(value) : DEFAULTS.rounding);

export const normaliseStates = value => [...new Set(String(value || '').split(',').map(item => upper(item, 10)).filter(Boolean))];

export const readConfig = async () => {
  const read = async (name, fallback) => {
    const [error, value] = await getSetting(OWNER, name, fallback);
    return error ? fallback : value;
  };

  const [provider, currency, includesTax, taxClass, homeCountry, homeState, homeCity, homePostal, rounding, originStates] = await Promise.all([
    read('provider', DEFAULTS.provider),
    read('currency', DEFAULTS.currency),
    read('prices_include_tax', DEFAULTS.includesTax),
    read('default_tax_class', DEFAULTS.taxClass),
    read('home_country', DEFAULTS.homeCountry),
    read('home_state', DEFAULTS.homeState),
    read('home_city', DEFAULTS.homeCity),
    read('home_postal', DEFAULTS.homePostal),
    read('rounding', DEFAULTS.rounding),
    read('origin_sourcing_states', ''),
  ]);

  return {
    provider: String(provider || DEFAULTS.provider),
    currency: normaliseDefaultCurrency(currency),
    includesTax: asBoolean(includesTax),
    taxClass: normaliseDefaultClass(taxClass),
    homeCountry: normaliseCountry(homeCountry),
    homeState: upper(homeState, 10),
    homeCity: String(homeCity || '').trim().slice(0, 100),
    homePostal: String(homePostal || '').trim().slice(0, 20),
    rounding: normaliseRounding(rounding),
    originSourcingStates: normaliseStates(originStates),
  };
};
