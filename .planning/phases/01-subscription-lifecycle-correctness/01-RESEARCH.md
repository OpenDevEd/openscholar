# Phase 1: Subscription Lifecycle Correctness - Research

**Researched:** 2026-02-27
**Domain:** Stripe subscription billing, webhook idempotency, proration, subscription schedules
**Confidence:** HIGH

## Summary

Phase 1 addresses three confirmed critical bugs (upgrade proration not charged immediately, out-of-order webhook state corruption, cancellation orphan records) and hardens four subscription state transitions (downgrade schedule survival, schedule leak on re-upgrade, payment failure handling, and proration preview before upgrade). The codebase already has a well-structured subscription management layer in `convex/subscriptions/` with pure-function helpers for schedule planning, cancellation policy, and event log policy -- all with existing unit test coverage.

The primary gap is that the `changePlan` action uses `proration_behavior: "create_prorations"` instead of `"always_invoice"`, and the webhook handlers use event payload data directly instead of re-fetching from the Stripe API. The `handleSubscriptionCanceled` mutation creates orphan free-plan records and clears the `stripeSubscriptionId`. Payment failure handling exists but is minimal -- it sets `past_due` status but has no user-facing feedback mechanism, no grace period tracking, and no eventual downgrade logic.

**Primary recommendation:** Fix the three critical bugs via targeted changes to `changePlan`, the webhook handlers in `http.ts`, and `handleSubscriptionCanceled` -- then layer on proration preview, payment failure UX, and schedule verification as hardening measures.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Webhook conflict resolution**: Always re-fetch current subscription state from Stripe API on every `customer.subscription.*` event. Apply re-fetch to ALL subscription events. On Stripe API failure: return HTTP 500 so Stripe retries. Log divergences when event payload disagrees with the re-fetched state.
- **Payment failure experience**: Grace period matches Stripe's retry window (~7 days). During `past_due`: show persistent banner with "Update payment" button linking to Stripe portal. Keep ALL features fully accessible. After grace period expires: automatically downgrade to free plan.
- **Charge failure on upgrade**: Block the upgrade if proration charge fails (card declined). Show actionable error. Manual retry only. Show proration amount preview before confirmation using Stripe's proration preview API.
- **Schedule cleanup on re-upgrade**: Release schedule via Stripe API, then verify `subscription.schedule === null`. Block upgrade if schedule release fails. Check for orphaned schedules only during upgrade flow. Show pending downgrade indicator on billing page.

### Claude's Discretion
- Exact banner component design and styling
- Stripe proration preview API integration details
- Error retry/backoff logic for Stripe API calls within the re-fetch flow
- Log format and storage mechanism for divergence tracking

