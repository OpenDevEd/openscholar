# Credits and subscriptions on self-hosted Autumn

Issue: OpenDevEd/openalex-count#270. Workflow rules live in the root
`AGENTS.md` and `docs/agents/project.md`. The user signs off before merge.

## Problem

OpenScholar runs its own billing: a credit ledger with free and paid pools,
sharded balance counters, facet aggregates, Stripe invoice and refund
handling, pro-rata grants, drift audits, per-paper admission estimates, and
chat generation reconciliation. It adds up to about 7,500 lines of backend
code and 16,000 lines of tests, and every new parallel workload has added
more of it. Autumn (`useautumn/autumn`, Apache-2.0) does balances, locks,
plans, Stripe subscriptions, and proration, and we can host it ourselves.

## Fixed decisions (2026-09-28)

1. Autumn owns balances, plans, subscriptions, top-ups, proration, and
   Stripe products, prices, and subscription webhooks. Stripe stays the
   payment processor.
2. Autumn is self-hosted on the Hetzner Coolify from a pinned commit
   (`e16a31db`). Trial service `autumn-billing-trial`
   (`1wqnx1zrn24l1eosrk8nviau`), API `https://autumn-api.opendev.space`.
3. The catalog lives in `autumn.config.ts` and is pushed with `atmn push`.
   Product rules stay as they are today:
   - Free: 500 signup credits, once.
   - Go: $5/month, 3,000 credits, unused credits roll over up to 3,000.
   - Pro: $20/month, 15,000 credits, roll over up to 15,000.
   - Top-ups: $1 per 10,000 credits. They never expire.
   - AI cost: `ceil(usd × 1.3 × 10,000)`, minimum 1 credit when there was usage.
4. Every balance comes from a plan. `balances.create` standalone grants are
   never used, because under concurrency they overspend and don't restore on
   release (see the trial results).
5. Convex calls Autumn over HTTP with a small typed client. `autumn-js`
   fails this repo's strict peer resolution.
6. Every charge that can run in parallel takes an Autumn lock for its
   estimate, then settles:
   - It releases the lock and charges the real amount with one `track`
     call (`overage_behavior: "cap"`, idempotency key = the charge id), and
     records what Autumn reports it deducted. A retry never charges twice,
     so a failed settle is retried in the background. Confirming the lock
     instead can't be retried safely, because after a partial failure the
     retry charges again. Near a zero balance, a parallel job can take the
     released credits first, so the charge can come out slightly low.
   - A Convex scheduled function releases the lock at its expiry, because
     self-hosted Autumn never expires locks, and retries if Autumn is down.
7. Usage history is an append-only Convex table written when a charge
   settles. Autumn's `events.list` needs Tinybird, which isn't open source.
8. A Convex snapshot row per user holds plan, status, and balance for
   reactive UI and plan checks. It's refreshed after every Autumn call we
   make, and whenever a Stripe webhook nudges it.
9. The Stripe webhook in Convex does two things only:
   - nudges a snapshot refresh, and again 15 seconds later, because Autumn
     applies the same Stripe event on its own schedule;
   - reverses credits for refunded top-ups, which Autumn does not do.
10. A Stripe refund of a top-up removes the refunded share of its credits
    and never goes below zero.

## Trial results (2026-09-28, Autumn e16a31db)

Checked against the live trial with Stripe test mode and test clocks. The
probe scripts are kept outside the repo, in `_scratch/autumn-coolify`.

| Behavior | Result |
|---|---|
| 60 parallel 20-credit locks on a 500 plan balance | exactly 25 allowed; releases restore 500 |
| Same on a `balances.create` grant | 27–47 allowed, releases don't restore: **not used** |
| Confirm above the lock with room | charges the full amount |
| Confirm above what's available | HTTP 500, lock stays: confirm the locked amount, then track the rest with cap |
| Same lock finalized twice | second call is refused, nothing more is charged |
| Three concurrent tracks sharing one `Idempotency-Key` | charged once (409 for the others) |
| Track above balance with cap | drains to 0 |
| Lock expiry | never fires self-hosted (EventBridge only) |
| Attaching the signup add-on twice | grants twice: we guard it |
| Go subscribe with a saved card | $5 invoice, +3,000 |
| Deduction order | plan month → signup one-off → top-up |
| Renewal (test clock) | refills to 3,000, rolls unused over |
| Upgrade Go → Pro | prorated charge, full 15,000 immediately; the old month's leftover is dropped |
| Downgrade | scheduled for period end |
| Cancel at period end | back to Free, top-up credits kept |
| Failed renewal | `past_due: true`, no refill, usage still allowed |
| Stripe refund of a top-up | credits unchanged: we handle it |
| `billing.import` of an old-price subscription | links it, keeps exact balances, renews and upgrades normally |
| `events.list` | fails without Tinybird |
| Checkout started twice with the same request | Autumn reuses the first session for about 24 hours, even after Stripe expires it: each request gets a unique return URL |
| Card added in the Stripe portal | Autumn shows it; our snapshot needs `payment_method.*` and `customer.updated` events |
| OpenRouter generation record after a stopped stream | published about 15 seconds later with the billed cost, for OpenAI and Google AI Studio (Google bills the full response) |
| Stripe Checkout in an automated browser | blocked by hCaptcha, so hosted Checkout completion is checked by hand |

