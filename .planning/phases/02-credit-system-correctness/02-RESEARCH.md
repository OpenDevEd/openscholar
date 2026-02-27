# Phase 2: Credit System Correctness - Research

**Researched:** 2026-02-27
**Domain:** Stripe credit grants, top-up checkout, refund reversals, free credit cap UX (Convex + Next.js + Stripe)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Banner on the billing page (similar pattern to Phase 1 payment failure banner) for credit cap messaging
- Informational tone -- neutral, not pushy: "Your free credits are at the maximum. Use some credits to receive your full monthly grant."
- Simple explanation only -- no detailed mechanic breakdown (no "grants are reduced proportionally" language)
- Banner persists as long as credits are at the cap -- not dismissable, resolves automatically when balance drops below cap
- Stripe Checkout redirect (hosted page) -- not embedded Stripe Elements
- After payment, wait for webhook confirmation before showing credits (no optimistic update)
- Show brief "Processing your purchase..." state on the return URL while waiting for webhook
- Toast notification when credits are granted: "X credits added to your balance"
- Buy Credits button in two locations: primary button on billing/credits page + subtle link near the credit balance display
- Monthly free credit grants: silent balance update, no notification
- Refund credit deductions: silent balance decrease, no notification
- Credit balance updates reactively in real-time via Convex subscriptions
- No credit transaction history for now -- just current balance (history is a separate feature)
- Abandoned checkout: clean return to billing page, no stale state, user can immediately start a new purchase
- Payment failures during checkout: Stripe Checkout handles its own error/retry UI -- no custom app-side error
- Refund below zero: allow negative credit balance -- honest accounting, user sees debt until they purchase more

### Claude's Discretion
- Exact banner component styling and placement within billing page
- Processing state timeout duration and fallback behavior
- Toast notification library/component choice
- Deduplication implementation strategy (idempotency keys vs invoice ID tracking)
- Reconciliation cron pagination implementation details
- Refund proportional calculation approach

### Deferred Ideas (OUT OF SCOPE)
- Credit transaction history (grants, purchases, usage, refund deductions) -- future feature
- Credit usage notifications -- out of scope per requirements
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRED-01 | Credit grant deduplication handles same-invoice-ID across different event IDs (no double grants) | Existing `by_stripe_invoice` index + `creditTransactions` lookup provides invoice-level idempotency. The current dedup checks in `grantMonthlyCredits` already guard by invoice ID. Bug: the dedup happens at invoice ID level, but the event log uses event ID -- same invoice arriving via webhook AND reconciliation cron uses different synthetic event IDs. Need to verify the invoice-ID-level guard is the canonical dedup gate, not the event log. |
| CRED-02 | Reconciliation cron handles API pagination for customers with >100 invoices | Current `reconcileRecentPaidInvoicesFromStripe` calls `stripe.invoices.list({ limit: 100 })` without `auto_paging_each`. Stripe API returns max 100 per page with `has_more` flag. Customers with >100 invoices in the lookback window will miss invoices. Need to add `autoPagingEach()` or manual cursor pagination. |
| CRED-03 | Abandoned checkout sessions don't leave stale state or block new checkout attempts | Current `createTopupCheckoutSession` creates a new Stripe Checkout Session each call with no local state tracking. Return URL params (`?topup=success` / `?topup=canceled`) are stateless. No stale state risk exists in the current implementation -- each checkout is independent. Need to verify the "Processing your purchase..." return state works correctly and add the toast notification on credit grant. |
| CRED-04 | Free credit cap communicates clearly in UI when grants are blocked | `CreditBalanceCard` already shows a small amber text "freeCapReached" when at 100%. Need to add a more prominent banner matching the Phase 1 `past_due` banner pattern with the locked messaging. Also need the cap info query from backend. |
| CRED-05 | Credit top-up purchase flow is correct end-to-end (Checkout -> payment_intent.succeeded -> credit grant -> UI update) | Full flow exists: `createTopupCheckoutSession` -> Stripe Checkout -> `payment_intent.succeeded` webhook -> `grantPurchasedCreditsFromPaymentIntent` -> balance update. Missing pieces: "Processing your purchase..." state on return URL, toast on credit grant, Buy Credits link near credit balance display. |
| CRED-06 | Refund credit reversal proportionally deducts credits and handles partial refund idempotency | `reversePurchasedCreditsFromRefund` uses `calculateRefundTargetCredits` (proportional) + `calculateRefundDeltaCredits` (cumulative replay-safe). Allows negative `paidBalance` per locked decision. Implementation is complete -- needs the negative balance allowance to be explicitly verified in the UI (no guard against showing negative). |
</phase_requirements>

