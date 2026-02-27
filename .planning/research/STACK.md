# Stack Research: Stripe Billing in Convex + Next.js

**Domain:** Stripe billing integration (subscriptions, proration, credit purchases) in a Convex + Next.js app
**Researched:** 2026-02-27
**Confidence:** HIGH

## Existing Stack (Already Installed)

These are already in the codebase and form the foundation. The audit does not replace them; it fixes how they are used.

| Technology | Installed | Latest | Purpose | Status |
|------------|-----------|--------|---------|--------|
| `stripe` | 20.3.1 | 20.4.0 | Stripe Node.js SDK | Current (minor patch behind) |
| `@convex-dev/stripe` | 0.1.3 | 0.1.3 | Convex Stripe component | Latest |
| `convex` | 1.32.0 | 1.32.0 | Backend runtime | Latest |
| Next.js | 16.1.6 | -- | Frontend framework | Current |

**Confidence: HIGH** -- Verified via `npm view` against npm registry on 2026-02-27.

## Stripe API Version

The codebase explicitly pins `apiVersion: "2026-01-28.clover"` in both `convex/subscriptions/actions.ts` and `convex/credits/actions.ts`. The installed `stripe@20.3.1` SDK defaults to this same version (`2026-01-28.clover`).

**Version lineage:** Basil (2025-03-31 through 2025-08-27) -> Clover (2025-09-30 through 2026-02-25). Clover inherits all Basil breaking changes.

### Critical Basil->Clover Inherited Change: Item-Level Billing Periods

Starting with Basil (2025-03-31), Stripe deprecated subscription-level `current_period_start` and `current_period_end`. These fields now live on subscription **items** (`items.data[0].current_period_start` / `items.data[0].current_period_end`).

**Current codebase status:** Already handled correctly. The codebase uses a fallback pattern throughout:
```typescript
// Pattern found in convex/http.ts and convex/subscriptions/actions.ts
const currentPeriodEnd =
  subscription.current_period_end ??   // legacy (pre-Basil)
  item?.current_period_end ??           // current (Basil+)
  Math.floor(Date.now() / 1000);        // last resort
```

This is correct and forward-compatible. No migration needed.

**Confidence: HIGH** -- Verified via Stripe official changelog (https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) and Stripe API reference for subscription item object.

## `@convex-dev/stripe` Component: Capabilities and Limitations

### What It Does (Use These)

| Capability | Method | Notes |
|------------|--------|-------|
| Checkout sessions | `createCheckoutSession()` | Supports `payment`, `subscription`, `setup` modes. Handles `subscriptionMetadata` and `paymentIntentMetadata` |
| Customer management | `getOrCreateCustomer()`, `createCustomer()` | Idempotency-key based dedup. Checks existing subscriptions/payments before creating |
| Customer portal | `createCustomerPortalSession()` | Simple redirect URL generation |
| Webhook routing | `registerRoutes()` | Signature verification, default DB sync for 10+ event types, custom event handlers run *after* built-in processing |
| Cancel subscription | `cancelSubscription()` | Supports `cancelAtPeriodEnd` flag |
| Reactivate subscription | `reactivateSubscription()` | Sets `cancel_at_period_end: false` |
| Seat-based quantity | `updateSubscriptionQuantity()` | Updates Stripe + local DB |

### What It Does NOT Do (Must Use Stripe SDK Directly)

| Gap | Why It Matters | Pattern to Use |
|-----|---------------|----------------|
| Subscription plan changes (upgrade/downgrade) | No `updateSubscription()` or `changePlan()` method. Cannot set `proration_behavior` or swap price IDs | Direct `stripe.subscriptions.update()` |
| Subscription schedules | No schedule creation/management. Cannot defer downgrades to period end | Direct `stripe.subscriptionSchedules.create()` / `.update()` / `.release()` |
| Proration preview | Cannot preview proration amounts before committing | Direct `stripe.invoices.createPreview()` |
| Invoice retrieval/listing | No method to list or retrieve invoices for reconciliation | Direct `stripe.invoices.list()` / `.retrieve()` |
| Price retrieval | No method to fetch price details for display | Direct `stripe.prices.retrieve()` |
| One-time payment (non-checkout) | `createCheckoutSession` only; no direct PaymentIntent creation | Direct `stripe.checkout.sessions.create()` with `mode: "payment"` |

**Confidence: HIGH** -- Verified by reading `@convex-dev/stripe` source code at `node_modules/@convex-dev/stripe/src/client/index.ts`.

