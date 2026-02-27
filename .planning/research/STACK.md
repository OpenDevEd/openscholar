# Stack Research: v1.1 Upgrade Flow

**Domain:** Stripe upgrade flow with proration preview, pro-rata credit grants, atomic operations
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Finding: No New Dependencies Required

The existing stack fully covers all v1.1 requirements. The broken upgrade flow is a coordination logic problem, not a missing library problem. Every technology needed for proration preview, atomic upgrade operations, confirmation dialogs, and pro-rata credit grants is already installed and partially implemented.

## Existing Stack (Validated for v1.1)

### Core Technologies

| Technology | Version | Purpose | v1.1 Status |
|------------|---------|---------|-------------|
| stripe | ^20.3.0 (API `2026-01-28.clover`) | Stripe SDK for proration preview and subscription updates | Already uses `invoices.createPreview()` and `subscriptions.update()`. No upgrade needed. |
| convex | ^1.31.7 | Backend runtime; OCC-atomic mutations, action coordination | `changePlan` action already coordinates Stripe API calls with `ctx.runMutation`. Pattern is correct. |
| @convex-dev/stripe | ^0.1.3 | Checkout sessions, customer management, webhook routing | Not used for plan changes (correct -- component lacks subscription update methods). |
| @convex-dev/workflow | ^0.3.4 | Durable workflow execution | Already installed. **Not recommended for upgrade flow** (see rationale below). |
| @radix-ui/react-dialog | ^1.1.15 | Confirmation dialog primitive | `UpgradeConfirmationDialog` already built with this. |
| sonner | ^2.0.7 | Toast notifications | Already used for upgrade success/failure feedback. |
| next-intl | ^4.8.2 | i18n for dialog text | Translation keys for `upgradeDialog` already exist. |
| swr | ^2.3.3 | Client-side data fetching | Used for Stripe price fetching. Not needed for single-use upgrade previews. |

### Supporting Libraries (Already Installed)

| Library | Version | Purpose | v1.1 Relevance |
|---------|---------|---------|----------------|
| date-fns | ^4.1.0 | Date formatting | Available for period remaining display in confirmation dialog |
| zod | ^4.3.6 | Runtime validation | Convex validators already handle action input/output validation |
| convex-helpers | ^0.1.111 | Utility functions for Convex | Available but not needed for upgrade flow |

## Stripe API Endpoints for v1.1

All available in `stripe@^20.3.0` with API version `2026-01-28.clover`.

### Proration Preview

**Endpoint:** `POST /v1/invoices/create_preview`
**SDK Method:** `stripe.invoices.createPreview()`
**Status:** Already implemented in `getUpgradePreview` action.

```typescript
// Existing implementation (convex/subscriptions/actions.ts:892)
const preview = await stripe.invoices.createPreview({
  customer: customerId,
  subscription: stripeSub.id,
  subscription_details: {
    items: [{ id: item.id, price: args.targetPriceId }],
    proration_behavior: "always_invoice",
    proration_date: Math.floor(Date.now() / 1000),
  },
});
```

**Key response fields used:** `preview.total` (proration amount), `preview.amount_due` (immediate charge), `preview.currency`.

**Note:** `GET /v1/invoices/upcoming` was removed in API version `2025-03-31.basil`. The codebase correctly uses the replacement `createPreview` method. No migration needed.

### Subscription Update with Proration

**Endpoint:** `POST /v1/subscriptions/{id}`
**SDK Method:** `stripe.subscriptions.update()`
**Status:** Already implemented in `changePlan` action.

```typescript
// Existing implementation (convex/subscriptions/actions.ts:690)
const updated = await stripe.subscriptions.update(stripeSubscription.id, {
  items: [{ id: item.id, price: args.targetPriceId, quantity: item.quantity ?? 1 }],
  proration_behavior: "always_invoice",
  payment_behavior: "error_if_incomplete",
  cancel_at_period_end: false,
  metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
});
```

**Critical parameters:**
- `proration_behavior: "always_invoice"` -- creates proration AND immediately generates + charges an invoice
- `payment_behavior: "error_if_incomplete"` -- if payment fails, the API throws and subscription is NOT changed. This is the atomicity guarantee from Stripe's side.

### Critical Fix: `proration_date` Alignment

**Problem:** Stripe prorates to the second. The preview captures `proration_date: Math.floor(Date.now() / 1000)`, but the actual `subscriptions.update()` does NOT pass a `proration_date`, so Stripe uses the moment of the update call. The user sees one number in the dialog but could be charged a slightly different amount.

**Fix:** Return `proration_date` from `getUpgradePreview`, pass it through the client, and send it to `changePlan` as `proration_date` on the `subscriptions.update()` call.

**Risk if not fixed:** LOW for monthly subscriptions (cents of drift), but fixing it is trivial and matches Stripe's documented best practice.