## Summary

Phase 2 addresses six requirements for the credit system. The backend credit logic is substantially implemented from the initial build -- grant deduplication by invoice ID, top-up checkout via Stripe Checkout, proportional refund reversals with replay-safe delta calculation, and free credit cap enforcement all exist. The primary gaps are: (1) the reconciliation cron lacks Stripe API pagination beyond 100 invoices, (2) the frontend is missing the credit cap banner, the "processing purchase" return state, the toast notification on credit grant, and the second Buy Credits link near the credit balance, and (3) the deduplication contract needs an explicit assertion that invoice-ID-level dedup is the canonical gate (not event-log-level).

This phase is primarily a **correctness audit + UX completion** phase, not a greenfield implementation. Most backend logic exists and has been tested with live billing scenarios. The work splits naturally into: backend correctness fixes (CRED-01 dedup assertion, CRED-02 pagination fix, CRED-06 negative balance allowance) and frontend UX completion (CRED-03 processing state, CRED-04 cap banner, CRED-05 toast + buy link).

**Primary recommendation:** Fix the reconciliation pagination bug first (highest correctness risk), then complete the frontend UX pieces following the existing component patterns from Phase 1.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Stripe SDK | v20.3.0 | Payment processing, checkout sessions, invoice API | Already in use; `apiVersion: "2026-01-28.clover"` |
| Convex | Latest | Backend mutations/actions/queries, real-time subscriptions | Already in use; reactive queries drive UI updates |
| Next.js + next-intl | Latest | Frontend, i18n | Already in use for billing page |
| sonner (via showStyledToast) | In use | Toast notifications | Already used by `useAppToast` system |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @convex-dev/stripe | In use | Webhook registration, customer management, invoice mirror | Already integrated; `components.stripe` |
| lucide-react | In use | Icons | Banner icons (AlertCircle, Info, etc.) |

### Alternatives Considered
None -- this phase works entirely within the existing stack. No new libraries needed.

## Architecture Patterns

### Recommended Project Structure
```
convex/
├── credits/
│   ├── internal.ts     # Grant, purchase, refund mutations (exists)
│   ├── actions.ts      # Checkout, reconciliation actions (exists)
│   ├── queries.ts      # Balance, catalog, grant status queries (exists)
│   └── lib/
│       ├── invoiceGrantPolicy.ts  # Invoice classification (exists)
│       └── retryPolicy.ts         # Retry delays/limits (exists)
├── lib/
│   ├── creditTopups.ts    # Bundle config, refund calc (exists)
│   ├── freeCredits.ts     # Cap enforcement (exists)
│   └── constants.ts       # PLAN_CONFIG, caps (exists)
├── http.ts                # Webhook handlers (exists)
└── crons.ts               # Reconciliation cron (exists)

components/
├── billing/
│   ├── credit-balance-card.tsx   # Balance display (exists)
│   ├── credit-topup-card.tsx     # Buy bundles (exists)
│   └── credit-cap-banner.tsx     # NEW: cap reached banner
app/
└── settings/billing/page.tsx     # Main billing page (exists)
```

### Pattern 1: Invoice-ID-Level Deduplication (Existing)
**What:** Credit grants are deduplicated by `stripeInvoiceId` on the `creditTransactions` table, not by Stripe event ID.
**When to use:** Every credit grant path -- webhook-driven and cron-driven.
**Why it matters:** The same invoice can arrive via `invoice.paid` webhook (event ID = `evt_xxx`) AND via the reconciliation cron (synthetic event ID = `reconcile.pull:in_xxx`). Event-ID dedup would fail; invoice-ID dedup catches both.
**Example:**
```typescript
// From convex/credits/internal.ts - grantMonthlyCredits
if (args.stripeInvoiceId) {
  const existing = await ctx.db
    .query("creditTransactions")
    .withIndex("by_stripe_invoice", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
    .unique();
  if (existing) {
    // Already granted -- idempotent return
    return createGrantResult({ outcome: "already_granted", ... });
  }
}
```