### Deferred Ideas (OUT OF SCOPE)
- Background scanning for orphaned schedules via reconciliation cron (Phase 3)
- Failed event alerting/monitoring (Phase 3 INFRA-02)
- Degraded access mode during past_due
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUB-01 | Upgrade charges the proration difference immediately via `always_invoice` | Change `proration_behavior` from `"create_prorations"` to `"always_invoice"` in `changePlan`. Add `payment_behavior: "error_if_incomplete"` to block on card decline. Use `stripe.invoices.createPreview()` for proration preview. |
| SUB-02 | `syncSubscription` guards against out-of-order webhook events using Stripe API re-fetch | Refactor `customer.subscription.*` handlers in `http.ts` to re-fetch via `stripe.subscriptions.retrieve()` before calling `syncSubscription`. Current handlers pass event payload data directly. |
| SUB-03 | Cancellation handler preserves Stripe subscription ID on canceled records instead of creating orphan free-plan records | `handleSubscriptionCanceled` currently: (1) sets `stripeSubscriptionId: undefined`, (2) inserts a new free-plan record. Fix: patch in-place with `status: "canceled"`, preserve `stripeSubscriptionId`, do NOT insert orphan record. |
| SUB-04 | Downgrade schedule survives mid-period subscription updates (payment method change, metadata update) | The re-fetch approach (SUB-02) inherently protects against this -- non-billing updates don't create prorations or alter the schedule. Stripe confirms: "configuration updates don't generate invoices with `proration_behavior=always_invoice`". Verify schedule still attached after re-fetch sync. |
| SUB-05 | Schedule leak prevented on re-upgrade -- verify `subscription.schedule === null` after release | `changePlan` already releases schedules via `stripe.subscriptionSchedules.release()`. Add post-release verification: re-retrieve subscription and assert `schedule === null`. Block upgrade if verification fails. |
| SUB-06 | Payment failure handling correctly transitions to `past_due` and retains user access during grace period | `handlePaymentFailed` already sets `past_due`. Add: persistent payment failure banner (billing page), grace period expiry detection in `checkSubscriptionStatus` cron, and automatic downgrade to free after retries exhausted. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | ^20.3.0 | Stripe SDK, API version 2026-01-28.clover | Already installed; provides typed access to subscriptions, invoices, schedules, proration preview |
| @convex-dev/stripe | ^0.1.3 | Convex component for Stripe webhook registration | Already installed; provides `registerRoutes` for webhook signature verification and event routing |
| convex | ^1.31.7 | Backend platform | All billing logic runs as Convex actions/mutations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex-helpers | ^0.1.111 | Convex utility helpers | Already in project, use for any mutation/query helpers |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom re-fetch in each handler | Stripe thin events migration | Thin events are the future direction but require Stripe API upgrade and broader refactor; re-fetch per handler is simpler for Phase 1 |
| `stripe.invoices.createPreview()` | Legacy `stripe.invoices.retrieveUpcoming()` | Legacy API deprecated as of API version 2025-03-31.basil; `createPreview()` is the replacement |

**Installation:**
No new packages needed. All required dependencies already installed.

## Architecture Patterns

### Recommended Project Structure
```
convex/
├── subscriptions/
│   ├── actions.ts            # User-facing actions (changePlan, getSubscriptionDetails, etc.)
│   ├── internal.ts           # Internal mutations (syncSubscription, handleSubscriptionCanceled, etc.)
│   ├── queries.ts            # Public queries (getMy, getTier)
│   └── lib/
│       ├── stripeStatus.ts       # Status normalization
│       ├── cancellation.ts       # Cancellation policy logic
│       ├── schedulePlanning.ts   # Schedule phase logic
│       ├── eventLogPolicy.ts     # Event log state machine
│       └── selectCanonicalSubscription.ts  # Canonical subscription selection
├── http.ts                   # Webhook handlers (re-fetch logic goes here)
├── lib/
│   ├── constants.ts          # Plan config, price IDs, tiers
│   ├── validators.ts         # Convex validators for subscription types
│   └── errors.ts             # Error codes
└── maintenance/
    └── internal.ts           # checkSubscriptionStatus cron
```

### Pattern 1: Webhook Re-Fetch (for SUB-02)
**What:** On every `customer.subscription.*` event, re-fetch the subscription from Stripe API before syncing to local DB.
**When to use:** All subscription webhook handlers.
**Example:**
```typescript
// In http.ts webhook handler
"customer.subscription.updated": async (ctx, event) => {
  await runAuditedStripeHandler(ctx, event, async () => {
    const subscription = event.data.object as any;

    // Re-fetch from Stripe API (source of truth)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const fresh = await stripe.subscriptions.retrieve(subscription.id, {
      expand: ["schedule"],
    });

    // Log divergence if event payload differs from fresh state
    if (fresh.status !== subscription.status) {
      console.warn("[WebhookDivergence] status mismatch", {
        eventStatus: subscription.status,
        freshStatus: fresh.status,
        subscriptionId: subscription.id,
      });
    }

    // Sync from fresh data, not event payload
    const item = fresh.items.data[0];
    // ... call syncSubscription with fresh data
  });
},
```

