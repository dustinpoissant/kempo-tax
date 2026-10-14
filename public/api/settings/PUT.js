import { setSetting } from 'kempo/server/sdk.js';
import { getProvider, listProviders } from '../../../server/providers/index.js';
import { OWNER, ROUNDING, TAX_CODE, normaliseCountry, readConfig } from '../../../server/utils/config/settings.js';
import { typeOf, descriptionOf, DECLARED_SETTINGS } from '../../../server/utils/config/declared.js';
import { isValidCurrency, normaliseCurrency } from '../../../server/utils/tax/shape.js';
import { isKnownClass } from '../../../server/utils/rates/validate.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Saves the settings, one kempo setting per field.

  These are ordinary kempo settings and also appear under /admin/settings grouped by owner —
  nothing here is a second store. What this route adds is validation before the write, and its own
  permission: `tax:settings` can be given to whoever connects the site to Stripe without also giving
  them `system:settings:update`, which is every setting on the installation.

  **Blank means unchanged, not cleared.** A secret is never sent to the browser, so the field
  showing it is always empty — saving the form after editing something else would otherwise wipe
  the key. Clearing one is possible, but it takes an explicit `null`, which no accidental submit
  produces.
*/

/*
  Exported so a static test can check every name here is declared in kempo-config.json. A setting
  written without its declared type is the failure that matters most here: `secret` is what makes
  an API key encrypted at rest, and a write that loses the type stores it as plain text.
*/
export const SAVEABLE = [
  'provider',
  'currency',
  'prices_include_tax',
  'default_tax_code',
  'shipping_tax_code',
  'default_tax_class',
  'home_country',
  'home_state',
  'home_city',
  'home_postal',
  'rounding',
  'origin_sourcing_states',
  ...listProviders().flatMap(provider => provider.credentialFields.map(field => field.name)),
];

export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:settings');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const body = request.body || {};
  const updates = {};

  if(body.provider !== undefined){
    const [error] = getProvider(String(body.provider));
    if(error) return response.status(400).json({ error: error.msg });
    updates.provider = String(body.provider);
  }

  if(body.currency !== undefined){
    const currency = normaliseCurrency(body.currency);
    if(!isValidCurrency(currency)){
      return response.status(400).json({ error: 'Currency must be a three-letter ISO code, such as usd or gbp' });
    }
    updates.currency = currency;
  }

  if(body.prices_include_tax !== undefined){
    // Strictly boolean: "false" read as truthy would turn tax-inclusive pricing on by accident.
    if(typeof body.prices_include_tax !== 'boolean'){
      return response.status(400).json({ error: 'prices_include_tax must be true or false' });
    }
    updates.prices_include_tax = body.prices_include_tax;
  }

  if(body.default_tax_class !== undefined){
    const value = String(body.default_tax_class ?? '').trim().toLowerCase();
    if(!isKnownClass(value) || value === '*'){
      return response.status(400).json({ error: 'The default tax class must be one of the named classes, or a txcd_ code' });
    }
    updates.default_tax_class = value;
  }

  if(body.home_country !== undefined){
    const value = String(body.home_country ?? '').trim();
    if(value && !normaliseCountry(value)) return response.status(400).json({ error: 'Home country must be a two-letter code, such as US' });
    updates.home_country = normaliseCountry(value);
  }

  for(const name of ['home_state', 'home_city', 'home_postal', 'origin_sourcing_states']){
    if(body[name] === undefined) continue;
    const max = name === 'origin_sourcing_states' ? 200 : 100;
    updates[name] = String(body[name] ?? '').trim().slice(0, max);
  }

  if(body.rounding !== undefined){
    if(!ROUNDING.includes(String(body.rounding))){
      return response.status(400).json({ error: `Rounding must be one of: ${ROUNDING.join(', ')}` });
    }
    updates.rounding = String(body.rounding);
  }

  for(const name of ['default_tax_code', 'shipping_tax_code']){
    if(body[name] === undefined) continue;

    const value = String(body[name] ?? '').trim();
    if(value && !TAX_CODE.test(value)){
      return response.status(400).json({ error: 'A tax category looks like txcd_99999999 — pick one from the list, or leave it blank' });
    }
    updates[name] = value;
  }

  for(const provider of listProviders()){
    for(const field of provider.credentialFields){
      const value = body[field.name];
      if(value === undefined) continue;

      if(value === null){
        updates[field.name] = '';
        continue;
      }

      const trimmed = String(value).trim();
      if(!trimmed) continue;

      /*
        A publishable key cannot calculate tax, and pasting one is the likeliest mistake — Stripe's
        key screen lists it first. Refused with a message, instead of saved and failing later with
        a Stripe error that names an account setting nobody has touched.
      */
      if(/^pk_/.test(trimmed)){
        return response.status(400).json({ error: 'That is a publishable key. Tax needs the secret key (sk_…) or a restricted key (rk_…).' });
      }

      updates[field.name] = trimmed;
    }
  }

  if(!Object.keys(updates).length){
    return response.status(400).json({ error: 'Nothing to save' });
  }

  const savesSecret = Object.keys(updates).some(name => typeOf(name) === 'secret');
  if(savesSecret && !process.env.SETTINGS_ENCRYPTION_KEY){
    return response.status(500).json({
      error: 'SETTINGS_ENCRYPTION_KEY is not set on this server, so the Stripe key cannot be stored. Add it to the environment and restart.',
    });
  }

  for(const [name, value] of Object.entries(updates)){
    // Belt and braces: nothing reaches setSetting that is not on the list above.
    if(!SAVEABLE.includes(name) || !DECLARED_SETTINGS.has(name)) continue;

    /*
      The type and description come from kempo-config.json rather than being restated here.
      setSetting stores exactly what it is handed, so passing null for the description would erase
      the text kempo's own /admin/settings screen shows next to each of these.
    */
    const [error] = await setSetting(OWNER, name, value, typeOf(name), false, descriptionOf(name));
    if(error) return response.status(error.code).json({ error: error.msg });
  }

  const config = await readConfig();
  const [providerError, provider] = getProvider(config.provider);
  const status = providerError ? null : (await provider.status())[1];

  response.json({ settings: config, status });
};