Upgrade credits differ from today: the old code granted prorated credits on
upgrade. Autumn grants the full new allowance and charges a prorated price.
This plan keeps Autumn's behavior.

## Ownership

| Invariant | Owner |
|---|---|
| Balance, plan, subscription, top-up | Autumn |
| Autumn HTTP calls and diagnostics | `convex/billing/autumn.ts` |
| Reserve, settle, release, charge | `convex/billing/charge.ts` |
| USD → credits | `lib/pricing` (`convertUsdToCredits`) |
| Usage history | `billingUsage` table, written only by `charge.ts` |
| Plan/balance snapshot | `billingAccounts` table, written only by `convex/billing/accounts.ts` |
| Customer provisioning and signup grant | `convex/billing/accounts.ts` |
| Checkout, portal, plan change, top-up | `convex/billing/actions.ts` (Autumn `billing.attach`/`update`/portal) |
| Refund reversal and snapshot nudges | `convex/billing/stripeWebhook.ts` |

## Scope

Delete:
- `convex/credits/`, `convex/subscriptions/`, `convex/stripe.ts`,
  `convex/ai/lib/{applyBatchItemDeductions,collectBillableItemIds}.ts`,
  `convex/extraction/creditAdmissions.ts`.
- The `@convex-dev/stripe` component, and the aggregate and
  sharded-counter instances used only for billing.
- The `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`,
  and `stripeEventLogs` tables once the migration has run.
- The billing migrations, the live-billing tests, and the billing nightly
  workflow.

Rewire each consumer to reserve and settle:
- `convex/ai/helpers.ts`, covering search, screening, translation, and
  question generation.
- Chat turns. One lock per turn, settled with OpenRouter's reported cost.
  A stopped turn settles from the OpenRouter generation record, which
  carries what OpenRouter billed.
- Extraction. The paper worker locks its estimate; the dispatcher no
  longer admits credits.
- The wallet gateway.

UI:
- The billing page shows plan, balance, top-ups, and portal from the snapshot
  and Autumn actions.
- The pricing page's checkout uses Autumn.
- Usage history reads `billingUsage`.
- Feature-flag tiers and plan limits read the snapshot.

## Data migration

Saved billing data is live in production (`main`), so it's migrated, never
wiped.

1. Keep the old tables readable until the import is verified.
2. `convex/billing/migrate.ts` builds one `billing.import` body per user:
   - the Stripe customer from `billingCustomers`;
   - the active subscription from `subscriptions`, linked by its Stripe
     subscription id;
   - the free-pool balance as the plan balance;
   - the paid-pool balance as a `top_up` one-off balance.

   It runs with `dry_run: true` over every user first, and reports each
   mismatch.
3. Map the Autumn Go and Pro plans to the existing Stripe products and prices
   in production (`processors.stripe`), so live subscriptions keep their
   prices.
4. Run the real import, then compare every user's Autumn balance with the old
   ledger balance. Any difference blocks the release.
5. Drop the old tables in a later deployment.

## Checks

- Unit tests: `convertUsdToCredits`, and settle's lock/extra split, via a
  local fake Autumn at the HTTP boundary.
- Trial Convex: `https://convex-billing.opendev.space`, Coolify service
  `saajwuxr55eumsiw2aphpa3i`.
- Push the branch there. Then check by browser, with AI calls through
  OpenRouter `openai/gpt-6-luna` at low reasoning:
  - sign-up grant;
  - chat, including a stop;
  - extraction with parallel papers until credits run out, then top-up and resume;
  - screening;
  - wallet API;
  - subscribe, upgrade, cancel, and top-up with Stripe test cards.
- Migration dry run against a copy of the shared dev data.
- CI on the PR. No merge until the user signs off.

## Risks

- Autumn's self-hosting is second-class: AWS-shaped queues, EventBridge, and
  Tinybird. We pin a commit and rerun the probe scripts before every bump.
- A billing call now depends on Autumn being up. Charges fail closed, meaning
  no lock means no AI call, and the failures are logged with Autumn's
  response.
- Balance snapshots can lag Stripe-driven changes until the next nudge or
  charge.