### Pattern 2: Proration Preview Before Upgrade (for SUB-01)
**What:** Before executing an upgrade, preview the proration amount so the user knows what they will be charged.
**When to use:** In the upgrade flow, before calling `stripe.subscriptions.update()`.
**Example:**
```typescript
// Use the new Create Preview Invoice API (replaces deprecated retrieveUpcoming)
const preview = await stripe.invoices.createPreview({
  customer: stripeCustomerId,
  subscription: stripeSubscriptionId,
  subscription_details: {
    items: [{ id: subscriptionItemId, price: targetPriceId }],
    proration_behavior: "always_invoice",
    proration_date: Math.floor(Date.now() / 1000),
  },
});

const prorationAmount = preview.total; // Amount in cents
// Return this to the frontend for confirmation
```

### Pattern 3: In-Place Cancellation (for SUB-03)
**What:** On `customer.subscription.deleted`, update the existing subscription record in place instead of creating a new free-plan record.
**When to use:** `handleSubscriptionCanceled` mutation.
**Example:**
```typescript
// CURRENT (buggy):
await ctx.db.patch(subscription._id, {
  status: "canceled",
  canceledAt: now,
  updatedAt: now,
  stripeSubscriptionId: undefined,  // BUG: clears the ID
});
await ctx.db.insert("subscriptions", { ... plan: "free" ... }); // BUG: orphan record

// FIXED:
await ctx.db.patch(subscription._id, {
  status: "canceled",
  plan: "free",
  canceledAt: now,
  updatedAt: now,
  creditsPerMonth: 0,
  // stripeSubscriptionId PRESERVED for audit trail
});
```

### Pattern 4: Schedule Verification on Re-Upgrade (for SUB-05)
**What:** After releasing a subscription schedule, re-retrieve the subscription and verify the schedule is detached.
**When to use:** In `changePlan` when `changeType === "upgraded_immediately"` and a schedule exists.
**Example:**
```typescript
await stripe.subscriptionSchedules.release(schedule.id);

// Verify schedule is detached
const verifiedSub = await stripe.subscriptions.retrieve(stripeSubscription.id);
if (verifiedSub.schedule !== null) {
  console.error("[ScheduleLeak] schedule still attached after release", {
    subscriptionId: stripeSubscription.id,
    scheduleId: schedule.id,
  });
  throw createError(
    "BILLING_PLAN_CHANGE_CONFLICT",
    "Failed to release pending schedule. Please try again.",
  );
}
```

### Anti-Patterns to Avoid
- **Trusting webhook event payload for state:** Event payloads can be stale (out-of-order delivery). Always re-fetch from Stripe API.
- **Creating orphan records on cancel:** Inserting a new `plan: "free"` record on cancel creates orphans. Update in place.
- **Using `create_prorations` for upgrades:** This does NOT guarantee immediate invoicing. Use `always_invoice` for upgrades.
- **Silently ignoring schedule release failures:** If schedule release fails, the old schedule can fire at period end and revert the user's plan. Block the upgrade instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proration calculation | Custom math based on days remaining | `stripe.subscriptions.update({ proration_behavior: "always_invoice" })` | Stripe handles prorated calculations to the second; custom math will diverge |
| Proration preview | Calculate from plan prices and remaining days | `stripe.invoices.createPreview()` | Ensures preview matches actual charge exactly |
| Payment method UI | Custom card input form | Stripe Customer Portal (`stripe.billingPortal.sessions.create()`) | PCI compliance, hosted by Stripe, already integrated |
| Webhook signature verification | Custom HMAC validation | `@convex-dev/stripe` `registerRoutes()` | Already handles verification, timing-safe comparison |
| Grace period retry scheduling | Custom retry timers | Stripe's built-in retry logic (Smart Retries) | Stripe retries up to ~16 times over 72 hours automatically |

**Key insight:** Stripe handles the hard billing math. The project's job is to sync Stripe's state correctly to the local DB and present it in the UI. Every time custom billing logic is written instead of delegating to Stripe, divergence risk increases.

## Common Pitfalls

