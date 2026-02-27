# Architecture Research

**Domain:** Stripe billing integration in Convex + Next.js (subscription management, credit system, webhook handling)
**Researched:** 2026-02-27
**Confidence:** HIGH (based on direct codebase analysis of existing implementation)

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STRIPE (External)                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Subscriptions│  │   Invoices   │  │   Checkout   │  │   Customer   │   │
│  │  API          │  │   API        │  │   Sessions   │  │   Portal     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │                  │           │
│         └────────┬────────┴─────────┬────────┘                 │           │
│                  │                  │                           │           │
│          Webhook Events      Checkout Redirect           Portal Redirect   │
└──────────────────┼──────────────────┼──────────────────────────┼───────────┘
                   ↓                  ↓                          ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CONVEX HTTP ROUTER (convex/http.ts)                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  @convex-dev/stripe registerRoutes                                  │   │
│  │  POST /webhooks/stripe  →  onEvent (audit log)  →  event handlers  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                    WEBHOOK EVENT HANDLER (Audited Router)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Subscription │  │  Invoice    │  │  Payment     │  │  Charge     │      │
│  │ Events       │  │  Events     │  │  Intent      │  │  Refund     │      │
│  │ (3 handlers) │  │ (5 handlers)│  │ (1 handler)  │  │ (1 handler) │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                 │                │              │
├─────────┴────────────────┴─────────────────┴────────────────┴──────────────┤
│                        DOMAIN MODULES (convex/)                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │  subscriptions/   │  │  credits/         │  │  ai/helpers.ts   │         │
│  │  ├── actions.ts   │  │  ├── actions.ts   │  │  (credit         │         │
│  │  ├── internal.ts  │  │  ├── internal.ts  │  │   deduction      │         │
│  │  ├── queries.ts   │  │  ├── queries.ts   │  │   at usage time) │         │
│  │  └── lib/         │  │  └── lib/         │  └──────────────────┘         │
│  └──────────────────┘  └──────────────────┘                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                        DATA LAYER (convex/schema.ts)                       │
│  ┌──────────┐ ┌────────────────┐ ┌───────────────┐ ┌───────────────────┐  │
│  │subscrip- │ │credits         │ │creditTransac-  │ │billingCustomers   │  │
│  │tions     │ │                │ │tions           │ │                   │  │
│  └──────────┘ └────────────────┘ └───────────────┘ └───────────────────┘  │
│  ┌───────────────────┐                                                     │
│  │stripeEventLogs    │                                                     │
│  └───────────────────┘                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                        CRON LAYER (convex/crons.ts)                        │
│  ┌──────────────────────────────────────────────────────────┐             │
│  │ hourly: reconcileRecentPaidInvoicesFromStripe             │             │
│  │ daily:  checkSubscriptionStatus                           │             │
│  └──────────────────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| **Webhook Router** | Receives Stripe events, verifies signatures, dispatches to typed handlers, records every event in audit log | `convex/http.ts` (via `@convex-dev/stripe` `registerRoutes`) |
| **Subscription Manager** | Creates checkout sessions, manages plan changes (upgrade/downgrade via subscription schedules), syncs Stripe state to local DB, handles cancellation | `convex/subscriptions/actions.ts`, `convex/subscriptions/internal.ts` |
| **Credit System** | Grants monthly credits on invoice.paid, grants purchased credits on payment_intent.succeeded, deducts credits on AI usage (free-first then paid), reverses credits on refund | `convex/credits/actions.ts`, `convex/credits/internal.ts` |
| **Billing Customer Linker** | Maintains durable user-to-Stripe-customer mapping (`billingCustomers` table), deduplicates on conflict | `convex/subscriptions/internal.ts` (upsertBillingCustomerLinkRecord) |
| **Event Audit Log** | Records lifecycle of every Stripe event (received -> processed/retrying/failed/ignored), prevents double-processing | `convex/subscriptions/internal.ts` (stripeEventLogs mutations) |
| **Invoice Grant Policy** | Classifies invoices as grant-eligible (subscription_create, subscription_cycle), non-recurring, or config drift | `convex/credits/lib/invoiceGrantPolicy.ts` |
| **Retry Policy** | Exponential backoff for credit grants (5s, 15s, 30s, 60s, 120s, 300s) -- 6 attempts max | `convex/credits/lib/retryPolicy.ts` |
| **Schedule Planning** | Builds Stripe SubscriptionSchedule phases for downgrades, resolves pending changes, determines change type | `convex/subscriptions/lib/schedulePlanning.ts` |
| **Entitlements** | Resolves effective plan from subscription status, defines entitled vs non-entitled statuses | `lib/billing/entitlements.ts` |
| **Credit Billing (AI)** | Converts AI token usage to credit cost via provider pricing + 1.3x markup, enforces minimum 1-credit floor | `convex/ai/lib/creditBilling.ts` |
| **User Creation** | Provisions new users with free subscription + 1,000 signup credits | `convex/lib/userCreation.ts` |
| **Reconciliation Cron** | Hourly pull-based reconciliation of paid invoices (catches missed webhooks) | `convex/crons.ts` -> `credits.actions.reconcileRecentPaidInvoicesFromStripe` |
| **Feature Flags** | Gate subscriptions, credits, and topups via env vars | `convex/lib/featureFlags.ts` |