### Pattern 2: Webhook-Then-Reconcile (Existing)
**What:** Primary credit grants fire from `invoice.paid` webhook; reconciliation cron catches any misses.
**When to use:** Monthly subscription credit grants.
**Flow:**
1. `invoice.paid` webhook -> `processInvoiceForGrant` action -> `grantMonthlyCredits` mutation
2. Hourly cron -> `reconcileRecentPaidInvoicesFromStripe` -> same `processInvoiceForGrant` path
3. Both paths converge on the same `grantMonthlyCredits` mutation with invoice-ID dedup

### Pattern 3: Phase 1 Banner Pattern (Reference for CRED-04)
**What:** Contextual banners inside the subscription card on the billing page.
**When to use:** Credit cap reached notification.
**Example from Phase 1:**
```tsx
// From app/settings/billing/page.tsx - past_due banner
{status === "past_due" && (
  <div className="bg-red-500/10 p-3 text-red-700 text-sm flex items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span>{t("paymentFailedNotice")}</span>
    </div>
    <Button variant="outline" size="sm" onClick={handleManageSubscription}>
      {t("updatePaymentMethod")}
    </Button>
  </div>
)}
```
The credit cap banner should follow this exact structure but with informational styling (amber/blue tones, not red) and no action button (since it resolves automatically when credits are used).

### Pattern 4: Stripe Auto-Pagination for >100 Results
**What:** Use Stripe SDK's `autoPagingEach()` or `autoPagingToArray()` for lists that may exceed 100.
**When to use:** `reconcileRecentPaidInvoicesFromStripe` when listing invoices per customer.
**Example:**
```typescript
// Current (broken for >100):
const invoices = await stripe.invoices.list({
  customer: stripeCustomerId,
  created: { gte: cutoffUnixSeconds },
  limit: 100,
});

// Fixed with auto-pagination:
const allInvoices: Stripe.Invoice[] = [];
for await (const invoice of stripe.invoices.list({
  customer: stripeCustomerId,
  created: { gte: cutoffUnixSeconds },
  limit: 100,
})) {
  allInvoices.push(invoice);
}
```
Note: Stripe SDK `list()` returns an `ApiList` object that supports `for await...of` iteration via `autoPagingEach`. The `limit` parameter controls page size, not total results.

### Pattern 5: Convex Reactive Subscriptions for Real-Time UI
**What:** `useQuery` (via `useProtectedQuery`) auto-subscribes to Convex queries and re-renders on data change.
**When to use:** Credit balance display. When `grantPurchasedCreditsFromPaymentIntent` patches the `credits` table, any component using `api.credits.queries.getMyBalance` re-renders automatically.
**Why it matters for CRED-05:** The "processing purchase" state shows while waiting for the webhook. Once the webhook fires and credits are granted, the Convex subscription pushes the new balance to the client without polling.

### Anti-Patterns to Avoid
- **Optimistic credit updates:** Per locked decision, never show credits before webhook confirmation. The Convex reactive subscription handles the update naturally.
- **Event-ID-level deduplication for credit grants:** The same invoice can arrive via different event IDs (webhook vs cron). Always dedup on invoice ID or payment intent ID.
- **Client-side polling for credit updates:** Convex subscriptions are push-based. No `setInterval` or `useEffect` polling needed.
- **Blocking on reconciliation results:** The cron processes invoices sequentially per customer. If one customer's invoice fails, it should not block processing for other customers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe API pagination | Manual cursor tracking with `starting_after` | `for await...of` on Stripe SDK list methods | SDK handles cursor, retry, rate limiting |
| Toast notifications | Custom toast component | Existing `showStyledToast` from sonner + `useAppToast` | Consistent UX, already integrated |
| Real-time credit balance | WebSocket or polling | Convex reactive `useQuery` subscription | Already built into the stack, zero-config |
| Refund proportional math | Custom fraction logic | Existing `calculateRefundTargetCredits` / `calculateRefundDeltaCredits` | Already tested, handles edge cases (over-refund, rounding) |

**Key insight:** This phase is about fixing a pagination bug and completing frontend UX pieces. The core credit logic (grant, purchase, refund) is already implemented and tested. The risk is in breaking what works, not in building from scratch.

## Common Pitfalls

