# kempo-tax

Sales tax, VAT and GST for the [kempo](https://github.com/dustinpoissant/kempo) CMS. Hand it an
address and some items, get back what tax to charge — and keep a record of what you collected, in
the shape a return asks for.

Two ways to get the rates, behind one interface:

- **Rate table** — rows you maintain: a state rate, a local option, which things are exempt. No
  external service, no per-transaction fee, works with any payment processor. The right choice for
  a seller in one place, or a few.
- **Stripe Tax** — [Stripe](https://stripe.com/tax) works out rates and rules for you, which is the
  right choice once you sell into enough places that keeping a table is the problem.

Switching between them is a setting. Callers do not change.

This kempo (CMS) extension depends on no other kempo extension. It has no catalog, no cart and no
idea what a "product" is — the caller supplies the classification of each line, which is what lets
a subscription, a donation or an invoice use it exactly as a store checkout does. It sits beside
[kempo-payments](https://github.com/dustinpoissant/kempo-payments), not on top of it: one works out
what is owed, the other moves the money, and either can be swapped without touching the other.

> **This extension works out tax and keeps a record. It does not register you with, or file returns
> to, any tax authority, and it does not pay anything to anyone.** Whether you owe tax, where, and
> from when depends on where you are based, where your customers are, how much you sell and what you
> sell. Talk to an accountant, or to your tax authority.

## What it is for

Other kempo (CMS) extensions.

```js
import { calculateTax, recordTransaction, reverseTransaction } from 'kempo-tax/sdk';

const [error, quote] = await calculateTax({
  address: { country: 'US', state: 'VT', postalCode: '05401', city: 'Burlington' },
  lines: [
    { amount: 4999, reference: 'sku-1', taxClass: 'physical' },
    { amount: 1500, reference: 'sku-2', quantity: 3, taxClass: 'digital' },
  ],
  shipping: { amount: 800 },
});

// quote.tax          what is owed
// quote.total        what to charge — hand this to createPayment
// quote.collecting   true when this site collects tax where the customer is
// quote.lines[]      the tax on each line, matched back by your reference
// quote.breakdown[]  per jurisdiction: name, level, rate, taxable amount, amount

// …and once the payment has *succeeded*, not before:
const [, sale] = await recordTransaction({ calculationId: quote.calculationId, reference: order.id });

// on a refund, whole or part:
await reverseTransaction({ transactionId: sale.transactionId, reference: `${order.id}-refund-1`, amount: 1000 });
```

All amounts are integers in the currency's smallest unit — `4999` is $49.99 — the same as
kempo-payments, so `quote.total` goes straight into `createPayment`.

## Install

```bash
npm install kempo-tax
```

Install it from **Admin > Extensions**, then open **Tax** in the admin menu.

**For the rate table**, open the **Rates** tab and use the quick start: your country and state, the
rate, which classes are taxable and which exempt, whether shipping is taxed, and any local option
taxes. It writes ordinary rows you can then edit.

**For Stripe Tax**, save a Stripe secret key on the **Settings** tab (or install kempo-payments and
connect Stripe there, and this extension borrows its key), switch on Stripe Tax in the Stripe
dashboard, and register where you are required to collect. `SETTINGS_ENCRYPTION_KEY` must be set on
the server for a key to be stored.

## Connected is not the same as collecting

Both providers answer "what would the tax be" and "are we collecting it here" separately.

- **Rate table:** there is a rate row for that place and class, or there is not.
- **Stripe Tax:** Stripe calculates a rate for any address and only *collects* where your account
  is registered. Everywhere else the tax is `0` with the reason `not_collecting`.

So `quote.collecting` distinguishes "this is a 0% rate" from "this site does not collect here". That
is not a fault: a small seller under every threshold owes nothing in most places. It matters because
a sale made where you *are* based, with no rate, is the one that makes a return short without
anything looking wrong — see [Sales at home](#sales-at-home-with-no-tax-collected).

## The rate table

### Rows are layers

A place is taxed in layers that stack — a country, a state, a county, a city, a district. Vermont's
6% state rate plus a 1% local option in some towns is **two rows**, and a customer in such a town
pays both.

For one line, the rows that apply are chosen like this:

1. Rows are filtered to those matching the destination (country, then state, town, postal pattern —
   each blank meaning "any"), the line's class (or `*`), and the date.
2. Within one **level**, the most specific row wins: a postal-code row beats a town row beats a
   state-wide row. At equal specificity a row for a named class beats a `*` row, then higher
   `priority`, then the later `effectiveFrom`, then the newer row.
3. The winners, one per level, are the layers that apply, and their rates add.

A line with **no matching row at any level** is `not_collecting`. An **exempt** row (kind `exempt`)
is different: it says "sold here, no tax", and it is reported on a return as an exempt sale.

### A row

| Field | |
|---|---|
| `country`, `state`, `locality`, `postalPattern` | Where. Blank means any. State uses the same code your checkout sends (`VT`). A postal pattern is a comma list of exact codes, prefixes (`054*`) and ranges (`05400-05499`). |
| `taxClass` | `physical`, `digital`, `saas`, `saas-business`, `nontaxable`, `shipping`, a `txcd_…` code, or `*` for every class |
| `kind` | `taxable` or `exempt` |
| `rate` | A percentage with up to four decimals: `6`, `7.25`, `6.625` |
| `level` | `country`, `state`, `county`, `city`, `district` or `special` — worked out from the place if left blank |
| `appliesToShipping` | Whether this row taxes shipping charges. Shipping is only taxed by rows that say so |
| `effectiveFrom` / `effectiveTo` | `YYYY-MM-DD`. `effectiveTo` is exclusive |
| `jurisdiction`, `label` | The name a report uses, and the name a receipt may show |
| `priority`, `enabled`, `note` | |

### A rate is ended, not edited

When a rate changes, **end** the old row and add a new one. A sale quoted last month must still be
taxed at last month's rate, and a report has to be reproducible. Edit a row only to fix a mistake.

### Rates are not floats

A rate is held as an integer count of millionths of a percent (6.625% is `66250`), and tax is
computed in `BigInt` and rounded half-up. A tax return that does not reconcile by a cent is one
somebody has to explain.

### Rounding

Per line by default: each line's tax is rounded, then they are added. `rounding: invoice` rounds
once per tax layer for the whole sale and spreads the result back over the lines (largest
remainder), so every line still shows its own share and they sum to the total. Tax-inclusive lines
are always rounded by themselves. Use whichever your tax authority's instructions describe.

### Sourcing

Destination sourcing — tax by where the goods go — is the default. For a state that taxes an
in-state sale by where the *seller* is, list it under `origin_sourcing_states` and set your home
city and postal code: a sale to your own state is then taxed by your address, and everything else
stays destination-based.

### Import and export

Export the table as CSV, edit it in a spreadsheet, import it back. An import **only adds** rows,
and if any row is wrong nothing is added and the error names the row. A misspelt column is an error,
not silently dropped.

> Vermont's local option taxes and what it exempts are not shipped in this package. Rates change,
> and stale ones are worse than none. Take them from the Vermont Department of Taxes' own published
> list and enter or import them.

## Tax classes

Say what *kind* of thing a line is.

| Class | Meaning |
|---|---|
| `physical` | General tangible goods |
| `digital` | Electronically supplied services and digital goods |
| `saas` | Software as a service, personal use |
| `saas-business` | Software as a service, business use |
| `nontaxable` | Never taxed |
| `shipping` | Shipping and delivery charges |

A rate-table site matches rows by class name. Stripe uses the category behind the name. A line that
names no class uses the **default tax class** setting — a class name or a Stripe category id — and
shipping always uses `shipping`.

## Prices that already include tax

Off by default, which is US-style pricing: tax is added on top. Turn **Prices already include tax**
on for VAT-style pricing, where the sticker price is what the customer pays. A single line can
override with `taxBehavior: 'inclusive' | 'exclusive'`.

In the result, `taxAmountExclusive` is tax to *add* and `taxAmountInclusive` is tax already
*inside* the amounts. `tax` is their sum and `total` is what is actually charged.

## Recording, reversing and the ledger

A calculation is a quote. It is safe to ask as often as the page changes, and nothing is reported
anywhere. It only *counts* once you record it.

Recording writes a row to this site's **ledger** — for every provider, so a return can be produced
without depending on any third party, and so history survives a change of provider. With Stripe it
also creates the Stripe transaction that appears in their reports.

- **The figures come from the stored quote, never from the caller.** You pass a `calculationId` and
  your own `reference`; you cannot pass an amount.
- **Idempotent on `reference`.** Recording the same order twice — a webhook delivered twice, a retry
  after a timeout — returns the first entry. This is also enforced by a unique index.
- **One calculation records one sale.** The same `calculationId` under a second reference is refused.
- **Reversals** take the sale's `transactionId`, a `reference` of their own, and optionally an
  `amount` (of the tax-inclusive total). Omit it to reverse whatever is left. They are stored as
  negative entries, always satisfy `sales + tax = −amount` exactly, and cannot exceed what is left.
- **Entries are immutable.** A mistake is corrected by a reversal and a new sale.

A quote is kept for 90 days, then pruned — it holds a customer's address.

### Hooks

Fired in notification mode through kempo's `triggerHook`. Register handlers in your own
`kempo-config.json`.

| Hook | Data |
|---|---|
| `tax:recorded` | `{ entry }` — a sale was recorded (not on a repeat) |
| `tax:reversed` | `{ entry, original }` — a reversal was recorded |
| `tax:uncollected-home-sale` | `{ entry }` — see below |

## Reports

**Admin > Tax > Reports** builds totals for a quarter or any date range, by currency and by
jurisdiction, and exports them as CSV. The screen and the CSV are built from one report object, so
they cannot disagree.

| Figure | Meaning |
|---|---|
| Sales | Amounts, without tax |
| Taxable | Sales that tax was charged on |
| Exempt | Sold where you collect, carrying no tax — **still reported** |
| Not collected | Sold where you have no rate — appears on **no** return |
| Tax collected / reversed / net | Sales and refunds, net |

- **A refund counts in the period it happened in**, not the period of the original sale.
- **Sales in different currencies are never added together.**
- **It is a record, not a filing.** The screen says so.
- Quarters are calendar quarters in UTC. For a fiscal calendar use a custom range (`to` is
  exclusive).

### Sales at home with no tax collected

If you set the country and state you are based in, then a sale **to there** that is recorded with no
tax collected fires `tax:uncollected-home-sale` and logs a warning. That is the case that makes a
return short silently: the rate was never entered, or the registration was never added. It cannot
catch a sale that was never recorded.

## Uninstalling

**The ledger is a legal record.** kempo drops this extension's tables on uninstall, and reinstalling
does not bring the rows back. Uninstall prints how many entries and rates are about to be lost and
points at the export. Export the ledger first: **Admin > Tax > Reports > Export the whole ledger**
(or `GET /tax/api/ledger-export`).

## SDK

| Function | Does |
|---|---|
| `calculateTax(request)` | A quote for an address and lines |
| `recordTransaction({ calculationId, reference })` | Record a finished sale in the ledger |
| `reverseTransaction({ transactionId, reference, amount? })` | Reverse some or all of a recorded sale |
| `listEntries`, `entriesInPeriod`, `buildReport`, `quarterRange` | Read the ledger and build reports |
| `listRates`, `createRate`, `updateRate`, `deleteRate`, `cleanRate` | Manage the rate table from code |
| `TAX_CLASSES`, `resolveTaxClass`, `parseAddress`, `parsePercent` | Validation, for callers that want to check first |

Everything returns `[error, data]` with `error` as `{ code, msg }`, like the rest of kempo. These
are the data operations with no permission checks of their own — the routes enforce who may do what.

### Request

| Field | Notes |
|---|---|
| `address` | `{ country (required, 2 letters), state, postalCode, city, line1 }` |
| `addressSource` | `'shipping'` (default) or `'billing'` |
| `lines[]` | `{ amount, reference?, quantity?, taxClass?, taxBehavior? }` — `amount` is the line's **total** |
| `shipping` | `{ amount, taxClass?, taxBehavior? }` |
| `currency` | Defaults to the setting |
| `taxIds` | `[{ type, value }]` — Stripe only; may make a sale B2B / reverse-charge |
| `taxDate` | Unix seconds — use the rules in force on that day |

A line with an `amount` of `0` is kept in the answer, at zero tax, and is never sent. A cart of
nothing but free items is answered without calling anything, and has no `calculationId` — there is
nothing to record.

### Result

`calculationId` (record from this), `tax`, `total`, `collecting`, `lines[]` (each with `tax`,
`netAmount`, `status`: `taxed` / `exempt` / `not_collecting` / `zero`), `shipping`, `breakdown[]`,
`currency`, `provider`, `expiresAt`.

## HTTP API

Served under `/tax/api/`, and **every route needs a signed-in user holding the permission**. There
is deliberately no anonymous endpoint: with Stripe each calculation is an API call and an open one
would let anyone spend them, and with either provider it would let anyone fill the quote table. A
storefront shows its customers a tax figure by asking from its own server through the SDK.

| Route | Permission |
|---|---|
| `POST /calculate` | `tax:calculate` |
| `POST /transactions/record`, `POST /transactions/reverse` | `tax:record` |
| `GET /rates`, `GET /rate-export`, `GET /status`, `GET /registrations`, `GET /tax-codes` | `tax:view` |
| `POST /rates`, `PUT/DELETE /rate/:id`, `POST /rate-import`, `POST /rate-quickstart` | `tax:rates` |
| `GET /ledger`, `GET /ledger-export`, `GET /reports`, `GET /report-export` | `tax:reports` |
| `GET /settings`, `PUT /settings` | `tax:settings` |

Groups: `kempo-tax:viewer`, `kempo-tax:bookkeeper` (what an order system or accountant acts as) and
`kempo-tax:administrator`. Browser client: `import { calculateTax } from '/tax/sdk.js'`.

## Failing loudly

Not connected, or Stripe unreachable, is an **error**, never a quiet zero. A checkout that silently
stops charging tax for a week because a key expired is a liability that grows with every order; a
loud failure is fixed the same afternoon. Decide in the caller what to do with one — most checkouts
should refuse to complete.

## Providers

`rates` and `stripe`, behind a small interface (`server/providers/index.js` documents it). TaxJar
and Avalara are the intended extensibility targets — each a new file there, not a change to
anything that ever called `calculateTax`.

### Stripe Tax, as it actually behaves

Verified against a live **test-mode** Stripe account on 2026-10-14: a calculation for a registered
state, an unregistered one, recording a sale and finding the transaction at Stripe under the same
reference, idempotent re-recording, a partial reversal and the remainder (each found at Stripe,
pointing at the sale), a refused over-reversal, and a report that nets to zero. The default test run
never calls Stripe; to repeat the check yourself, use a test-mode key from an account with Stripe Tax
switched on and a head office address, add a test registration, and run a calculation, a record and
a reversal through the API.

Things that only a live run showed, and that are worth knowing:

- **Stripe combines the layers of a place into one rate.** Vermont's 6% and a town's 1% arrive as a
  single `7.0`, with no jurisdiction names, so a Stripe-backed report groups by state (`VT`, rate
  `7`). The rate table is what gives a per-layer breakdown.
- **Stripe taxes shipping in proportion to the goods.** With $49.99 taxable and $10 exempt, only
  that share of an $8 shipping charge is taxed. A rate-table `appliesToShipping` row taxes shipping
  in full or not at all, so for a state that works proportionally the two will differ by a few cents.
- **Stripe returns a rate for any address and `not_collecting` outside your registrations**, which
  is what `collecting` reports.
- **The six class names resolve to the right categories.** Each id was checked against Stripe's own
  list of 677 codes: `txcd_99999999` General - Tangible Goods, `txcd_10000000` Electronically
  Supplied Services, `txcd_10103000` / `txcd_10103001` SaaS personal / business use,
  `txcd_00000000` Nontaxable, `txcd_92010001` Shipping.

## Not here

- **Filing returns, registering, and paying.**
- **An address book.** The caller owns addresses; this takes a plain object.
- **Shipping rates.** This works out tax *on* a shipping charge, not what to charge.
- **Exemption certificates and resale handling.**
- **A bundled rate dataset.** Deliberately — see above.

## Development

```bash
npm install
npm run link:local   # symlink sibling kempo checkouts; never commit a file: specifier
npm test
```

Tests run against an in-memory Postgres (PGlite) and never call Stripe. A symlinked `kempo` cannot
see this package's test dependencies; to run them as CI does, install the registry copies instead:
`npm install --no-save --no-legacy-peer-deps --force kempo@latest kempo-ui@latest kempo-server@latest`.