## Data Flow

### 1. New Subscription (Checkout)

```
User clicks "Subscribe"
    |
    v
[subscriptions/actions.ts: createCheckoutSession]
    |-- Validates price ID against allowed list
    |-- Gets/creates Stripe customer (via @convex-dev/stripe)
    |-- Upserts billingCustomers link
    |-- Creates Stripe Checkout Session (mode: "subscription")
    |
    v
User redirected to Stripe Checkout
    |
    v
Stripe fires events:
    |
    |-- checkout.session.completed
    |       |-- Triggers immediate reconcile for the customer
    |
    |-- customer.subscription.created
    |       |-- syncSubscription mutation
    |       |-- Resolves userId from subscription/customer/metadata
    |       |-- Upserts billingCustomers link
    |       |-- Creates/updates subscriptions record (plan, status, period, creditsPerMonth)
    |
    |-- invoice.paid
    |       |-- processInvoiceForGrantNonBlocking
    |       |-- Retrieves full invoice from Stripe API
    |       |-- Classifies via invoiceGrantPolicy (subscription_create -> grant)
    |       |-- Finds subscription in local DB
    |       |-- Grants monthly credits to credits.freeBalance (capped by plan tier)
    |       |-- Records creditTransaction (type: "grant")
    |       |-- Marks stripeEventLog as "processed"
    |
    v
UI reactively updates via Convex subscriptions
```

### 2. Plan Change (Upgrade / Downgrade)

```
User selects new plan
    |
    v
[subscriptions/actions.ts: changePlan]
    |-- Retrieves current Stripe subscription + schedule
    |-- Determines changeType via schedulePlanning.ts:
    |
    |-- UPGRADE (targetTier > currentTier):
    |       |-- Releases any pending downgrade schedule
    |       |-- stripe.subscriptions.update with proration_behavior: "create_prorations"
    |       |-- Syncs local subscription immediately
    |       |-- Proration invoice generated by Stripe -> invoice.paid -> credit grant
    |
    |-- DOWNGRADE (targetTier < currentTier):
    |       |-- Creates SubscriptionSchedule from existing subscription
    |       |-- Sets 2-phase schedule: current plan until period end, then target plan
    |       |-- end_behavior: "release", proration_behavior: "none"
    |       |-- User keeps current plan until period ends
    |       |-- At period end, Stripe fires customer.subscription.updated -> syncSubscription
    |
    |-- SAME PLAN with pending change:
    |       |-- Releases existing schedule (clears pending downgrade)
    |       |-- Clears pending metadata
    |
    v
Local state synced, UI updates reactively
```