### Component Architecture Detail

The `registerRoutes()` function runs built-in handlers FIRST (DB sync), then `onEvent` (generic), then specific event handlers. This means:

1. By the time your custom `events.["customer.subscription.updated"]` handler runs, the component has already synced the subscription to its internal tables
2. Your custom handlers supplement the component's processing -- they do not replace it
3. The component's internal tables (`subscriptions`, `payments`, `invoices`, `customers`) are a convenience data mirror, not the source of truth for billing logic

**Implication for this audit:** The app correctly maintains its own `subscriptions`, `credits`, `billingCustomers` tables separate from the component's internal tables. This is the right pattern -- the component's tables provide denormalized convenience data, while the app's tables hold domain-specific billing state (credit balances, plan entitlements, event audit logs).

## Stripe API Patterns for Billing Operations

### Upgrade: Immediate Proration

**Pattern:** `stripe.subscriptions.update()` with `proration_behavior: "create_prorations"`

```typescript
// Current codebase pattern (convex/subscriptions/actions.ts line 612)
const updated = await stripe.subscriptions.update(stripeSubscription.id, {
  items: [{ id: item.id, price: targetPriceId, quantity: item.quantity ?? 1 }],
  proration_behavior: "create_prorations",
  cancel_at_period_end: false,
  metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
});
```

**`create_prorations` vs `always_invoice`:**

| Behavior | What Happens | When to Use |
|----------|-------------|-------------|
| `create_prorations` | Creates proration line items; invoiced at next billing cycle | When you want prorations added to next invoice |
| `always_invoice` | Creates prorations AND immediately generates + charges an invoice | When you want the customer charged right now |
| `none` | No proration; customer pays full new price at next cycle | Downgrades where you don't want to credit |

**Recommendation for upgrades:** Use `always_invoice` if the product requires immediate payment on upgrade. Use `create_prorations` (current pattern) if it's acceptable to charge the proration at next renewal. The PROJECT.md states "Upgrade flow charges the proration difference immediately" -- this suggests `always_invoice` may be needed.

