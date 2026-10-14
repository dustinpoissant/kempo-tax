import { countEntries } from './server/utils/ledger/store.js';
import { countRates } from './server/utils/rates/store.js';

/*
  Nothing here is deleted, and nothing here can be — this only says what is about to be lost.

  kempo drops this extension's tables straight after this runs. One of them is the **tax ledger**,
  which is a legal record: the site's own account of every sale it collected tax on and every
  refund, which a return is built from and which a tax authority can ask for years later.
  Reinstalling does not bring the rows back. Stripe keeps its own reports, but the rate table's
  sales exist only here, and a site that has moved to another provider has history in this table
  and nowhere else.

  So it is said loudly enough that somebody clicking uninstall knows what they are about to lose
  before they lose it — there is no undo anywhere in this stack — and the export that prevents the
  loss is named. The rates are listed too, since rebuilding a table by hand is a bad afternoon.
*/
export default async () => {
  const [, entries] = await countEntries();
  const [, rates] = await countRates();

  if(entries){
    console.warn([
      `[kempo-tax] Removing. ${entries} ledger entr${entries === 1 ? 'y' : 'ies'} will be dropped with the tables.`,
      '  The ledger is your record of tax collected, which a return is built from.',
      '  Export it first: Admin > Tax > Reports > Export the ledger (or GET /tax/api/ledger-export).',
    ].join('\n'));
  } else {
    console.log('[kempo-tax] Removing. The ledger is empty, so no sale records are lost.');
  }

  if(rates) console.warn(`[kempo-tax] ${rates} rate${rates === 1 ? '' : 's'} will be dropped too. Export them first from Admin > Tax > Rates.`);
};