### Pitfall 1: `create_prorations` Does Not Mean Immediate Charge
**What goes wrong:** Upgrade appears to succeed but the proration amount isn't charged until the next billing cycle, so the user gets the higher-tier features for free until then.
**Why it happens:** `create_prorations` (the current setting) only creates proration line items -- it does NOT trigger an invoice. The proration sits as a pending invoice item until the next cycle.
**How to avoid:** Use `proration_behavior: "always_invoice"` for upgrades. This creates the proration items AND immediately generates and charges an invoice.
**Warning signs:** After an upgrade, the user's Stripe dashboard shows no new invoice, or an invoice appears but with status `draft` instead of `paid`.

### Pitfall 2: Out-of-Order Webhook Events Overwrite Correct State
**What goes wrong:** A `customer.subscription.updated` event arrives from a metadata change (old state), after a later event from the actual plan upgrade (new state). The old event overwrites the correct subscription data.
**Why it happens:** Stripe does not guarantee event delivery order. The current webhook handlers use event payload data directly without checking if it's stale.
**How to avoid:** Re-fetch the subscription from Stripe API on every webhook event. The re-fetched data is always the latest state regardless of event order.
**Warning signs:** Subscription records in the DB show unexpected status/plan changes, especially after rapid successive operations.

### Pitfall 3: Orphan Subscription Records After Cancellation
**What goes wrong:** `handleSubscriptionCanceled` creates a new free-plan record while marking the old one as canceled. This leaves two records for one user, and `selectCanonicalSubscription` may return the wrong one depending on ordering.
**Why it happens:** The cancellation handler was designed to "create a clean free record" but this creates data inconsistency.
**How to avoid:** Update the existing record in place: set `status: "canceled"`, `plan: "free"`, preserve `stripeSubscriptionId`.
**Warning signs:** Users have multiple subscription records; `selectCanonicalSubscription` returns unexpected results.

### Pitfall 4: Leaked Subscription Schedules After Re-Upgrade
**What goes wrong:** User downgrades (schedule created), then re-upgrades. The schedule is released but `subscription.schedule` still points to it. At period end, the orphaned schedule fires and downgrades the user.
**Why it happens:** Schedule release is asynchronous -- the `release()` call succeeds but the subscription object may not immediately reflect `schedule: null`.
**How to avoid:** After releasing, re-retrieve the subscription and verify `schedule === null`. Block the upgrade if verification fails.
**Warning signs:** Users report being downgraded unexpectedly after re-upgrading.

### Pitfall 5: `payment_behavior: "allow_incomplete"` Silently Upgrades on Failed Charge
**What goes wrong:** Upgrade goes through even though the proration charge failed (card declined). User gets higher-tier features without paying.
**Why it happens:** The default `payment_behavior` is `"allow_incomplete"`, which transitions to `past_due` instead of blocking.
**How to avoid:** Use `payment_behavior: "error_if_incomplete"` for upgrades. This returns HTTP 402 if payment fails, preventing the subscription update.
**Warning signs:** Subscriptions in `past_due` status immediately after an upgrade attempt.

### Pitfall 6: `stripe.invoices.retrieveUpcoming()` Is Deprecated
**What goes wrong:** The proration preview API call fails or returns unexpected results.
**Why it happens:** Stripe deprecated `GET /v1/invoices/upcoming` as of API version 2025-03-31.basil. Since this project uses API version 2026-01-28.clover, the old endpoint may not be available.
**How to avoid:** Use `stripe.invoices.createPreview()` instead. This is the replacement API with identical functionality.
**Warning signs:** `StripeInvalidRequestError` when calling `retrieveUpcoming`.

## Code Examples

### Upgrade with Immediate Proration Charge (SUB-01)
```typescript
// In changePlan action, for changeType === "upgraded_immediately"
const updated = await stripe.subscriptions.update(stripeSubscription.id, {
  items: [
    {
      id: item.id,
      price: args.targetPriceId,
      quantity: item.quantity ?? 1,
    },
  ],
  proration_behavior: "always_invoice",       // Charge immediately
  payment_behavior: "error_if_incomplete",     // Block on card decline
  cancel_at_period_end: false,
  metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
});
```