**Confidence: HIGH** -- Verified via Stripe official documentation (https://docs.stripe.com/billing/subscriptions/prorations).

### Downgrade: Schedule at Period End

**Pattern:** Subscription Schedules with two phases.

```typescript
// Current codebase pattern (convex/subscriptions/actions.ts, schedulePlanning.ts)
// 1. Create schedule from existing subscription
schedule = await stripe.subscriptionSchedules.create({
  from_subscription: stripeSubscription.id,
});

// 2. Set phases: current plan until period end, then new plan
await stripe.subscriptionSchedules.update(schedule.id, {
  end_behavior: "release",
  proration_behavior: "none",
  phases: [
    {
      start_date: currentPhaseStart,
      end_date: currentPhaseEnd,
      items: [{ price: currentPriceId, quantity: currentQuantity }],
    },
    {
      start_date: currentPhaseEnd,
      items: [{ price: targetPriceId, quantity: targetQuantity }],
    },
  ],
});
```

**Key rules:**
- Maximum 10 phases per schedule
- Must pass ALL phases (current + future) when updating
- `end_behavior: "release"` detaches the schedule after the last phase completes, leaving the subscription running
- Release the schedule before making direct subscription modifications (the codebase does this correctly)
- Schedules cannot be modified while a phase transition is in progress

**Confidence: HIGH** -- Verified via Stripe docs (https://docs.stripe.com/billing/subscriptions/subscription-schedules).

### Credit Purchase: One-Time Payment via Checkout

**Pattern:** `stripe.checkout.sessions.create()` with `mode: "payment"` and `price_data`.

The codebase correctly uses inline `price_data` (not a pre-created Price object) for credit bundles, which is the right approach for variable-amount one-time purchases.

**Key detail:** Metadata is passed to both the session AND the `payment_intent_data.metadata` -- this is critical because the `payment_intent.succeeded` webhook reads metadata from the PaymentIntent, not the session.

**Confidence: HIGH** -- Verified by reading codebase (`convex/credits/actions.ts`).

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `stripe@stripe-js` (client-side SDK) for billing mutations | All billing logic must run server-side in Convex actions; client-side Stripe.js is for Elements/card forms only | Stripe Node SDK in Convex `"use node"` actions |
| `@convex-dev/stripe` for plan changes | Component has no subscription update method that supports proration or price swaps | Direct Stripe SDK `stripe.subscriptions.update()` |
| `proration_behavior: "none"` for upgrades | Customer gets upgraded without paying the difference; effectively giving away service | `create_prorations` or `always_invoice` |
| `stripe.subscriptions.update({ items: [{ price: newPrice }] })` for downgrades | Immediately switches plan and potentially credits the customer; wrong UX | Subscription Schedules to defer to period end |
| Polling Stripe for subscription state from the client | Expensive, not real-time, violates webhook-driven architecture | Webhook handlers sync state to Convex; client reads from Convex queries |
| `@ras-sh/convex-stripe` (community fork) | Unmaintained alternative; `@convex-dev/stripe` is the official component | Stick with `@convex-dev/stripe@0.1.3` |
| Custom webhook signature verification | Error-prone; the component handles it correctly | `registerRoutes()` from `@convex-dev/stripe` |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|----------------|-------|
| `stripe@20.3.1` | API version `2026-01-28.clover` | SDK default matches pinned version |
| `stripe@20.4.0` | API version `2026-01-28.clover` | Safe upgrade; same API version, bug fixes only |
| `@convex-dev/stripe@0.1.3` | `convex@^1.x` | Component API stable; source-verified |
| `@convex-dev/stripe@0.1.3` | `stripe@^20.x` | Uses `stripe` as peer-ish dependency (imports `stripe` SDK) |

**Safe upgrade path:** `stripe` 20.3.1 -> 20.4.0 is non-breaking (same major, same API version). The `20.5.0-alpha.1` exists but is private-preview -- do not use.

## Stack Patterns by Billing Operation

**For new subscription checkout:**
- Use `stripeClient.createCheckoutSession()` from `@convex-dev/stripe`
- Checkout session handles payment collection, customer creation, subscription setup
- Webhook `checkout.session.completed` triggers credit reconciliation

**For upgrade (immediate):**
- Use direct `stripe.subscriptions.update()` with `proration_behavior`
- Release any existing subscription schedule first
- Sync local subscription state after update
- Clear pending plan change metadata

**For downgrade (deferred):**
- Use `stripe.subscriptionSchedules.create({ from_subscription })` + `.update()`
- Two phases: current plan until period end, target plan after
- Set `end_behavior: "release"` and `proration_behavior: "none"`
- Store pending change info in subscription metadata for UI display

**For credit top-up:**
- Use direct `stripe.checkout.sessions.create({ mode: "payment" })` with `price_data`
- Pass metadata to both session and `payment_intent_data.metadata`
- Webhook `payment_intent.succeeded` grants credits

**For cancellation:**
- Use `stripeClient.cancelSubscription({ cancelAtPeriodEnd: true })` from `@convex-dev/stripe`
- Or redirect to Customer Portal for self-service cancellation

**For invoice reconciliation:**
- Use direct `stripe.invoices.list()` with customer filter
- Cron-based reconciliation catches missed webhooks
- Retry with exponential backoff for transient failures

## Installation

No new packages needed. The existing stack is complete:

```bash
# Already installed -- no changes required
# stripe@20.3.1     -> optionally upgrade to 20.4.0
# @convex-dev/stripe@0.1.3
# convex@1.32.0

# Optional upgrade (safe, non-breaking):
npm install stripe@20.4.0
```

## Sources

- [Stripe API Changelog: Clover](https://docs.stripe.com/changelog/clover) -- API version verification (HIGH confidence)
- [Stripe Basil: Item-level billing periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) -- `current_period_end` migration (HIGH confidence)
- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- `proration_behavior` values (HIGH confidence)
- [Stripe Subscription Schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) -- Downgrade deferral pattern (HIGH confidence)
- [Stripe Modify Subscriptions](https://docs.stripe.com/billing/subscriptions/change) -- Upgrade/downgrade patterns (HIGH confidence)
- [`@convex-dev/stripe` source code](https://github.com/get-convex/stripe) -- Component capabilities verified via installed `node_modules/@convex-dev/stripe/src/client/index.ts` (HIGH confidence)
- [`@convex-dev/stripe` npm](https://www.npmjs.com/package/@convex-dev/stripe) -- Version verification (HIGH confidence)
- [Stripe npm](https://www.npmjs.com/package/stripe) -- Version verification (HIGH confidence)
- [Convex npm](https://www.npmjs.com/package/convex) -- Version verification (HIGH confidence)
- npm registry queries (`npm view`) -- Installed vs latest version checks (HIGH confidence)

---
*Stack research for: Stripe billing integration audit in Convex + Next.js*
*Researched: 2026-02-27*
