# kempo-tax

Sales tax, VAT and GST for the [kempo](https://github.com/dustinpoissant/kempo) CMS. Hand it an
address and some items, get back what tax to charge — without this site keeping a table of rates.

[Stripe Tax](https://stripe.com/tax) is the service that ships. Rates, rules and taxability differ by
place and by what is sold, and they change constantly, so none of that is stored here: every
calculation is asked of Stripe, which keeps them current.

This kempo (CMS) extension depends on no other kempo extension. It has no catalog, no cart and no
idea what a "product" is — the caller supplies the classification of each line, which is what lets a
subscription, a donation or an invoice use it exactly as a store checkout does. It sits beside
[kempo-payments](https://github.com/dustinpoissant/kempo-payments), not on top of it: one works out
what is owed, the other moves the money, and either can be swapped without touching the other.

## What it is for

Other kempo (CMS) extensions.

```js
import { calculateTax, recordTransaction } from 'kempo-tax/sdk';

const [error, quote] = await calculateTax({
  address: { country: 'US', state: 'CA', postalCode: '94103' },
  lines: [
    { amount: 4999, reference: 'sku-1', taxClass: 'physical' },
    { amount: 1500, reference: 'sku-2', quantity: 3, taxClass: 'digital' },
  ],
  shipping: { amount: 800 },
});

// quote.tax          what is owed
// quote.total        what to charge — hand this to createPayment
// quote.collecting   true when this site is registered here and so will actually charge it
// quote.lines[]      the tax on each line, matched back by your reference
// quote.breakdown[]  per jurisdiction: name, rate, taxable amount, amount

// …and once the payment has *succeeded*, not before:
await recordTransaction({ calculationId: quote.calculationId, reference: order.id });
```

All amounts are integers in the currency's smallest unit — `4999` is $49.99 — the same as
kempo-payments, so `quote.total` goes straight into `createPayment`.

## Install

```bash
npm install kempo-tax
```

Install it from **Admin > Extensions**, then open **Tax** in the admin menu and:

1. Save a Stripe **secret key**. If kempo-payments is installed and connected, this one is optional —
   its key is used when this extension has none of its own, and the screen says so.
2. Switch on Stripe Tax in the Stripe dashboard if it is not already (the screen tells you what is
   still missing).
3. Register in the places you are required to collect — also in the Stripe dashboard.

`SETTINGS_ENCRYPTION_KEY` must be set on the server, because the key is stored encrypted. Without it
kempo silently cannot create the setting, so the install says so loudly.

## Connected is not the same as collecting

This is the thing most worth understanding before relying on it.

Stripe will calculate a rate for any address. It only *collects* where your account is **registered**.
Everywhere else the tax comes back as `0` with the reason `not_collecting` — which is correct and not
a fault: a small seller under every threshold owes nothing anywhere.

So `quote.collecting` distinguishes "this is a 0% rate" from "you are not registered here". A checkout
that shows a tax line should show it when `collecting` is true and `tax` is non-zero, and it is why
the **Where tax is collected** tab leads with a plain-words banner stating which situation the site is
in rather than an empty table.

> **This extension looks tax up. It does not register you with, or file returns to, any tax
> authority.** Whether you owe tax, where, and from when depends on where you are based, where your
> customers are, how much you sell and what you sell. Talk to an accountant, and use Stripe's
> registration and filing tools.

## Tax classes

Say what *kind* of thing a line is; Stripe decides whether it is taxable and at what rate in each
place.

| Class | Meaning |
|---|---|
| `physical` | General tangible goods |
| `digital` | Electronically supplied services and digital goods |
| `saas` | Software as a service, personal use |
| `saas-business` | Software as a service, business use |
| `nontaxable` | Never taxed |
| `shipping` | Shipping and delivery charges |

Anything else is a Stripe tax code (`txcd_…`), passed as `taxClass` directly. The **Settings** tab
lists Stripe's full set. A line that names no class uses the **default tax category** from settings,
or Stripe's own default from the dashboard if that is blank.

## Prices that already include tax

Off by default, which is US-style pricing: tax is added on top. Turn **Prices already include tax** on
for VAT-style pricing, where the sticker price is what the customer pays and the tax is inside it. A
single line can override either way with `taxBehavior: 'inclusive' | 'exclusive'`.

In the result, `taxAmountExclusive` is tax to *add* and `taxAmountInclusive` is tax already *inside*
the amounts. `tax` is their sum and `total` is what is actually charged.

## Business customers

Pass `taxIds: [{ type: 'eu_vat', value: 'DE123456789' }]` and Stripe may treat the sale as B2B, which
can mean reverse-charge and no tax. Stripe checks that an id is well-formed, **not that it is valid** —
if you need it verified, do that before asking.

## Recording and reversing

A calculation is a quote. It is safe to ask as often as the page changes, and nothing is reported
anywhere. It only *counts* — appears in Stripe's tax reports and advances a registration threshold —
once you record it.

```js
// when the payment has succeeded:
const [, sale] = await recordTransaction({ calculationId: quote.calculationId, reference: order.id });

// on a refund — whole, or part of the tax-inclusive total:
await reverseTransaction({ transactionId: sale.transactionId, reference: `${order.id}-refund-1` });
await reverseTransaction({ transactionId: sale.transactionId, reference: `${order.id}-refund-2`, amount: 1000 });
```

Both are idempotent on `reference`, so a webhook delivered twice records once. A calculation expires
after 90 days; a sale completing later than that must be calculated again first.

## SDK

| Function | Does |
|---|---|
| `calculateTax(request)` | A quote for an address and lines |
| `recordTransaction({ calculationId, reference })` | Make a finished sale reportable |
| `reverseTransaction({ transactionId, reference, amount? })` | Reverse some or all of a recorded sale |
| `TAX_CLASSES`, `resolveTaxCode`, `parseAddress` | The class names and validation, for callers that want to check first |

Everything returns `[error, data]` with `error` as `{ code, msg }`, like the rest of kempo. These are
the data operations with no permission checks of their own — the routes enforce who may do what.

### Request

| Field | Notes |
|---|---|
| `address` | `{ country (required, 2 letters), state, postalCode, city, line1 }` |
| `addressSource` | `'shipping'` (default) or `'billing'` — which kind of address that was |
| `lines[]` | `{ amount, reference?, quantity?, taxClass?, taxBehavior? }` — `amount` is the line's **total** |
| `shipping` | `{ amount, taxClass?, taxBehavior? }` |
| `currency` | Defaults to the setting |
| `taxIds` | `[{ type, value }]` |
| `taxDate` | Unix seconds — use rules in force on that day (±31 days) |

A line with an `amount` of `0` is kept in the answer, at zero tax, and is never sent. A cart of nothing
but free items is answered without calling Stripe at all.

## HTTP API

Served under `/tax/api/`, and **every route needs a signed-in user holding the permission**. There is
deliberately no anonymous endpoint: each calculation is a call to Stripe, and an open one would let
anyone spend them. A storefront shows its customers a tax figure by asking from its own server.

| Route | Permission |
|---|---|
| `POST /calculate` | `tax:calculate` |
| `POST /transactions/record` | `tax:record` |
| `POST /transactions/reverse` | `tax:record` |
| `GET /status`, `GET /registrations`, `GET /tax-codes` | `tax:view` |
| `GET /settings`, `PUT /settings` | `tax:settings` |

Browser client: `import { calculateTax } from '/tax/sdk.js'`.

## Failing loudly

Not connected, or Stripe unreachable, is an **error**, never a quiet zero. A checkout that silently
stops charging tax for a week because a key expired is a liability that grows with every order; a loud
failure is fixed the same afternoon. Decide in the caller what to do with one — most checkouts should
refuse to complete.

## Providers

Only Stripe Tax ships, behind a small provider interface from the first commit
(`server/providers/index.js` documents it). TaxJar, Avalara and a plain rate table for a seller with
one jurisdiction are the intended extensibility targets — each a new file there, not a change to
anything that ever called `calculateTax`.

## Not here

- **Filing returns, and registering.** Stripe's dashboard and its filing partners.
- **An address book.** The caller owns addresses; this takes a plain object.
- **Shipping rates.** A separate concern — this works out tax *on* a shipping charge, not what to charge.
- **A rate table of its own.** Deliberately. See above.

## Development

```bash
npm install
npm run link:local   # symlink sibling kempo checkouts; never commit a file: specifier
npm test
```

The tests use an in-memory database and never call Stripe. A symlinked `kempo` cannot see this
package's test dependencies; to run them as CI does, install the registry copies instead:
`npm install --no-save --no-legacy-peer-deps --force kempo@latest kempo-ui@latest kempo-server@latest`.
