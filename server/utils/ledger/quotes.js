import crypto from 'crypto';
import { eq, lt } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoTaxQuote } from '../../db/schema.js';

/*
  Quotes: what this site worked out, kept just long enough to be recorded from.

  A quote holds a customer's address and a cart's contents, and a checkout asks for one every time
  the cart changes. So they are not kept: ninety days (the longest a calculation stays valid at
  Stripe), pruned opportunistically rather than by a scheduler this extension does not have.
*/

export const QUOTE_DAYS = 90;

export const newQuoteId = () => `taxq_${crypto.randomBytes(12).toString('hex')}`;

let lastPrune = 0;

/*
  At most once an hour per process. A delete on every calculation would be a write per cart change
  for no benefit; an hour of expired rows is nothing.
*/
export const pruneQuotes = async (now = Date.now()) => {
  if(now - lastPrune < 60 * 60 * 1000) return;
  lastPrune = now;

  try {
    await db.delete(kempoTaxQuote).where(lt(kempoTaxQuote.expiresAt, new Date(now)));
  } catch(error) {
    console.warn(`[kempo-tax] Could not prune old quotes: ${error.message}`);
  }
};

export const saveQuote = async ({ provider, providerRef, currency, result, address, expiresAt }) => {
  const now = new Date();
  const id = newQuoteId();

  try {
    await db.insert(kempoTaxQuote).values({
      id,
      provider,
      providerRef: providerRef || null,
      currency,
      result,
      address: address || null,
      createdAt: now,
      expiresAt: expiresAt || new Date(now.getTime() + QUOTE_DAYS * 24 * 60 * 60 * 1000),
    });
  } catch(error) {
    return [{ code: 500, msg: `Could not save the calculation: ${error.message}` }, null];
  }

  pruneQuotes();
  return [null, id];
};

export const getQuote = async id => {
  if(typeof id !== 'string' || !id) return [{ code: 400, msg: 'A calculationId is required — the one calculateTax returned' }, null];

  try {
    const [row] = await db.select().from(kempoTaxQuote).where(eq(kempoTaxQuote.id, id)).limit(1);
    if(!row) return [{ code: 404, msg: 'No such calculation — it may have expired, so calculate again' }, null];
    if(row.expiresAt.getTime() < Date.now()) return [{ code: 410, msg: 'That calculation has expired — calculate again' }, null];
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not load the calculation' }, null];
  }
};