### Webhook Re-Fetch Pattern (SUB-02)
```typescript
// Shared helper for all customer.subscription.* handlers
async function handleSubscriptionWebhook(
  ctx: any,
  event: Stripe.Event,
  stripe: Stripe,
): Promise<void> {
  const eventSub = event.data.object as any;

  // Always re-fetch from Stripe API
  const fresh = await stripe.subscriptions.retrieve(eventSub.id);

  // Log divergence for monitoring
  if (fresh.status !== eventSub.status ||
      fresh.items.data[0]?.price?.id !== eventSub.items?.data[0]?.price?.id) {
    console.warn("[WebhookDivergence]", {
      eventId: event.id,
      subscriptionId: eventSub.id,
      divergence: {
        status: { event: eventSub.status, fresh: fresh.status },
        priceId: {
          event: eventSub.items?.data[0]?.price?.id,
          fresh: fresh.items.data[0]?.price?.id
        },
      },
    });
  }

  // Sync from fresh data
  await syncLocalSubscriptionFromStripe(ctx, fresh);
}
```

### Proration Preview (SUB-01, user-facing)
```typescript
// New action: getUpgradePreview
export const getUpgradePreview = action({
  args: { targetPriceId: v.string() },
  returns: v.object({
    prorationAmount: v.number(),
    currency: v.string(),
    immediateCharge: v.number(),
  }),
  handler: async (ctx, args) => {
    // ... auth, get subscription ...
    const preview = await stripe.invoices.createPreview({
      customer: stripeCustomerId,
      subscription: subscription.stripeSubscriptionId,
      subscription_details: {
        items: [{ id: itemId, price: args.targetPriceId }],
        proration_behavior: "always_invoice",
        proration_date: Math.floor(Date.now() / 1000),
      },
    });

    return {
      prorationAmount: preview.total,
      currency: preview.currency,
      immediateCharge: preview.amount_due,
    };
  },
});
```

### In-Place Cancellation (SUB-03)
```typescript
// Fixed handleSubscriptionCanceled
export const handleSubscriptionCanceled = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .order("desc")
      .collect();
    const subscription = selectCanonicalSubscription(subscriptions);

    if (!subscription) return null;

    const now = Date.now();

    // Update in place -- no orphan record
    await ctx.db.patch(subscription._id, {
      status: "canceled",
      plan: "free",
      canceledAt: now,
      updatedAt: now,
      creditsPerMonth: 0,
      // stripeSubscriptionId PRESERVED for audit trail
    });

    return null;
  },
});
```

