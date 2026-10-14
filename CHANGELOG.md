# Changelog

All notable changes to `kempo-tax` are documented in this file.

## [Unreleased]

First release. Tax lookup for kempo, with Stripe Tax built in and a provider seam from the first
commit.

### Added

- **`calculateTax`** — an address and lines in, tax per line, per jurisdiction and in total out, in
  one provider-independent shape. `collecting` says whether the site is registered where the
  customer is, so a 0% rate can be told apart from "not registered here".
- **`recordTransaction` and `reverseTransaction`** — turn a finished sale into something Stripe
  reports and counts toward thresholds, and reverse it for a refund, whole or in part. Idempotent on
  the caller's reference.
- **Tax classes** (`physical`, `digital`, `saas`, `saas-business`, `nontaxable`, `shipping`), plus any
  raw Stripe `txcd_…` code.
- **Prices that include tax**, as a site default and per line.
- **Business tax ids** for reverse-charge and exemptions.
- **Admin screen** — where tax is being collected (read from Stripe), a calculation tester, and
  settings.
- **Key fallback** — uses kempo-payments' Stripe key when none is saved here, and says so.
- **Provider interface**, documented in `server/providers/index.js`.

### Not yet verified

The Stripe module is written against the installed SDK's own type definitions and its request and
response shaping is covered by tests. It has **not** been exercised against a live Stripe account in
this release — that needs a key with Stripe Tax switched on.