### Pitfall 1: Double Credit Grants from Concurrent Webhook + Cron
**What goes wrong:** Same invoice processed by webhook and cron within seconds, both pass the dedup check before either writes the transaction.
**Why it happens:** Convex mutations are serializable, so within a single mutation the read-then-write is atomic. But the `processInvoiceForGrant` ACTION calls `grantMonthlyCredits` MUTATION. Two concurrent actions could both read "no existing transaction" if they overlap at the action level.
**How to avoid:** The mutation-level dedup in `grantMonthlyCredits` is the canonical gate. Since Convex mutations are serializable (OCC), two concurrent mutations writing the same `creditTransactions` row will conflict and one will retry. The existing design is correct -- just verify it explicitly.
**Warning signs:** `creditTransactions` table has two entries with the same `stripeInvoiceId`.

### Pitfall 2: Reconciliation Cron Missing Invoices Beyond Page 1
**What goes wrong:** Customer with 150+ invoices in the lookback window only has the first 100 checked. Invoices 101-150 are never reconciled.
**Why it happens:** `stripe.invoices.list({ limit: 100 })` returns only the first page. The code does not iterate `has_more`.
**How to avoid:** Use Stripe SDK auto-pagination (`for await...of`) which automatically follows `has_more` cursors.
**Warning signs:** Long-standing customers with high invoice volume reporting missing credit grants after the webhook retry window.

### Pitfall 3: Stale "Processing" State After Abandoned Checkout
**What goes wrong:** User starts checkout, abandons, returns to billing page, sees persistent "processing" spinner.
**Why it happens:** If the return URL sets a processing state based on URL params but the webhook never fires (because payment was never completed).
**How to avoid:** Use a timeout on the processing state. If credits haven't arrived within N seconds after return, show a fallback message or silently clear the state. The `?topup=success` param only indicates Stripe redirected back -- not that payment was confirmed.
**Warning signs:** Users stuck on "Processing your purchase..." indefinitely.

### Pitfall 4: Negative Balance Display Confusion
**What goes wrong:** Refund deduction takes `paidBalance` below zero. UI shows a confusing negative number.
**Why it happens:** Per locked decision, negative credit balance is allowed for honest accounting.
**How to avoid:** Ensure the `CreditBalanceCard` handles negative `paidBalance` gracefully -- show the negative number but consider adding a brief explanation or visual cue (e.g., different color for negative values).
**Warning signs:** Support tickets about "negative credits."

### Pitfall 5: Toast Fires Before Balance Updates
**What goes wrong:** Toast says "X credits added" but the displayed balance hasn't updated yet.
**Why it happens:** If toast fires in response to URL param change but the Convex subscription hasn't pushed the new balance.
**How to avoid:** Don't trigger the success toast from URL params alone. Watch the credit balance query for a change after returning from checkout, then show the toast. Alternatively, show the toast with a slight delay to let the subscription catch up.
**Warning signs:** Users see toast but balance shows old value for a moment.

## Code Examples

### Credit Cap Banner (New Component Pattern)
```tsx
// components/billing/credit-cap-banner.tsx
// Follows Phase 1 banner pattern from billing page
{freeBalance >= freeCreditCap && freeCreditCap > 0 && (
  <div className="bg-amber-500/10 p-3 text-amber-700 text-sm flex items-center gap-2">
    <Info className="w-4 h-4 flex-shrink-0" />
    <span>
      {t("creditCapBanner")}
      {/* "Your free credits are at the maximum. Use some credits to receive your full monthly grant." */}
    </span>
  </div>
)}
```

### Processing State on Checkout Return
```tsx
// In billing page, detect return from checkout
const searchParams = useSearchParams();
const isReturningFromTopup = searchParams.get("topup") === "success";
const [isWaitingForCredits, setIsWaitingForCredits] = useState(false);
const previousBalance = useRef<number | null>(null);

useEffect(() => {
  if (isReturningFromTopup && creditBalance) {
    if (previousBalance.current === null) {
      previousBalance.current = creditBalance.total;
      setIsWaitingForCredits(true);
    } else if (creditBalance.total > previousBalance.current) {
      // Credits arrived via Convex subscription
      const added = creditBalance.total - previousBalance.current;
      toast.success(t("creditsAdded", { amount: added }));
      setIsWaitingForCredits(false);
      // Clean URL
      router.replace("/settings/billing");
    }
  }
}, [isReturningFromTopup, creditBalance]);

// Timeout fallback
useEffect(() => {
  if (!isWaitingForCredits) return;
  const timeout = setTimeout(() => {
    setIsWaitingForCredits(false);
    router.replace("/settings/billing");
  }, 30_000); // 30s timeout
  return () => clearTimeout(timeout);
}, [isWaitingForCredits]);
```