### Grace Period Expiry Detection (SUB-06)
```typescript
// Enhanced checkSubscriptionStatus cron
export const checkSubscriptionStatus = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    // Find past_due subscriptions past grace period
    const pastDueSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();

    for (const sub of pastDueSubs) {
      const pastDueSince = sub.updatedAt; // When status changed to past_due
      if (now - pastDueSince > GRACE_PERIOD_MS) {
        // Grace period expired -- downgrade to free
        await ctx.db.patch(sub._id, {
          status: "canceled",
          plan: "free",
          canceledAt: now,
          updatedAt: now,
          creditsPerMonth: 0,
        });
      }
    }
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `GET /v1/invoices/upcoming` | `POST /v1/invoices/create_preview` | 2025-03-31.basil API version | Must use `createPreview()` for proration preview; old endpoint deprecated |
| Snapshot webhook events (full object in payload) | Thin events (notification only, fetch full object) | Ongoing Stripe migration | The re-fetch pattern aligns with Stripe's direction toward thin events |
| `current_period_end` on subscription object | `current_period_end` on subscription item | API version 2022+ | Project already handles both locations with fallback logic |

**Deprecated/outdated:**
- `stripe.invoices.retrieveUpcoming()`: Replaced by `stripe.invoices.createPreview()` as of basil (2025-03-31). Since this project uses `2026-01-28.clover`, use the new API.

## Open Questions

1. **Stripe re-fetch rate limiting under high webhook volume**
   - What we know: Stripe has a 100 req/s rate limit. Re-fetching on every webhook doubles API calls.
   - What's unclear: Whether this project's volume is high enough to approach limits.
   - Recommendation: Implement basic retry with backoff on 429 responses. Log rate limit hits. This project's volume is likely well below limits, but the error path should be handled. On Stripe API failure, return HTTP 500 so Stripe retries the webhook (per locked decision).

2. **Exact timing of grace period start**
   - What we know: The `past_due` status is set when `invoice.payment_failed` fires. The 7-day window should start from that point.
   - What's unclear: Whether `updatedAt` on the subscription record accurately captures when `past_due` started (could be overwritten by subsequent syncs).
   - Recommendation: Add a dedicated `pastDueSince` field to the subscription record, set only on the first `past_due` transition (not overwritten on subsequent syncs).

3. **Whether `selectCanonicalSubscription` needs updating after in-place cancellation fix**
   - What we know: Current logic prioritizes non-canceled, paid, Stripe-linked records. After fixing SUB-03, canceled records will retain `stripeSubscriptionId`.
   - What's unclear: Whether this changes the selection behavior for users who cancel and re-subscribe later.
   - Recommendation: Review and test `selectCanonicalSubscription` after SUB-03 fix to ensure it still picks the correct record when both canceled-with-Stripe-ID and new-active records exist.

4. **`@convex-dev/stripe` component's internal state after webhook changes**
   - What we know: `registerRoutes` processes component default handlers first, then `onEvent`, then custom handlers. The component maintains its own subscription state in its internal tables.
   - What's unclear: Whether the component's internal state needs to stay in sync with the project's `subscriptions` table.
   - Recommendation: The project's custom handlers in `http.ts` are the authoritative sync path to the project's `subscriptions` table. The component's internal state is separate and used for `getOrCreateCustomer` lookups. No conflict expected, but verify after implementation.

## Sources

### Primary (HIGH confidence)
- Stripe API Reference: [Update a subscription](https://docs.stripe.com/api/subscriptions/update) - `proration_behavior`, `payment_behavior` parameters
- Stripe API Reference: [Create a preview invoice](https://docs.stripe.com/api/invoices/create_preview) - Proration preview replacement for deprecated `retrieveUpcoming`
- Stripe API Reference: [Release a schedule](https://docs.stripe.com/api/subscription_schedules/release) - Schedule release behavior and post-release state
- Stripe Docs: [Prorations](https://docs.stripe.com/billing/subscriptions/prorations) - `always_invoice` vs `create_prorations` vs `none`
- Stripe Changelog: [Invoice Preview API Deprecation](https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations) - Migration from upcoming invoice to create preview
- Stripe Docs: [Webhook best practices](https://docs.stripe.com/webhooks) - Event ordering, idempotency, delivery guarantees
- Codebase analysis: `convex/subscriptions/actions.ts`, `convex/subscriptions/internal.ts`, `convex/http.ts` - Current implementation

### Secondary (MEDIUM confidence)
- Stripe Docs: [Modify subscriptions](https://docs.stripe.com/billing/subscriptions/change) - General subscription change patterns
- Stripe Docs: [Using webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks) - Subscription-specific webhook patterns
- `@convex-dev/stripe` source: `node_modules/@convex-dev/stripe/src/client/index.ts` - Component webhook processing order

### Tertiary (LOW confidence)
- Community patterns for re-fetch-before-process webhook handling - Multiple blog sources agree on the pattern, verified against Stripe's thin events migration direction

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and versions verified from `package.json`
- Architecture: HIGH - Codebase fully analyzed; patterns derived from actual code in `convex/subscriptions/`, `convex/http.ts`, and `@convex-dev/stripe` source
- Pitfalls: HIGH - Confirmed bugs verified against Stripe API documentation; `create_prorations` vs `always_invoice` behavior verified via official docs
- Code examples: HIGH - Based on actual codebase patterns, adapted with verified Stripe API parameters

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain -- Stripe API versioning ensures compatibility)
