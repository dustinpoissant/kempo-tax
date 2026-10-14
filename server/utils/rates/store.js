import { and, asc, eq, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoTaxRate } from '../../db/schema.js';
import { cleanRate } from './validate.js';

/*
  The rate table's database operations. Validation lives in validate.js so the admin form, the CSV
  import and the quick start all go through the same gate.
*/

export const listRates = async ({ country, state } = {}) => {
  const conditions = [];
  if(country) conditions.push(eq(kempoTaxRate.country, String(country).toUpperCase()));
  if(state) conditions.push(eq(kempoTaxRate.state, String(state).toUpperCase()));

  try {
    const rows = await db.select().from(kempoTaxRate)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(kempoTaxRate.country), asc(kempoTaxRate.state), asc(kempoTaxRate.level), asc(kempoTaxRate.id));
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Could not load the rates' }, null];
  }
};

/*
  The rows a calculation needs: those for one country. Date and class filtering happens in the
  engine, where it can be tested; narrowing by country here just keeps a large table from being
  read in full on every cart change.
*/
export const ratesForCountry = async country => {
  try {
    const rows = await db.select().from(kempoTaxRate).where(eq(kempoTaxRate.country, String(country).toUpperCase()));
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Could not load the rates' }, null];
  }
};

export const getRate = async id => {
  if(!Number.isInteger(id)) return [{ code: 400, msg: 'A rate id is required' }, null];

  try {
    const [row] = await db.select().from(kempoTaxRate).where(eq(kempoTaxRate.id, id)).limit(1);
    if(!row) return [{ code: 404, msg: 'No such rate' }, null];
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not load the rate' }, null];
  }
};

export const createRate = async input => {
  const [error, clean] = cleanRate(input);
  if(error) return [error, null];

  const now = new Date();
  try {
    const [row] = await db.insert(kempoTaxRate).values({ ...clean, createdAt: now, updatedAt: now }).returning();
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not save the rate' }, null];
  }
};

export const updateRate = async (id, input) => {
  const [existingError] = await getRate(id);
  if(existingError) return [existingError, null];

  const [error, clean] = cleanRate(input);
  if(error) return [error, null];

  try {
    const [row] = await db.update(kempoTaxRate)
      .set({ ...clean, updatedAt: new Date() })
      .where(eq(kempoTaxRate.id, id))
      .returning();
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not save the rate' }, null];
  }
};

export const deleteRate = async id => {
  const [existingError] = await getRate(id);
  if(existingError) return [existingError, null];

  try {
    await db.delete(kempoTaxRate).where(eq(kempoTaxRate.id, id));
    return [null, { deleted: true }];
  } catch {
    return [{ code: 500, msg: 'Could not delete the rate' }, null];
  }
};

/*
  All or nothing. An import with one bad row in the middle must not leave half of a rate table
  behind: every row is validated first, and only then is anything written, in one statement.
*/
export const createMany = async inputs => {
  const cleaned = [];

  for(const [index, input] of inputs.entries()){
    const [error, clean] = cleanRate(input);
    if(error) return [{ code: error.code, msg: `Row ${index + 1}: ${error.msg}` }, null];
    cleaned.push(clean);
  }

  if(!cleaned.length) return [{ code: 400, msg: 'There are no rows to add' }, null];

  const now = new Date();
  try {
    const rows = await db.insert(kempoTaxRate)
      .values(cleaned.map(clean => ({ ...clean, createdAt: now, updatedAt: now })))
      .returning();
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Could not save the rates' }, null];
  }
};

export const countRates = async () => {
  try {
    const [{ count }] = await db.select({ count: sql`count(*)::int` }).from(kempoTaxRate);
    return [null, count];
  } catch {
    return [{ code: 500, msg: 'Could not count the rates' }, null];
  }
};
