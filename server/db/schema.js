import { pgTable, text, boolean, integer, serial, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

/*
  Three tables.

  Money is an integer in the currency's minor unit and a rate is an integer count of millionths of
  a percent (see server/utils/tax/percent.js). Nothing here is a float: a tax return that does not
  reconcile by a cent is a return somebody has to explain.
*/

/*
  One layer of tax for one place and one kind of thing — a row the site owner maintains.

  Rows are never silently superseded. A rate that changes is *ended* (`effectiveTo`) and a new one
  added, because a sale quoted last month has to be taxed at the rate that was in force last month,
  and a report has to be reproducible.

  Dates are plain `YYYY-MM-DD` text: comparing them as strings is correct for that format, and it
  keeps the table independent of how a database driver serialises timestamps.
*/
export const kempoTaxRate = pgTable('kempoTaxRate', {
  id: serial('id').primaryKey(),

  country: text('country').notNull(),
  state: text('state').notNull().default(''),
  locality: text('locality').notNull().default(''),
  postalPattern: text('postalPattern').notNull().default(''),

  /*
    A class name ("physical", "digital"…), a raw tax code, or `*` for every class.
  */
  taxClass: text('taxClass').notNull().default('*'),

  level: text('level').notNull().default('state'),
  kind: text('kind').notNull().default('taxable'),
  rateMicro: integer('rateMicro').notNull().default(0),
  appliesToShipping: boolean('appliesToShipping').notNull().default(false),
  taxType: text('taxType').notNull().default('sales_tax'),

  /*
    `jurisdiction` is what a report names the layer; `label` is what a customer's receipt may show.
  */
  jurisdiction: text('jurisdiction').notNull().default(''),
  label: text('label').notNull().default(''),

  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  effectiveFrom: text('effectiveFrom').notNull().default(''),
  effectiveTo: text('effectiveTo').notNull().default(''),
  note: text('note').notNull().default(''),

  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
}, table => ({
  placeIndex: index('kempoTaxRate_place_idx').on(table.country, table.state),
}));

/*
  A quote, kept so a sale can be recorded from it later.

  Without this, recording a sale would mean trusting the caller to hand back what it was quoted, and
  a ledger that says whatever the caller said is not a ledger. The quote is what the site itself
  worked out at the time; recording refers to it by id and takes the amounts from here.

  Short-lived by design: nothing needs a quote after the sale it was for is recorded or abandoned,
  and it holds a customer's address, so it is pruned (see server/utils/ledger/quotes.js).
*/
export const kempoTaxQuote = pgTable('kempoTaxQuote', {
  id: text('id').primaryKey(),

  provider: text('provider').notNull(),
  providerRef: text('providerRef'),
  currency: text('currency').notNull(),
  result: jsonb('result').notNull(),
  address: jsonb('address'),

  createdAt: timestamp('createdAt').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
}, table => ({
  expiresIndex: index('kempoTaxQuote_expires_idx').on(table.expiresAt),
}));

/*
  The ledger: one immutable row per recorded sale, and one per reversal.

  This is a **legal record**, kept for years, and it is written for every provider — Stripe's own
  reports exist, but a site must be able to produce its return without depending on them, and a
  site that moves from one provider to another must not lose the history.

  `reference` is the caller's own id for the sale and is unique per `kind`, which is what makes
  recording the same order twice — a webhook delivered twice, a retry after a timeout — harmless.

  Amounts on a reversal are negative, so a period's totals are a plain sum.

  The sales are split three ways because a return asks for them three ways:
  `taxableAmount` is what tax was charged on, `exemptAmount` is sold in a place the site collects
  but carried no tax (and is still reported), and `uncollectedAmount` is sold where the site is not
  registered (and appears on no return at all).
*/
export const kempoTaxEntry = pgTable('kempoTaxEntry', {
  id: serial('id').primaryKey(),

  kind: text('kind').notNull(),
  reference: text('reference').notNull(),
  originalEntryId: integer('originalEntryId'),

  provider: text('provider').notNull(),
  providerRef: text('providerRef'),
  quoteId: text('quoteId'),
  livemode: boolean('livemode').notNull().default(false),

  currency: text('currency').notNull(),
  salesAmount: integer('salesAmount').notNull().default(0),
  taxableAmount: integer('taxableAmount').notNull().default(0),
  exemptAmount: integer('exemptAmount').notNull().default(0),
  uncollectedAmount: integer('uncollectedAmount').notNull().default(0),
  taxAmount: integer('taxAmount').notNull().default(0),

  /*
    The breakdown by jurisdiction, as it stood: [{ jurisdiction, level, country, state, rate,
    taxableAmount, amount }]. Kept denormalised so a report never depends on a rate row that has
    since been edited or removed.
  */
  jurisdictions: jsonb('jurisdictions').notNull(),

  country: text('country').notNull().default(''),
  state: text('state').notNull().default(''),
  postalCode: text('postalCode').notNull().default(''),

  note: text('note'),
  occurredAt: timestamp('occurredAt').notNull(),
  createdAt: timestamp('createdAt').notNull(),
}, table => ({
  referenceIndex: uniqueIndex('kempoTaxEntry_reference_idx').on(table.kind, table.reference),
  occurredIndex: index('kempoTaxEntry_occurred_idx').on(table.occurredAt),
  providerRefIndex: index('kempoTaxEntry_providerRef_idx').on(table.providerRef),
}));
