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

### Not yet verified

The Stripe module is written against the installed SDK's own type definitions and its request and
response shaping is covered by tests. It has **not** been exercised against a live Stripe account —
that needs a key with Stripe Tax switched on. The README has a manual procedure. The ids behind the
`saas` and `saas-business` classes should be checked against Stripe's own list before use.

## 0.1.0

First release. Tax lookup with Stripe Tax: `calculateTax`, `recordTransaction`,
`reverseTransaction`, tax classes, an admin screen with registrations, and settings.
