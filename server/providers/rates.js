import { readConfig } from '../utils/config/settings.js';
import { calculateWithRates } from '../utils/tax/rates.js';
import { TAX_CLASSES } from '../utils/tax/shape.js';
import { listRates, ratesForCountry } from '../utils/rates/store.js';

/*
  The rate table provider: tax worked out from rows the site owner maintains, with no external
  service, no per-transaction fee, and no dependency on any payment processor.

  It exists for the seller with one jurisdiction — or a few — who does not want a service for that,
  and for the day a service is down or the account is closed. The rules for how rows combine are
  in server/utils/tax/rates.js; this module only fetches them and answers the provider contract
  (see server/providers/index.js).

  Recording and reversing are no-ops here, because there is nothing at a third party to tell. The
  ledger is the record, and it is written by the code that calls these, for every provider alike.
*/

export const name = 'rates';
export const label = 'Rate table';

export const credentialFields = [];

export const status = async () => [null, {
  provider: name,
  label,
  configured: true,
  keySource: null,
  mode: null,
  livemode: true,
  fields: {},
}];

export const accountSettings = async () => {
  const config = await readConfig();
  return [null, {
    active: true,
    status: 'active',
    missingFields: [],
    headOfficeCountry: config.homeCountry || null,
    defaultTaxCode: null,
    defaultTaxBehavior: config.includesTax ? 'inclusive' : 'exclusive',
    livemode: true,
  }];
};

/*
  Origin sourcing, for the states that tax an in-state sale by where the seller is rather than
  where the buyer is. It only ever applies to a sale *to the seller's own state*: an out-of-state
  buyer is taxed on destination everywhere. Needs the home address; without it the destination is
  used, which is the safe reading.
*/
const sourcingAddress = (address, config) => {
  const inHomeState = config.homeCountry && address.country === config.homeCountry
    && config.homeState && String(address.state || '').toUpperCase() === config.homeState;

  if(!inHomeState || !config.originSourcingStates.includes(config.homeState) || !config.homePostal) return address;

  return {
    country: config.homeCountry,
    state: config.homeState,
    city: config.homeCity || address.city,
    postal_code: config.homePostal,
  };
};

export const calculate = async request => {
  const config = await readConfig();

  const [error, rows] = await ratesForCountry(request.address.country);
  if(error) return [error, null];

  const address = sourcingAddress(request.address, config);

  return [null, calculateWithRates({ ...request, address }, rows, { rounding: config.rounding })];
};

export const recordTransaction = async () => [null, { transactionId: null, reference: null, type: 'transaction', livemode: true }];

export const reverseTransaction = async () => [null, { transactionId: null, reference: null, type: 'reversal', livemode: true }];

/*
  "Where tax is collected", for this provider, is where there is a rate. One row per place with at
  least one enabled rate, which is what the same screen shows for registrations at Stripe.
*/
export const listRegistrations = async () => {
  const [error, rows] = await listRates();
  if(error) return [error, null];

  const places = new Map();
  for(const row of rows){
    if(!row.enabled) continue;
    const key = `${row.country}|${row.state}`;
    if(!places.has(key)){
      places.set(key, {
        id: key,
        country: row.country,
        state: row.state || null,
        type: 'rate table',
        status: 'active',
        activeFrom: null,
        expiresAt: null,
      });
    }
  }

  return [null, [...places.values()]];
};

export const listTaxCodes = async () => [null, Object.entries(TAX_CLASSES).map(([className, code]) => ({
  id: className,
  name: className,
  description: `Rates are matched on this class name. Stripe category: ${code}`,
}))];
