import { cleanRate } from './validate.js';

/*
  The home-state wizard: the handful of rows a seller in one place needs, from four or five answers
  instead of a dozen form rows.

  It produces *rows* — the same rows the table editor edits — and nothing hidden. After the
  wizard has run, the owner can see and change every line it made, which is the difference between
  a helper and a black box. It also never invents a rate: it only writes what it was given.

  Classes the owner lists as taxable get the state rate. Classes listed as exempt get an explicit
  exempt row, so a sale of one is reported on the return as an exempt sale and not mistaken for a
  place the site does not collect. Shipping follows the owner's answer, since whether shipping is
  taxed differs by state and by what is shipped, and that is theirs to say.

  Local option taxes are layers on top of the state rate (see server/utils/tax/rates.js), each a
  row for one locality applying to the same classes.
*/
export const quickstartRows = input => {
  if(!input || typeof input !== 'object') return [{ code: 400, msg: 'Answers are required' }, null];

  const country = String(input.country || '').trim().toUpperCase();
  const state = String(input.state || '').trim().toUpperCase();
  const taxable = Array.isArray(input.taxableClasses) ? input.taxableClasses : [];
  const exempt = Array.isArray(input.exemptClasses) ? input.exemptClasses : [];
  const locals = Array.isArray(input.localRates) ? input.localRates : [];

  if(!taxable.length && !exempt.length){
    return [{ code: 400, msg: 'Choose at least one class that is taxable or exempt' }, null];
  }

  const overlap = taxable.filter(name => exempt.includes(name));
  if(overlap.length) return [{ code: 400, msg: `${overlap[0]} cannot be both taxable and exempt` }, null];

  if(input.stateRate === undefined || input.stateRate === '') return [{ code: 400, msg: 'A rate is required — enter it from your tax authority, this does not guess' }, null];

  const base = {
    country,
    state,
    level: state ? 'state' : 'country',
    jurisdiction: String(input.jurisdiction || state || country),
    effectiveFrom: input.effectiveFrom || '',
    taxType: input.taxType || 'sales_tax',
  };

  const rows = [];

  const add = (row, label) => {
    rows.push({ ...base, ...row, note: `Created by the quick start${label ? ` — ${label}` : ''}` });
  };

  for(const taxClass of taxable){
    add({ taxClass, kind: 'taxable', rate: input.stateRate });
    for(const local of locals){
      add({
        taxClass,
        kind: 'taxable',
        rate: local.rate,
        level: 'city',
        locality: local.locality,
        jurisdiction: local.jurisdiction || `${local.locality} local option`,
      }, 'local option');
    }
  }

  for(const taxClass of exempt) add({ taxClass, kind: 'exempt' });

  if(input.shippingTaxable){
    add({ taxClass: 'shipping', kind: 'taxable', rate: input.stateRate, appliesToShipping: true }, 'shipping');
    for(const local of locals){
      add({
        taxClass: 'shipping',
        kind: 'taxable',
        rate: local.rate,
        level: 'city',
        locality: local.locality,
        jurisdiction: local.jurisdiction || `${local.locality} local option`,
        appliesToShipping: true,
      }, 'shipping, local option');
    }
  }

  for(const [index, row] of rows.entries()){
    const [error] = cleanRate(row);
    if(error) return [{ code: error.code, msg: `${error.msg} (row ${index + 1}: ${row.taxClass}${row.locality ? ` in ${row.locality}` : ''})` }, null];
  }

  return [null, rows];
};