### 3. Credit Purchase (Top-up)

```
User selects credit bundle
    |
    v
[credits/actions.ts: createTopupCheckoutSession]
    |-- Validates bundle key against catalog
    |-- Creates Stripe Checkout Session (mode: "payment", one-time)
    |-- Embeds metadata: billingType="credit_topup", credits, amountCents, creditsPerUsd
    |
    v
Stripe fires: payment_intent.succeeded
    |
    v
[http.ts handler]
    |-- grantPurchasedCreditsFromPaymentIntent
    |-- Validates billingType === "credit_topup"
    |-- Validates currency, amount, credits metadata
    |-- Checks idempotency (by stripePaymentIntentId)
    |-- Resolves userId from metadata or billingCustomers
    |-- Adds credits to credits.paidBalance
    |-- Records creditTransaction (type: "purchase", creditType: "paid")
```

### 4. Credit Deduction (AI Usage)

```
User triggers AI operation (e.g., extraction, search enhancement)
    |
    v
[ai/helpers.ts: withAuthAndCredits / withAuthAndCreditsBatch]
    |-- Authenticates user
    |-- Checks subscription tier (optional minPlanTier gate)
    |-- Checks credit balance > 0
    |-- Executes AI operation
    |-- Calculates credits: token usage -> dollar cost -> * 1.3 markup -> credits (min 1)
    |-- Calls credits.internal.deductCredits:
    |       |-- Deducts from freeBalance first, then paidBalance
    |       |-- Records creditTransaction(s) (type: "usage")
    |       |-- Increments lifetimeUsed
```

### 5. Refund Flow

```
Stripe fires: charge.refunded
    |
    v
[http.ts handler]
    |-- reversePurchasedCreditsFromRefund
    |-- Finds original purchase transaction by stripePaymentIntentId
    |-- Calculates proportional credit reversal
    |-- Subtracts from credits.paidBalance
    |-- Records creditTransaction (type: "refund", amount negative)
```

### 6. Reconciliation (Cron)

```
Every hour:
    |
    v
[credits/actions.ts: reconcileRecentPaidInvoicesFromStripe]
    |-- Lists eligible subscriptions from local DB
    |-- For each customer, fetches invoices from Stripe API (7-day lookback)
    |-- For each paid invoice, runs processInvoiceForGrantLogic
    |-- Catches missed webhooks by re-processing paid invoices
    |-- Reports: customersScanned, invoicesChecked, grantsTriggered, alreadyGranted
```

### State Management

