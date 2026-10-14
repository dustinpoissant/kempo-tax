import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoTaxEntry } from '../../db/schema.js';

/*
  The ledger's database operations.

  There is deliberately no update and no delete in this file. A ledger row is a fact about a sale;
  a mistake is corrected by a reversal and a new sale, never by editing history, and nothing in
  this extension needs to be able to do otherwise.
*/

export const MAX_REPORT_ROWS = 200000;

const UNIQUE_VIOLATION = '23505';

export const isUniqueViolation = error => error?.code === UNIQUE_VIOLATION || error?.cause?.code === UNIQUE_VIOLATION
  || /unique|duplicate key/i.test(error?.message || '');

export const getEntry = async id => {
  if(!Number.isInteger(id)) return [{ code: 400, msg: 'An entry id is required' }, null];

  try {
    const [row] = await db.select().from(kempoTaxEntry).where(eq(kempoTaxEntry.id, id)).limit(1);
    if(!row) return [{ code: 404, msg: 'No such ledger entry' }, null];
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not load the ledger entry' }, null];
  }
};

export const getEntryByReference = async (kind, reference) => {
  try {
    const [row] = await db.select().from(kempoTaxEntry)
      .where(and(eq(kempoTaxEntry.kind, kind), eq(kempoTaxEntry.reference, reference)))
      .limit(1);
    return [null, row || null];
  } catch {
    return [{ code: 500, msg: 'Could not look up the ledger' }, null];
  }
};

export const getEntryByProviderRef = async providerRef => {
  try {
    const [row] = await db.select().from(kempoTaxEntry)
      .where(and(eq(kempoTaxEntry.kind, 'sale'), eq(kempoTaxEntry.providerRef, providerRef)))
      .limit(1);
    return [null, row || null];
  } catch {
    return [{ code: 500, msg: 'Could not look up the ledger' }, null];
  }
};

/*
  Insert, returning the existing row if the reference was already recorded. The unique index is
  what makes this safe under a race: two requests recording the same order at once produce one row
  and one of them is told so, rather than both writing and a report counting the sale twice.
*/
export const insertEntry = async entry => {
  const now = new Date();

  try {
    const [row] = await db.insert(kempoTaxEntry).values({ ...entry, createdAt: now }).returning();
    return [null, { entry: row, created: true }];
  } catch(error) {
    if(isUniqueViolation(error)){
      const [lookupError, existing] = await getEntryByReference(entry.kind, entry.reference);
      if(lookupError) return [lookupError, null];
      if(existing) return [null, { entry: existing, created: false }];
    }
    return [{ code: 500, msg: `Could not record the sale: ${error.message}` }, null];
  }
};

/*
  What has already been reversed against a sale, as a positive total of the tax-inclusive amount.
*/
export const reversedTotal = async originalEntryId => {
  try {
    const rows = await db.select().from(kempoTaxEntry)
      .where(and(eq(kempoTaxEntry.kind, 'reversal'), eq(kempoTaxEntry.originalEntryId, originalEntryId)));
    return [null, rows.reduce((total, row) => total + -(row.salesAmount + row.taxAmount), 0)];
  } catch {
    return [{ code: 500, msg: 'Could not total the reversals' }, null];
  }
};

export const listEntries = async ({ from, to, kind, state, limit = 100, offset = 0 } = {}) => {
  const conditions = [];
  if(from) conditions.push(gte(kempoTaxEntry.occurredAt, new Date(from)));
  if(to) conditions.push(lt(kempoTaxEntry.occurredAt, new Date(to)));
  if(kind) conditions.push(eq(kempoTaxEntry.kind, kind));
  if(state) conditions.push(eq(kempoTaxEntry.state, String(state).toUpperCase()));
  const where = conditions.length ? and(...conditions) : undefined;

  try {
    const rows = await db.select().from(kempoTaxEntry).where(where)
      .orderBy(desc(kempoTaxEntry.occurredAt), desc(kempoTaxEntry.id))
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
      .offset(Math.max(Number(offset) || 0, 0));
    const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(kempoTaxEntry).where(where);
    return [null, { entries: rows, total: count }];
  } catch {
    return [{ code: 500, msg: 'Could not list the ledger' }, null];
  }
};

/*
  Every entry in a period, oldest first, for a report or an export. Capped, loudly: a report that
  silently dropped rows past some limit would be a return that is wrong without anyone knowing.
*/
export const entriesInPeriod = async ({ from, to } = {}) => {
  const conditions = [];
  if(from) conditions.push(gte(kempoTaxEntry.occurredAt, new Date(from)));
  if(to) conditions.push(lt(kempoTaxEntry.occurredAt, new Date(to)));

  try {
    const rows = await db.select().from(kempoTaxEntry)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(kempoTaxEntry.occurredAt), asc(kempoTaxEntry.id))
      .limit(MAX_REPORT_ROWS + 1);

    if(rows.length > MAX_REPORT_ROWS){
      return [{ code: 413, msg: `That period has more than ${MAX_REPORT_ROWS} entries — choose a shorter one` }, null];
    }
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Could not read the ledger' }, null];
  }
};

export const countEntries = async () => {
  try {
    const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(kempoTaxEntry);
    return [null, count];
  } catch {
    return [{ code: 500, msg: 'Could not count the ledger' }, null];
  }
};

export const getEntryByQuoteId = async quoteId => {
  try {
    const [row] = await db.select().from(kempoTaxEntry)
      .where(and(eq(kempoTaxEntry.kind, 'sale'), eq(kempoTaxEntry.quoteId, quoteId)))
      .limit(1);
    return [null, row || null];
  } catch {
    return [{ code: 500, msg: 'Could not look up the ledger' }, null];
  }
};
