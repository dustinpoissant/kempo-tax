import * as stripe from './stripe.js';
import { getSetting } from 'kempo/server/sdk.js';
import { DEFAULTS, OWNER } from '../utils/config/settings.js';

/*
  The registry, and the contract a tax provider module implements.

  Only Stripe Tax ships. The abstraction is here anyway, from the first commit, for the same reason
  it is in kempo-payments: the alternative is every call site growing a direct dependency on one
  company's SDK, and adding TaxJar or Avalara becomes a change to the whole extension instead of a
  file in this directory.

  A provider module exports:

  | Export                 | Shape                                                                  |
  |------------------------|------------------------------------------------------------------------|
  | `name`                 | the id of the provider, stored with every calculation it makes         |
  | `label`                | what a human is shown                                                  |
  | `credentialFields`     | the settings holding its credentials, in the order a screen shows them |
  | `status()`             | `[err, { configured, mode, livemode, … }]` — is it usable, and in which mode |
  | `accountSettings()`    | `[err, { active, missingFields, … }]` — is the service itself switched on |
  | `calculate(request)`   | `[err, calculation]` — `request` is the output of `parseRequest`       |
  | `recordTransaction()`  | `[err, { transactionId, … }]` — turn a calculation into a reportable sale |
  | `reverseTransaction()` | `[err, { transactionId, … }]` — reverse some or all of a recorded sale |
  | `listRegistrations()`  | `[err, [{ country, state, type, status, … }]]` — where it is collecting |
  | `listTaxCodes()`       | `[err, [{ id, name, description }]]` — the categories it understands   |

  A `calculation` is in this extension's vocabulary, not the provider's — see
  server/utils/tax/shape.js. Mapping into it is the provider module's job, precisely so the rest of
  the extension has one shape rather than one per service.

  Roadmap providers — TaxJar, Avalara, and a plain rate table for a seller who has one jurisdiction
  and no wish to depend on a service — each become one more file here.
*/

const PROVIDERS = new Map([[stripe.name, stripe]]);

export const listProviders = () => [...PROVIDERS.values()].map(provider => ({
  name: provider.name,
  label: provider.label,
  credentialFields: provider.credentialFields,
}));

export const getProvider = name => {
  const provider = PROVIDERS.get(name);
  if(!provider) return [{ code: 400, msg: `No tax provider named "${name}" is installed` }, null];
  return [null, provider];
};

/*
  The provider to use right now, read fresh from settings on every call rather than cached, so that
  switching takes effect without a restart.
*/
export const activeProvider = async () => {
  const [error, configured] = await getSetting(OWNER, 'provider', DEFAULTS.provider);
  return getProvider(error ? DEFAULTS.provider : String(configured || DEFAULTS.provider));
};