**Source:** [Stripe Prorations docs](https://docs.stripe.com/billing/subscriptions/prorations) -- "Because Stripe prorates to the second, prorated amounts might change between the time they're previewed and the time the update is made."

## Convex Patterns for Atomic Upgrade Operations

### Current Pattern (Correct Architecture)

The `changePlan` action follows this sequence:

```
1. ACTION: Validate input, fetch subscription from Stripe API
2. ACTION: Release pending schedule if exists (Stripe API call)
3. ACTION: stripe.subscriptions.update() with proration (Stripe API call)
   -> Stripe guarantees: payment succeeds OR throws, no partial state
4. ACTION -> MUTATION: ctx.runMutation(syncSubscription) -- sync local DB
   -> Convex guarantees: atomic via OCC, auto-retried on conflict
5. ACTION -> MUTATION: ctx.runMutation(grantUpgradeProRataCredits) -- grant credits
   -> Currently wrapped in try/catch (non-fatal)
```

**Why this is correct:**
- Stripe's `error_if_incomplete` provides atomicity for the payment step -- subscription either changes AND payment succeeds, or nothing happens
- Convex mutations are individually atomic via OCC
- The action coordinates the sequence; failures at any step have clear semantics

### Why NOT to Use @convex-dev/workflow

Despite being installed, `@convex-dev/workflow` should NOT be used for the upgrade flow:

| Reason | Detail |
|--------|--------|
| Operation is fast | Total duration ~2-3 seconds (two Stripe calls + two mutations). Workflows add durable execution overhead for operations that are already fast. |
| Stripe provides atomicity | `payment_behavior: "error_if_incomplete"` means the primary operation (subscription update + payment) is already atomic on Stripe's side. No saga-style rollback needed. |
| Credit grant has fallback | If `grantUpgradeProRataCredits` fails after the subscription update succeeds, the `invoice.paid` webhook handles monthly credit grants. The user's plan is correct; only the bonus credits are delayed. |
| Unnecessary complexity | A workflow with compensation steps for an operation that has a clear "primary succeeds, secondary is best-effort" pattern adds code without adding reliability. |

**When workflow WOULD be appropriate:** Multi-step operations where each step has external side effects that need rollback (e.g., provision infrastructure + charge payment + send notification), or long-running operations (>30 seconds).

### Recommended Pattern: "Primary + Best-Effort Secondary" (Existing)

```typescript
// PRIMARY: Must succeed or entire operation fails
const updated = await stripe.subscriptions.update(subId, { ... });

// SYNC: Must succeed (deterministic, OCC auto-retried)
await ctx.runMutation(internal.subscriptions.internal.syncSubscription, { ... });

// SECONDARY: Best-effort, non-fatal, has fallback path
try {
  const result = await ctx.runMutation(
    internal.credits.internal.grantUpgradeProRataCredits, { ... }
  );
  creditsGranted = result.grantedCredits;
} catch (err) {
  console.error("[changePlan] Pro-rata credit grant failed (non-fatal)", { ... });
  // Fallback: invoice.paid webhook grants monthly credits; user can contact support
}
```

### What Needs Fixing in the Pattern

The code architecture is correct, but three implementation issues cause the "broken upgrade flow":

| Issue | Current Behavior | Fix |
|-------|-----------------|-----|
| Credit grant failure is silent to user | `creditsGranted` is `undefined` on failure; UI shows generic success | Return `creditsGranted: 0` explicitly and show "credits will be granted shortly" message |
| No retry for failed credit grants | Unlike `grantMonthlyCredits` which schedules retries, `grantUpgradeProRataCredits` failures are fire-and-forget | Schedule a retry mutation via `ctx.scheduler.runAfter()` on failure |
| Preview-to-confirm gap may cause stale data | Time between preview and confirm could invalidate subscription state | Re-validate subscription state at the start of `changePlan` (already done -- fetches fresh from Stripe) |

**These are logic fixes within existing code, NOT stack additions.**

## UI Pattern: Confirmation Dialog (Already Implemented)

### Current Implementation

`components/billing/upgrade-confirmation-dialog.tsx` uses `@radix-ui/react-dialog` and displays:
- Current plan -> target plan transition
- Prorated charge amount (formatted with `next-intl` formatter)
- Pro-rata credits to be granted
- Remaining days in billing period
- Confirm/Cancel buttons with loading state

### Flow

```
User clicks "Upgrade" -> getUpgradePreview() -> Dialog opens with preview data
User clicks "Confirm" -> changePlan() -> Dialog closes -> Success toast
```

### Minor Enhancements (No New Dependencies)

| Enhancement | Implementation | Complexity |
|-------------|---------------|------------|
| Show card last4 in dialog | Data already available in `subscriptionDetails.cardLast4` from `getSubscriptionDetails` | LOW -- pass through to preview |
| Pass `proration_date` round-trip | Add to `getUpgradePreview` return, pass to `changePlan` args | LOW -- two field additions |
| "Credits will arrive shortly" fallback text | When `creditsGranted` is 0 or undefined after confirm | LOW -- conditional text in success toast |

## Installation

```bash
# No new packages to install.
# The existing stack fully covers v1.1 requirements.
```

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Raw `stripe.invoices.createPreview()` in Convex action | Stripe Customer Portal for upgrades | Portal cannot grant pro-rata credits. Custom dialog required for credit display. |
| Action with `ctx.runMutation()` | `@convex-dev/workflow` saga | Over-engineered. Operation is fast, Stripe provides payment atomicity, credit grant has webhook fallback. |
| `@radix-ui/react-dialog` | `@radix-ui/react-alert-dialog` | AlertDialog prevents outside-click dismiss, which is stronger. But Dialog already prevents close during `isConfirming`. Either works; keep current. |
| `sonner` toast for feedback | Custom notification component | sonner is already integrated, provides stacking, auto-dismiss, and promise-based toasts. No reason to replace. |
| `useState` for dialog state | Global state (Zustand/Jotai) | Dialog state is local to the Pricing component lifecycle. Global state adds complexity for no benefit. |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@stripe/stripe-js` or `@stripe/react-stripe-js` | No Stripe Elements needed. Charge goes through payment method already on file. | Server-side Stripe SDK via Convex actions |
| Additional state management (Redux, Zustand for billing) | Convex reactive queries already propagate subscription state changes to all components. `syncSubscription` mutation triggers re-render automatically. | Convex queries + React `useState` for local dialog state |
| Custom retry/queue library | `grantMonthlyCredits` already has `retryPolicy.ts` with `shouldRetryCreditGrant` + `getCreditGrantRetryDelayMs`. Reuse this for upgrade credit retry. | Existing retry infrastructure |
| `@convex-dev/workflow` for upgrade flow | See rationale above. | Direct action with try/catch |
| Client-side polling for upgrade result | `syncLocalSubscriptionFromStripe` writes to Convex DB, which triggers reactive query updates automatically. | Convex reactive queries (already used via `useSubscriptionState`) |
| `stripe.invoices.retrieveUpcoming()` | Removed in API version `2025-03-31.basil`. Not available with `2026-01-28.clover`. | `stripe.invoices.createPreview()` (already used) |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| stripe@^20.3.0 | API `2026-01-28.clover` | `invoices.createPreview` available since stripe@18.0.0 (API `2025-03-31.basil`). Codebase uses correct method. |
| convex@^1.31.7 | @convex-dev/stripe@^0.1.3, @convex-dev/workflow@^0.3.4 | All compatible. OCC guarantees apply to all mutations called from actions. |
| @radix-ui/react-dialog@^1.1.15 | react@^19.2.4 | Radix UI v1.x fully supports React 19. |
| sonner@^2.0.7 | react@^19.2.4 | Sonner v2.x supports React 19. |
| next-intl@^4.8.2 | next@^16.1.6 | Formatter and translation hooks used in dialog work correctly. |

## Sources

- [Stripe: Create a preview invoice](https://docs.stripe.com/api/invoices/create_preview) -- `subscription_details` parameters, `proration_behavior`, `proration_date` reference (HIGH confidence)
- [Stripe: Prorations documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- `proration_date` alignment guidance, `always_invoice` behavior, preview-then-confirm workflow (HIGH confidence)
- [Stripe: Update a subscription](https://docs.stripe.com/api/subscriptions/update) -- `payment_behavior: error_if_incomplete` semantics (HIGH confidence)
- [Stripe: Invoice preview API deprecation](https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations) -- `GET /v1/invoices/upcoming` removed in `2025-03-31.basil`, replaced by `createPreview` (HIGH confidence)
- [Convex: OCC and Atomicity](https://docs.convex.dev/database/advanced/occ) -- mutation atomicity guarantees, automatic retry on OCC conflict (HIGH confidence)
- [Convex: Actions](https://docs.convex.dev/functions/actions) -- `ctx.runMutation` from actions, error handling responsibility, anti-pattern of sequential `runMutation` calls without batching (HIGH confidence)
- [Convex: Best Practices](https://docs.convex.dev/understanding/best-practices/) -- batch database operations in single transactions (HIGH confidence)
- [Convex Workflow component](https://www.convex.dev/components/workflow) -- durable workflow capabilities, when appropriate vs. simple actions (MEDIUM confidence)
- Codebase review: `convex/subscriptions/actions.ts`, `convex/credits/internal.ts`, `components/billing/upgrade-confirmation-dialog.tsx`, `components/Pricing.tsx` (HIGH confidence)

---
*Stack research for: v1.1 Upgrade Flow -- proration preview, pro-rata credit grants, atomic operations*
*Researched: 2026-02-27*
