import { formatPercent, parsePercent } from '../tax/percent.js';
import { KINDS, LEVELS } from '../tax/rates.js';
import { TAX_CLASSES } from '../tax/shape.js';

/*
  What a rate row may be. Pure: used by the admin form, the CSV import and the quick start alike,
  so a row means the same thing however it arrived.

  Everything is refused with a message about the field, not silently repaired. A rate table is the
  one place a "helpful" correction becomes a wrong tax charged to real customers.
*/

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

const isRealDate = value => {
  if(!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const isKnownClass = value => value === '*' || Object.hasOwn(TAX_CLASSES, value) || /^txcd_\d{8}$/.test(value);

export const cleanRate = input => {
  if(!input || typeof input !== 'object') return [{ code: 400, msg: 'A rate is required' }, null];

  const country = text(input.country, 10).toUpperCase();
  if(!/^[A-Z]{2}$/.test(country)) return [{ code: 400, msg: 'Country must be a two-letter code, such as US' }, null];

  const taxClass = text(input.taxClass || '*').toLowerCase() === '*' ? '*' : text(input.taxClass).toLowerCase();
  if(!isKnownClass(taxClass)){
    return [{ code: 400, msg: `Tax class must be * (every class), one of ${Object.keys(TAX_CLASSES).join(', ')}, or a txcd_ code` }, null];
  }

  const kind = text(input.kind || 'taxable').toLowerCase();
  if(!KINDS.includes(kind)) return [{ code: 400, msg: `Kind must be one of ${KINDS.join(', ')}` }, null];

  let rateMicro = 0;
  if(kind === 'taxable'){
    rateMicro = parsePercent(input.rate ?? (input.rateMicro !== undefined ? formatPercent(input.rateMicro) : undefined));
    if(rateMicro === null) return [{ code: 400, msg: 'Rate must be a percentage between 0 and 100 with at most four decimals, such as 6 or 7.25' }, null];
  }

  const state = text(input.state, 10).toUpperCase();
  const locality = text(input.locality);
  const postalPattern = text(input.postalPattern ?? input.postal_pattern, 500);

  const level = text(input.level || (locality ? 'city' : state ? 'state' : 'country')).toLowerCase();
  if(!LEVELS.includes(level)) return [{ code: 400, msg: `Level must be one of ${LEVELS.join(', ')}` }, null];

  const effectiveFrom = text(input.effectiveFrom, 10);
  const effectiveTo = text(input.effectiveTo, 10);
  if(effectiveFrom && !isRealDate(effectiveFrom)) return [{ code: 400, msg: 'Effective from must be a date, YYYY-MM-DD' }, null];
  if(effectiveTo && !isRealDate(effectiveTo)) return [{ code: 400, msg: 'Effective to must be a date, YYYY-MM-DD' }, null];
  if(effectiveFrom && effectiveTo && effectiveTo <= effectiveFrom){
    return [{ code: 400, msg: 'Effective to must be after effective from' }, null];
  }

  const priority = Number(input.priority ?? 0);
  if(!Number.isInteger(priority) || priority < -1000 || priority > 1000){
    return [{ code: 400, msg: 'Priority must be a whole number between -1000 and 1000' }, null];
  }

  const jurisdiction = text(input.jurisdiction) || locality || state || country;

  return [null, {
    country,
    state,
    locality,
    postalPattern,
    taxClass,
    level,
    kind,
    rateMicro,
    appliesToShipping: input.appliesToShipping === true || input.appliesToShipping === 'true' || input.appliesToShipping === '1' || input.appliesToShipping === 1,
    shippingProportional: input.shippingProportional === true || input.shippingProportional === 'true' || input.shippingProportional === '1' || input.shippingProportional === 1,
    taxType: text(input.taxType || 'sales_tax', 40) || 'sales_tax',
    jurisdiction,
    label: text(input.label),
    priority,
    enabled: !(input.enabled === false || input.enabled === 'false' || input.enabled === '0' || input.enabled === 0),
    effectiveFrom,
    effectiveTo,
    note: text(input.note, 500),
  }];
};

/*
  A row as the admin and the CSV show it: the rate as a percentage string, not millionths.
*/
export const presentRate = row => ({
  id: row.id,
  country: row.country,
  state: row.state,
  locality: row.locality,
  postalPattern: row.postalPattern,
  taxClass: row.taxClass,
  level: row.level,
  kind: row.kind,
  rate: row.kind === 'exempt' ? '0' : formatPercent(row.rateMicro),
  appliesToShipping: row.appliesToShipping,
  shippingProportional: !!row.shippingProportional,
  taxType: row.taxType,
  jurisdiction: row.jurisdiction,
  label: row.label,
  priority: row.priority,
  enabled: row.enabled,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  note: row.note,
});