```
                          ┌──────────────┐
                          │  Stripe      │
                          │  (source of  │
                          │  truth for   │
                          │  billing)    │
                          └──────┬───────┘
                                 │ webhooks + API calls
                                 ↓
┌──────────────────────────────────────────────────────────────┐
│  Convex DB (denormalized mirror + app-specific state)       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │subscriptions │  │billingCust-  │  │stripeEvent-  │      │
│  │(mirror of    │  │omers         │  │Logs          │      │
│  │Stripe sub    │  │(user↔cust    │  │(audit +      │      │
│  │status)       │  │mapping)      │  │idempotency)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │credits       │  │creditTrans-  │  <-- app-owned state    │
│  │(balances)    │  │actions       │      (not in Stripe)    │
│  │              │  │(audit log)   │                         │
│  └──────────────┘  └──────────────┘                         │
└──────────────────────────────┬───────────────────────────────┘
                               │ Convex real-time subscriptions
                               ↓
┌──────────────────────────────────────────────────────────────┐
│  Next.js UI (reactive via Convex hooks)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ app/settings/billing/page.tsx                         │   │
│  │ - Subscription status, plan details, pending changes  │   │
│  │ - Credit balance, transaction history                 │   │
│  │ - Upgrade/downgrade actions                           │   │
│  │ - Portal link, credit purchase                        │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Architectural Patterns

### Pattern 1: Audited Webhook Handler

**What:** Every webhook event is wrapped in `runAuditedStripeHandler` which records success/failure to `stripeEventLogs`, plus `onEvent` records initial receipt. This creates a full event lifecycle: received -> processed/retrying/failed/ignored.

**When to use:** Every Stripe event handler in `http.ts`.

**Trade-offs:** Adds one extra mutation per event but provides complete observability and enables retry tracking. Critical for diagnosing missed grants.

```typescript
async function runAuditedStripeHandler(ctx, event, handler) {
  try {
    await handler();
    await ctx.runMutation(markStripeEventProcessed, { ... });
  } catch (error) {
    await recordStripeEventFailure(ctx, event, error);
    throw error;
  }
}
```

### Pattern 2: Non-Blocking Invoice Processing with Scheduled Retry

**What:** `invoice.paid` handler delegates to `processInvoiceForGrantNonBlocking`, which attempts the grant action and on failure schedules a retry via `ctx.scheduler.runAfter` with exponential backoff (5s to 5min, 6 attempts).

**When to use:** Any webhook handler where the downstream processing depends on data that may not have synced yet (e.g., subscription record not created when invoice.paid arrives before customer.subscription.created).

**Trade-offs:** Adds complexity but handles the common Stripe race condition where events arrive out of order.

### Pattern 3: Invoice Grant Policy Classification

**What:** `classifyMonthlyCreditInvoice` separates billing reasons into grant-eligible (subscription_create, subscription_cycle), non-recurring (subscription_update, manual), and config drift categories before any database writes.

**When to use:** Before granting monthly credits from any invoice event or reconciliation path.

**Trade-offs:** Prevents accidental credit grants on proration invoices or one-time charges. Config drift detection surfaces API version mismatches.

### Pattern 4: Canonical Subscription Selection

**What:** `selectCanonicalSubscription` picks the "best" subscription from a user's history: active paid with Stripe link > active paid > active free > any free > any with Stripe link > first. Prevents confusion when user has multiple subscription records.

**When to use:** Every subscription lookup by userId.

**Trade-offs:** Deterministic behavior when data is messy, but could hide real issues with duplicate subscriptions.

### Pattern 5: Dual Credit Pool (Free + Paid)

**What:** Credits are split into `freeBalance` (from monthly grants, capped per tier) and `paidBalance` (from purchases, uncapped). Deduction consumes free first, then paid. Refunds only affect paid pool.

**When to use:** All credit operations.

**Trade-offs:** Clean separation of subscription value vs purchased value. Free credits can safely expire/cap without affecting purchased credits.

### Pattern 6: Subscription Schedule for Downgrades

**What:** Downgrades use Stripe `SubscriptionSchedule` with two phases: current plan until period end, target plan starting at period end. Upgrades bypass scheduling and apply immediately with proration.

**When to use:** `changePlan` action.

**Trade-offs:** Industry-standard behavior (users keep what they paid for). More complex than simple subscription update, but correct billing semantics.

## Anti-Patterns

### Anti-Pattern 1: Direct Stripe State Mutation Without Local Sync

**What people do:** Call `stripe.subscriptions.update` and assume the webhook will handle the local sync.
**Why it's wrong:** Race conditions between the action response and the webhook arrival. UI may show stale state.
**Do this instead:** The codebase correctly calls `syncLocalSubscriptionFromStripe` immediately after every `stripe.subscriptions.update` in `changePlan`. Maintain this pattern.

### Anti-Pattern 2: Trusting Client-Reported Plan Changes

**What people do:** Let the frontend determine which plan the user should be on.
**Why it's wrong:** Users could manipulate client code to grant themselves higher plans.
**Do this instead:** All plan resolution goes through `getPlanFromPriceId(priceId)` which maps Stripe price IDs to plans server-side. Price IDs are validated against `ALLOWED_STRIPE_PRICE_IDS`.

### Anti-Pattern 3: Single-Point Credit Granting

**What people do:** Only grant credits from `invoice.paid` webhook.
**Why it's wrong:** Webhooks can be missed, delayed, or delivered out of order.
**Do this instead:** The codebase uses a belt-and-suspenders approach: webhook-driven grants + hourly cron reconciliation + checkout.session.completed triggers immediate reconcile. This is the correct pattern.

### Anti-Pattern 4: Granting Credits on Proration Invoices

**What people do:** Grant monthly credits on every paid invoice.
**Why it's wrong:** Proration invoices (from upgrades) have `billing_reason: "subscription_update"` -- granting credits here would double-grant.
**Do this instead:** The `invoiceGrantPolicy` correctly filters to only `subscription_create` and `subscription_cycle` billing reasons.

## Component Boundaries and Dependencies

### Dependency Graph (Build/Audit Order)

```
lib/billing/entitlements.ts            (0 deps - pure logic)
convex/lib/constants.ts                (0 deps - config)
convex/lib/creditTopups.ts             (0 deps - pure math)
convex/lib/freeCredits.ts              (depends on: constants)
convex/lib/featureFlags.ts             (0 deps - env checks)
convex/lib/userCreation.ts             (depends on: constants, freeCredits)
    |
    v
