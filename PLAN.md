# kempo-tax — PLAN: rate table provider, ledger and reports

> Status: **built (this plan is implemented).** The rate table provider, the ledger, reports, the
> home-state quick start, rate CSV import/export, the home-sale warning and the uninstall warning
> are all in. Two items remain and are listed under "Outstanding" at the end of this file. The text
> below is kept as the design record — read it before changing the behaviour it describes.

> **Upstream changes are allowed.** Every dependency with `kempo` in its name (kempo, kempo-ui,
> kempo-css, kempo-server, kempo-payments, kempo-media, and the rest) is owned by the same person, and
> the goal of this project is to keep improving all of them. If the work here needs a change in one of
> them — a UI component, a payment call, a CMS hook — **make it, in that repository, without asking
> and without deferring it to a later step.** Do it the normal way there: tests, README and CHANGELOG,
> a backwards-compatible change where other packages depend on it, and the dependency order when
> publishing. Never commit a `file:` specifier.

## What exists

`calculateTax`, `recordTransaction`, `reverseTransaction`, tax classes, a Stripe Tax provider and an
admin screen. **No database tables.** It is a lookup: it does not remember anything.

## What is being added, and why

The site owner (Vermont, US) will sell in one state they are based in, and may sell in a few more
later. They do **not** want a per-transaction service for that, and they need a record of what they
owe to file their own return. That is how WooCommerce works: a rate table per location and class,
tax added to the order, a report of what was collected.

Three additions:

1. **A second provider, `rates`** — a table the owner maintains. No external service, no
   per-transaction fee, works whatever payment processor is used.
2. **A tax ledger** — every recorded sale and reversal is stored locally, **whichever provider
   produced it**. This is the first database table in the extension.
3. **Reports** — totals by period, place and class, in the shape a return asks for, as CSV too.

The Stripe provider stays as the other option. Moving from `rates` to Stripe when one state becomes
many should be a settings change.

## Not in scope

- **Filing returns or remitting tax.** The owner does that on the state's portal. This produces
  the numbers; it never talks to a tax authority.
- **Registering for tax anywhere.**
- **Exemption certificates and resale handling.** Out of v1.
- **A bundled rate dataset for every jurisdiction.** The owner enters theirs. See Vermont below.

## Provider: `rates`

Implements the contract documented in `server/providers/index.js`.

### Tables

`kempoTaxRate`: `country`, `state`, optional `locality` (a town or district name),
optional `postalPattern`, `taxClass`, `rate` (decimal percentage, stored as a string or integer
basis points — **never a float**), `appliesToShipping`, `effectiveFrom`, `effectiveTo`, `label`,
`jurisdiction` (the name shown on reports), `priority`.

### Resolution

- Match the destination address against rates, **most specific wins**: locality or postal pattern
  over state over country.
- A rate that applies *in addition* (a local option on top of a state rate) is a separate row of
  its own, and both apply. Do not model it as an override; model it as a stack, ordered by priority,
  and report each layer as its own jurisdiction line.
- A line whose class has **no row for that place** is taxed at 0 and reported as `not_collecting`,
  so `collecting` keeps meaning what it means with Stripe: "this site charges tax here".
- A class may be explicitly **exempt** (a row with rate 0 and an exempt flag) which is *reported
  differently* from "not collecting": exempt sales appear on a return, uncollected ones do not.
- **Destination sourcing is the default** (tax by where it is delivered). Make origin sourcing a
  per-state option; do not hard-code either.
- Rounding: round **per line** by default, configurable to per invoice. Document which and why;
  state rules differ and the owner must be able to match theirs.
- Dates: use the rate in force on `taxDate`, defaulting to now.

### Admin

A rate table editor: add, edit, end-date (not delete — a rate that was in force must remain
reportable), copy a row to a new class, import and export CSV. A "home" wizard that asks for the
owner's state and creates the first rows.

## The ledger