### Stripe Auto-Pagination Fix for CRED-02
```typescript
// In convex/credits/actions.ts - reconcileRecentPaidInvoicesFromStripeLogic
// Replace:
//   const invoices = await stripe.invoices.list({ customer, created: { gte }, limit: 100 });
// With:
const allInvoiceData: Stripe.Invoice[] = [];
for await (const invoice of stripe.invoices.list({
  customer: stripeCustomerId,
  created: { gte: cutoffUnixSeconds },
  limit: 100,
})) {
  allInvoiceData.push(invoice);
}
const candidates = selectReconcileInvoiceCandidates({
  invoices: allInvoiceData,
  cutoffUnixSeconds,
});
```

### Buy Credits Link Near Balance Display
```tsx
// In components/auth-button.tsx or wherever credit balance is shown
{showCredits && creditsFeatureFlags.topupsEnabled && (
  <button
    onClick={() => router.push("/settings/billing#topup")}
    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
  >
    {tc("buyCredits")}
  </button>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `stripe.invoices.retrieveUpcoming()` | `stripe.invoices.createPreview()` | API version 2026-01-28.clover | Already using new API (Phase 1 fix) |
| `invoice.lines.data[].subscription` (direct) | `invoice.lines.data[].parent.subscription_item_details.subscription` | API version 2024-06+ | Already handled in `extractSubscriptionIdFromInvoiceLike` |

**Deprecated/outdated:**
- None relevant to Phase 2 scope

## Open Questions

1. **Processing state timeout duration**
   - What we know: User returns from Stripe Checkout with `?topup=success`. Need to show "Processing your purchase..." until webhook fires.
   - What's unclear: Optimal timeout before giving up and showing a fallback. Stripe webhooks typically fire within seconds, but can take up to a minute under load.
   - Recommendation: 30-second timeout with a fallback message like "Payment is being processed. Credits will appear shortly." Per Claude's discretion.

2. **Buy Credits link placement near credit balance**
   - What we know: Per locked decision, need a "subtle link near the credit balance display." Credit balance appears in two places: `CreditBalanceCard` on billing page and in the `AuthButton` dropdown.
   - What's unclear: Whether the subtle link goes in both locations or just the main billing page balance card.
   - Recommendation: Add in both locations -- billing page card gets a small "Buy Credits" link, auth dropdown gets a text link below the credit count. Per Claude's discretion.

3. **Reconciliation cron safety limit for auto-pagination**
   - What we know: Auto-pagination will iterate all invoices. A customer with thousands of invoices could cause a very long-running action.
   - What's unclear: Whether there's a practical upper bound on invoices per customer in this app's usage pattern.
   - Recommendation: Add a safety cap (e.g., 500 invoices per customer) to prevent unbounded iteration. Log a warning if cap is hit. Per Claude's discretion.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `convex/credits/internal.ts`, `convex/credits/actions.ts`, `convex/credits/queries.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/lib/creditTopups.ts`, `convex/lib/freeCredits.ts`, `convex/lib/constants.ts`
- Codebase analysis: `app/settings/billing/page.tsx`, `components/billing/credit-balance-card.tsx`, `components/billing/credit-topup-card.tsx`
- Codebase analysis: `convex/schema.ts` (table structure, indexes)
- Existing test files: `tests/credit-purchase-idempotency.test.ts`, `tests/credit-refund-reversal.test.ts`, `tests/credit-grant-policy.test.ts`, `tests/credit-reconcile-selection.test.ts`
- Phase 1 implementation patterns (payment failure banner, subscription sync)

### Secondary (MEDIUM confidence)
- Stripe SDK behavior for `autoPagingEach` / `for await...of` on list methods -- based on training knowledge of Stripe Node SDK v14+, consistent with `apiVersion: "2026-01-28.clover"` in codebase
- Convex OCC (Optimistic Concurrency Control) serialization guarantees for mutations -- based on Convex documentation patterns observed in codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Patterns directly observed in existing codebase (Phase 1 banners, credit mutations, webhook handlers)
- Pitfalls: HIGH - CRED-02 pagination bug confirmed by direct code inspection (`limit: 100` without iteration); other pitfalls derived from known Stripe/Convex patterns

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- no dependency changes expected)