convex/subscriptions/lib/              (pure logic libraries)
  stripeStatus.ts                      (0 deps)
  cancellation.ts                      (0 deps)
  eventLogPolicy.ts                    (0 deps)
  selectCanonicalSubscription.ts       (0 deps)
  schedulePlanning.ts                  (0 deps)
    |
    v
convex/credits/lib/                    (pure logic libraries)
  invoiceGrantPolicy.ts                (0 deps)
  retryPolicy.ts                       (0 deps)
    |
    v
convex/subscriptions/internal.ts       (depends on: constants, lib/*)
convex/credits/internal.ts             (depends on: constants, lib/*, subscriptions/lib)
    |
    v
convex/subscriptions/actions.ts        (depends on: internal, Stripe SDK, lib/*)
convex/credits/actions.ts              (depends on: internal, Stripe SDK, lib/*)
    |
    v
convex/http.ts                         (depends on: actions, internal, @convex-dev/stripe)
    |
    v
convex/crons.ts                        (depends on: credits/actions)
convex/ai/helpers.ts                   (depends on: credits/internal, subscriptions/internal)
```

### Suggested Audit/Fix Order

The dependency graph reveals the correct order for auditing and fixing:

1. **Pure policy libraries first** (zero-risk, no side effects)
   - `lib/billing/entitlements.ts` -- entitlement rules
   - `convex/lib/constants.ts` -- plan config, price ID mapping
   - `convex/credits/lib/invoiceGrantPolicy.ts` -- grant eligibility
   - `convex/credits/lib/retryPolicy.ts` -- retry budget
   - `convex/subscriptions/lib/schedulePlanning.ts` -- downgrade schedule
   - `convex/subscriptions/lib/cancellation.ts` -- cancel detection
   - `convex/lib/freeCredits.ts` -- free credit cap logic

2. **Internal mutations/queries** (database operations, testable in isolation)
   - `convex/subscriptions/internal.ts` -- syncSubscription, handleSubscriptionCanceled, handlePaymentFailed, event log mutations
   - `convex/credits/internal.ts` -- grantMonthlyCredits, grantPurchasedCreditsFromPaymentIntent, reversePurchasedCreditsFromRefund, deductCredits

3. **Actions (Stripe API callers)** (depends on 1+2 being correct)
   - `convex/subscriptions/actions.ts` -- createCheckoutSession, changePlan, createPortalSession, getSubscriptionDetails
   - `convex/credits/actions.ts` -- createTopupCheckoutSession, processInvoiceForGrant, reconcileRecentPaidInvoicesFromStripe

4. **Webhook router** (depends on everything above)
   - `convex/http.ts` -- all 10 event handlers, audit wrapper, non-blocking grant processing

5. **Background jobs and consumers** (depends on 1-4)
   - `convex/crons.ts` -- reconciliation schedule
   - `convex/ai/helpers.ts` -- credit deduction at AI usage time
   - `convex/maintenance/internal.ts` -- subscription status checker

6. **Frontend** (depends on all backend being correct)
   - `app/settings/billing/page.tsx` -- subscription display, plan change UI, credit balance

### Key Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| http.ts -> subscriptions/internal | `ctx.runMutation(internalApi.subscriptions.internal.*)` | Webhook dispatches are synchronous within the handler |
| http.ts -> credits/actions | `ctx.runAction(internalApi.credits.actions.*)` | Invoice grant is an action (calls Stripe API to hydrate invoice) |
| credits/actions -> credits/internal | `ctx.runMutation(internalApi.credits.internal.*)` | Action retrieves from Stripe, mutation writes to DB |
| subscriptions/actions -> subscriptions/internal | `ctx.runMutation(internalApi.subscriptions.internal.*)` | Action calls Stripe API, syncs via mutation |
| ai/helpers -> credits/internal | `ctx.runMutation(internal.credits.internal.deductCredits)` | Usage deduction at AI execution time |
| crons -> credits/actions | Direct reference to internal action | Hourly reconciliation |
| Credits grant retry -> scheduler | `ctx.scheduler.runAfter(delayMs, ...)` | Exponential backoff via Convex scheduler |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Current architecture is appropriate. Hourly reconciliation scan is fast. |
| 1k-100k users | Reconciliation cron becomes bottleneck (iterates all eligible subscriptions). Add pagination, consider per-customer scheduled reconciliation instead of global scan. |
| 100k+ users | Replace global reconciliation with event-driven reconciliation only. Trust webhooks more, use per-customer scheduled checks only for flagged accounts. stripeEventLogs table will grow large -- add TTL/archival. |

### First Bottleneck

The hourly `reconcileRecentPaidInvoicesFromStripe` cron scans up to 200 customers and fetches invoices for each from Stripe API. At scale, this will hit Stripe rate limits and Convex action timeout (10 min).

### Second Bottleneck

The `creditTransactions` table is append-only audit log. Over time it grows unbounded. The `by_stripe_invoice` and `by_stripe_payment_intent` indexes keep lookups fast, but listing transactions for a user (`by_credits` index) will slow down.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Stripe API | Direct SDK calls from Convex actions (`"use node"`) | API version: `2026-01-28.clover`. Two Stripe client instances: `@convex-dev/stripe` component + direct `new Stripe()` |
| Stripe Webhooks | `@convex-dev/stripe` `registerRoutes` handles signature verification | Secret from `STRIPE_WEBHOOK_SECRET` env var |
| Stripe Checkout | Redirect-based flow | Success/cancel URLs point to `/settings/billing` |
| Stripe Customer Portal | Redirect-based flow | For self-service cancellation, payment method updates |

### Key Configuration

| Config | Source | Purpose |
|--------|--------|---------|
| `STRIPE_GO_PRICE_ID` / `STRIPE_PRO_PRICE_ID` / `STRIPE_ENTERPRISE_PRICE_ID` | Env vars | Map Stripe prices to internal plans |
| `STRIPE_CREDITS_PRODUCT_ID` | Env var | Product for one-time credit purchases |
| `CREDITS_PER_USD` | Env var (default: 10,000) | Exchange rate for credit purchases |
| `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED` | Env var | Feature flag for subscription system |
| `NEXT_PUBLIC_CREDITS_ENABLED` | Env var | Feature flag for credit system |
| `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED` | Env var | Feature flag for credit purchases |

## Sources

- Direct codebase analysis of all files listed above (HIGH confidence -- primary source)
- Stripe API docs for SubscriptionSchedule, proration, and webhook event types
- `@convex-dev/stripe` component used for webhook registration and customer management

---
*Architecture research for: Stripe billing integration audit in Convex + Next.js*
*Researched: 2026-02-27*
