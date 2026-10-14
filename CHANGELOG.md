# Changelog

All notable changes to `kempo-tax` are documented in this file.

## [Unreleased]

### Added

- **Rate table provider (`rates`).** Tax worked out from rows the site maintains — no external
  service, no per-transaction fee, any payment processor. Rows are *layers* that stack by level
  (a state rate plus a local option), the most specific row at a level wins, and a place with no row
  is `not_collecting`, distinct from an `exempt` row. Postal patterns (exact, prefix, range),
  effective dates, tax-inclusive lines, shipping rows, per-line or per-invoice rounding, and
  origin sourcing for the states that need it.
- **Exact arithmetic.** Rates are integer millionths of a percent and tax is computed in BigInt.
- **Tax ledger** (`kempoTaxEntry`): every recorded sale and reversal, written for every provider,
  immutable, unique on `(kind, reference)`, with the three-way split a return needs (taxable,
  exempt, not collected).
- **Reports**: a quarter or any date range, by currency and jurisdiction and month, with CSV
  export from the same object as the screen. Refunds count in the period they happened in.
- **Quotes** (`kempoTaxQuote`): what the site calculated, kept 90 days, so a sale is recorded from
  what it worked out and never from figures handed back to it.
- **Reversals are proportional and exact**: a partial refund always satisfies
  `sales + tax = −amount`, cannot exceed what is left, and is idempotent on its reference.
- **Home-state quick start**, rate CSV import/export (all-or-nothing, strict columns), and a rate
  editor on the Rates tab. A rate is *ended*, not edited, so history stays reproducible.
- **Sales at home warning**: `tax:uncollected-home-sale` hook and log when a sale to the state you
  are based in is recorded with no tax collected.
- **Hooks** `tax:recorded`, `tax:reversed`.
- **Permissions** `tax:rates`, `tax:reports`; **group** `kempo-tax:bookkeeper`.
- **Uninstall warning** that names how many ledger entries and rates will be dropped, and the export.

### Changed

- `calculationId` is now this extension's own id (`taxq_…`), not Stripe's. Stripe's is
  `providerCalculationId`. Pass `calculationId` to `recordTransaction` exactly as before.
- `recordTransaction` and `reverseTransaction` return a ledger-based result:
  `transactionId` is `taxe_<n>`, with `providerTransactionId` holding Stripe's. A Stripe `tax_…` id
  is still accepted by `reverseTransaction`.
- Result lines now carry `netAmount`, `status` and `taxClass`.
- `drizzle-orm` is a runtime dependency (the extension now has tables).
- **One default class, for every provider.** The `default_tax_code` and `shipping_tax_code`
  settings are gone. `default_tax_class` takes a class name (`physical`) or a Stripe category id
  and is resolved to both, so a line that names nothing carries the name a rate table matches on
  and the id Stripe is sent. Shipping always uses its own `shipping` class. An unusable default is
  refused loudly rather than ignored.

### Verified

The Stripe provider was run against a live test-mode account: calculate (registered and
unregistered), record, idempotent re-record, partial and full reversal (each found at Stripe), and a
report that nets to zero. All six class ids were checked against Stripe's own tax code list.

### Fixed by that run

- A Stripe breakdown names a place only by `state` and `country` and carries no jurisdiction
  object, so reports grouped on `null`. It is now named by its state, at level `state`, with the rate
  normalised (`7.0` → `7`).
- A reversal now keeps Stripe's own transaction id, so it can be found at Stripe from the ledger.

## 0.1.0

First release. Tax lookup with Stripe Tax: `calculateTax`, `recordTransaction`,
`reverseTransaction`, tax classes, an admin screen with registrations, and settings.