Table `kempoTaxEntry`: `kind` (`sale` | `reversal`), `reference` (the caller's unique id),
`calculationId`, `currency`, `taxableAmount`, `exemptAmount`, `taxAmount`, `jurisdictions` (JSON:
the breakdown), `address` country/state/postal, `occurredAt`, `provider`, `livemode`, `originalEntryId`
for a reversal.

- Written by `recordTransaction` and `reverseTransaction` **for every provider**, in the same
  operation as the provider call where one exists.
- **Unique on `reference`** (per kind), created by hand in `install.js` — kempo's installer does not
  carry indexes across from the schema. Recording the same sale twice must be a no-op returning the
  first entry.
- Immutable. A correction is a reversal plus a new sale.

### The uninstall problem

kempo drops an extension's tables on uninstall. **This ledger is a legal record**, kept for years.
`uninstall.js` must say so loudly, print a count, and refuse to be quiet about it, as kempo-payments'
does for payments. Also provide an **export** (CSV of the whole ledger) and recommend it in the
warning.

## Reports

- By period (month, quarter, year, custom), grouped by jurisdiction and class.
- Columns a return needs: gross sales, exempt sales, taxable sales, tax collected, tax reversed,
  net tax owed.
- CSV export; the admin screen and the export must agree to the cent, with a test that enforces it.
- Reversals appear in the period they **occurred**, not the period of the original sale, and the
  report must say so.
- A report is a **record, not a filing.** The screen says that in words.

## Smaller items

- **First-sale warning.** If the owner has no registration anywhere and an order arrives for the
  state they are based in, `calculateTax` reports `collecting: false` — which is how a home-state
  sale goes untaxed by accident. Surface a warning on the admin screen and fire a hook
  `tax:uncollected-home-sale` once per occurrence. Needs a "home state" setting.
- **Stripe provider verification** (carried from v0.1): the module has never run against a live
  account. Add a documented manual test-mode procedure, and verify every `txcd_` id behind the class
  names against Stripe's own list (`/tax/api/tax-codes`) — they were written from memory.
- Per-region rows for **the rate table** use ISO 3166-2 codes where possible.

## Vermont (the first user)

The first owner is in Vermont, which taxes by destination and has municipalities with a local
option tax on top of the state rate. **Do not hard-code Vermont rates in the package.** Rates change,
and shipping stale ones is worse than shipping none. Provide the home wizard and the import format;
the owner enters or imports the current state rate and the local-option towns from the Vermont
Department of Taxes' own published list, and the README links to it. Taxability by category
(Vermont exempts some, such as clothing and food) is the owner's to set per class.

## Dependencies

None added. It remains independent of kempo-payments. kempo-credits and kempo-commerce call it
optionally at runtime.

## Conventions an agent must follow

Follow `~/dev/kempo/AGENTS.md` and `~/dev/kempo-payments`. Specifically:

- Pure validation and arithmetic stays in `server/utils/tax/shape.js`-style modules with no network
  and no database, and is tested with plain objects. **Money is integers; rates are never floats.**
- Everything under `server/utils/` returns `[error, data]` and never throws.
- Tables need a hand-written `install.js` index step and an `update.js` that is idempotent, plus a
  test that the schema and `install.js` agree.
- Tests: `kempo-test`, PGlite unit tier. The default run must never call live Stripe.
- Update README and CHANGELOG with every behaviour change. Never start/stop dev servers.

## Definition of done

- `rates` provider passes the same shaped tests as Stripe's, plus stacking, exempt vs
  not-collecting, effective dates and sourcing.
- Switching provider in settings changes nothing for a caller.
- Ledger is idempotent on `reference`, immutable, and written for both providers.
- Reports match the CSV exactly, tested; quarterly boundaries tested, including a reversal that
  crosses a period.
- Uninstall warns and export works.
- Home wizard and rate editor loaded and checked in a browser.
- README and CHANGELOG updated. Published as a **minor** version.

## Outstanding

Not done, and not possible from a development checkout:

- **Run the Stripe provider against a live test-mode account.** It has only been written against
  the SDK's types and tested for request/response shaping. The manual procedure is in the README.
- **Verify every `txcd_` id behind the class names** (especially `saas` and `saas-business`)
  against Stripe's own list at `/tax/api/tax-codes`. They were written from memory.

Deliberately left for later:

- Exemption certificates and resale handling.
- A third provider (TaxJar, Avalara).
- An origin-sourcing rule richer than "the seller's own state, from the seller's own address".
- Fiscal-year periods as a first-class choice (a custom range does the job today).
