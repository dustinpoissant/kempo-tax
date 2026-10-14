import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  Two things the declarative config cannot do.

  **The indexes.** kempo's installer generates `CREATE TABLE` from the Drizzle schema and reads
  columns and primary keys off it — indexes and unique constraints declared on a table are not
  carried across. For most tables that is a performance footnote. Here one of them is a correctness
  guarantee: without the unique index on `(kind, reference)` the same order can be recorded twice,
  and every report after that counts the sale twice. So they are created here, by hand, matching
  what server/db/schema.js declares. A static test checks the two lists agree — an index that this
  file forgets exists only in development, where `drizzle-kit push` makes it.

  **The warning.** The Stripe key is a `secret` setting, and kempo can only encrypt those when
  SETTINGS_ENCRYPTION_KEY is set. Without it the setting is silently not created. A site using only
  the rate table never needs it, so this says what it affects instead of insisting.
*/

export const INDEXES = [
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoTaxEntry_reference_idx" ON "kempoTaxEntry" ("kind", "reference")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoTaxEntry_occurred_idx" ON "kempoTaxEntry" ("occurredAt")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoTaxEntry_providerRef_idx" ON "kempoTaxEntry" ("providerRef")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoTaxQuote_expires_idx" ON "kempoTaxQuote" ("expiresAt")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoTaxRate_place_idx" ON "kempoTaxRate" ("country", "state")`,
];

export default async () => {
  for(const statement of INDEXES){
    try {
      await db.execute(statement);
    } catch(error) {
      console.warn(`[kempo-tax] Could not create an index: ${error.message}`);
    }
  }

  if(!process.env.SETTINGS_ENCRYPTION_KEY){
    console.warn([
      '[kempo-tax] SETTINGS_ENCRYPTION_KEY is not set, so a Stripe key cannot be stored.',
      '  The rate table provider does not need one and works as installed.',
      '  To use Stripe Tax: generate a key with node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))",',
      '  put it in .env, restart, then reinstall this extension. Back it up — losing it makes every stored secret unrecoverable.',
    ].join('\n'));
  }

  console.log('[kempo-tax] Installed. Open Tax in the admin menu: use the home-state quick start for a rate table, or connect Stripe.');
};
