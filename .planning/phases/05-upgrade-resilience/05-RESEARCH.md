# Phase 5: Upgrade Resilience - Research

**Researched:** 2026-02-27
**Domain:** Stripe webhook-driven credit grant backup path, subscription metadata propagation, idempotent dual-path convergence in Convex
**Confidence:** HIGH

## Summary

Phase 5 makes upgrade credit grants resilient to action-path failures. Today, when a user upgrades and the `changePlan` action's `grantUpgradeProRataCredits` mutation fails (Step 3 of the non-transactional action chain), the user loses their pro-rata credits permanently. The only evidence is a `console.error` log. There is no automated recovery.

The fix adds a webhook-driven backup path: the `invoice.paid` webhook handler already fires for proration invoices (Stripe sends `billing_reason: "subscription_update"` when `always_invoice` creates a proration invoice). Currently, `invoiceGrantPolicy.ts` correctly classifies `subscription_update` as `ignore_non_recurring`, preventing monthly credit grants. Phase 5 adds a second classification path that detects upgrade proration invoices specifically -- by reading upgrade metadata (`upgradeFromPlan`, `upgradeToPlan`, `upgradeTimestamp`) from the Stripe subscription -- and triggers the same idempotent `grantUpgradeProRataCredits` mutation. Since that mutation deduplicates by `grantType + fromPlan + toPlan + period`, calling it from both the action and the webhook is safe and produces exactly one credit grant.

The implementation requires three coordinated changes: (1) write upgrade metadata to the Stripe subscription during `changePlan`, (2) extend `processInvoiceForGrant` to detect upgrade proration invoices and call `grantUpgradeProRataCredits` from the webhook path, and (3) add a test proving the `subscription_update` firewall prevents double-grants when both paths succeed.

**Primary recommendation:** Add upgrade metadata to `stripe.subscriptions.update()` in `changePlan`, extend `processInvoiceForGrant` to detect `billing_reason === "subscription_update"` + metadata and trigger `grantUpgradeProRataCredits`, and add a unit test for the `invoiceGrantPolicy` firewall.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPGR-01 | User receives pro-rata credits via webhook backup path (invoice.paid for proration invoices) if action-path grant fails | The `invoice.paid` handler already fires for proration invoices with `billing_reason: "subscription_update"`. Extend `processInvoiceForGrant` to detect upgrade context in subscription metadata and call `grantUpgradeProRataCredits`. The mutation is already idempotent (deduped by grantType + fromPlan + toPlan + period). See "Pattern 1" and "Code Example 1". |
| UPGR-02 | Stripe subscription metadata carries upgrade context (fromPlan, toPlan, upgradeTimestamp) after every upgrade operation | In `changePlan`, add `upgradeFromPlan`, `upgradeToPlan`, `upgradeTimestamp` to the metadata passed to `stripe.subscriptions.update()`. This is additive -- does not affect charge behavior. See "Pattern 2" and "Code Example 2". |
| UPGR-03 | subscription_update invoice firewall in invoiceGrantPolicy verified (with test) to prevent double-grants when both action and webhook paths succeed | `invoiceGrantPolicy.ts` already classifies `subscription_update` as `ignore_non_recurring` (line 9). The new webhook path for upgrade proration grants runs AFTER the monthly-grant classifier returns `ignore_non_recurring`, providing a separate code path. The unit test verifies the monthly-grant firewall holds. See "Pattern 3" and "Code Example 3". |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | ^20.3.0 | Stripe SDK for subscription metadata and invoice retrieval | Already installed; `subscriptions.update()` metadata param confirmed in SDK; `subscriptions.retrieve()` for metadata read-back |
| convex | (project version) | Backend runtime for actions/mutations | Existing stack; `grantUpgradeProRataCredits` already exists and is idempotent |
| vitest | (project version) | Unit test framework | Already used for existing billing tests (`tests/credit-grant-classifier.test.ts`, `tests/credit-grant-policy.test.ts`) |

### Supporting
No new libraries needed. All changes use existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Subscription metadata for upgrade context | Separate Convex table for pending upgrade state | Metadata survives action failures because it is persisted atomically in the same `subscriptions.update()` call. A separate table would require its own write, adding another failure point. |
| Extending `processInvoiceForGrant` | New dedicated webhook handler for upgrade invoices | Reusing the existing invoice processing pipeline means inheriting its retry logic, audit logging, and error tracking. A new handler would need to replicate all of that. |
| Reading subscription metadata from Stripe API | Matching against local DB history | The webhook handler already runs in a Node.js action context with Stripe API access. Reading metadata from the subscription is a single API call and gives the most current data, avoiding race conditions with local DB sync. |

**Installation:**
No new packages to install.

## Architecture Patterns

### Recommended Project Structure
No structural changes. All edits are to existing files:
```
convex/subscriptions/actions.ts         # changePlan: add upgrade metadata to subscriptions.update()
convex/credits/actions.ts               # processInvoiceForGrant: add upgrade proration detection
convex/credits/lib/invoiceGrantPolicy.ts # (optional) add comment explaining subscription_update firewall
tests/credit-grant-classifier.test.ts    # add subscription_update firewall test for UPGR-03
```

### Pattern 1: Dual-Path Convergence (Action + Webhook)

**What:** The `changePlan` action performs an optimistic credit grant (fast path) while the `invoice.paid` webhook provides an authoritative backup (durable path). Both call the same idempotent `grantUpgradeProRataCredits` mutation. Exactly one grant succeeds.

**When to use:** Whenever a Convex action calls an external API and needs to update local state, but the action's local writes can fail independently after the external call succeeds.

**How it works in this codebase:**

```
HAPPY PATH (action succeeds):
  changePlan action → grantUpgradeProRataCredits → "granted" (user sees credits immediately)
  invoice.paid webhook → processInvoiceForGrant → detect upgrade → grantUpgradeProRataCredits → "already_granted" (noop)

FAILURE PATH (action grant fails):
  changePlan action → grantUpgradeProRataCredits throws → creditsGranted: 0 (toast: "credits are being processed")
  invoice.paid webhook → processInvoiceForGrant → detect upgrade → grantUpgradeProRataCredits → "granted" (user gets credits within seconds/minutes)
```

**Idempotency contract:** `grantUpgradeProRataCredits` deduplicates by querying `creditTransactions` for an existing record with `metadata.grantType === "upgrade_prorate"` AND `metadata.fromPlan === args.fromPlan` AND `metadata.toPlan === args.toPlan` AND `createdAt >= currentPeriodStartMs`. This means the same upgrade (same fromPlan, same toPlan, same billing period) will only produce one credit transaction regardless of how many times the mutation is called.

### Pattern 2: Stripe Metadata as Cross-System State Transfer

**What:** Write upgrade context (`upgradeFromPlan`, `upgradeToPlan`, `upgradeTimestamp`) into Stripe subscription metadata during the `subscriptions.update()` call. The webhook handler reads this metadata back to classify the proration invoice.

**When to use:** When the webhook handler needs context about the user's intent that is not present in the Stripe event payload alone.

**Why metadata survives action failures:** The metadata is written as part of the same `stripe.subscriptions.update()` call that changes the price. If the charge succeeds (Stripe is atomic with `error_if_incomplete`), the metadata is persisted in Stripe regardless of whether subsequent Convex mutations succeed or fail.

**Metadata keys (prescriptive):**
- `upgradeFromPlan`: string (e.g., "go") -- the plan before upgrade
- `upgradeToPlan`: string (e.g., "pro") -- the plan after upgrade
- `upgradeTimestamp`: string (e.g., "1709055600000") -- ms epoch when upgrade was initiated

**Clearing:** The existing `clearPendingPlanMetadata` function pattern should be extended to clear upgrade metadata after the webhook handler successfully processes the upgrade proration invoice. However, stale metadata is not dangerous because the `grantUpgradeProRataCredits` dedup prevents re-granting.

### Pattern 3: Invoice Classification Routing

**What:** When `invoice.paid` fires with `billing_reason === "subscription_update"`, the existing `classifyMonthlyCreditInvoice` returns `ignore_non_recurring`. This is correct -- the monthly grant should NOT fire for proration invoices. The NEW code path runs AFTER this classification: it checks whether the invoice is an upgrade proration invoice (by reading subscription metadata from Stripe), and if so, routes to `grantUpgradeProRataCredits` instead of `grantMonthlyCredits`.

**Flow:**

```
processInvoiceForGrant (action)
  │
  ├─ Fetch invoice from Stripe
  ├─ classifyMonthlyCreditInvoice(billing_reason)
  │    ├─ "grant" (subscription_create/cycle) → grantMonthlyCredits [existing]
  │    ├─ "ignore_non_recurring" (subscription_update) → [CHECK FOR UPGRADE]
  │    │    ├─ Has upgrade metadata on subscription? → grantUpgradeProRataCredits [NEW]
  │    │    └─ No upgrade metadata? → ignore (noop) [existing behavior preserved]
  │    └─ other → handle as before
  │
  └─ Return outcome
```

**Key constraint:** The `grantMonthlyCredits` mutation MUST NEVER fire for `subscription_update` invoices. This is the firewall. The `grantUpgradeProRataCredits` mutation fires on a separate, metadata-gated code path.

### Anti-Patterns to Avoid

- **Adding `subscription_update` to `ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS`:** This would cause every proration invoice to trigger a full monthly credit grant on top of any upgrade pro-rata credits. Critical double-grant bug. The firewall exists at `invoiceGrantPolicy.ts` line 9 and MUST NOT be weakened.

- **Reading upgrade context from local DB instead of Stripe metadata:** The local DB sync (`syncSubscription`) may not have completed when the webhook fires. Reading from the Stripe subscription directly (via API call in the action context) is authoritative and avoids race conditions.

- **Clearing upgrade metadata before the webhook processes:** If the action path clears metadata before `invoice.paid` fires, the webhook cannot detect the upgrade context. Metadata should only be cleared AFTER successful webhook processing, or left to age out harmlessly (dedup protects against re-granting).

- **Creating a new dedup mechanism for the webhook path:** The existing `grantUpgradeProRataCredits` dedup (by grantType + fromPlan + toPlan + period) is sufficient. Do not add stripeInvoiceId-based dedup for upgrade grants -- the Phase 4 research explicitly explains why stripeInvoiceId dedup does not work for upgrades (the latest_invoice may still reference the original cycle invoice).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Upgrade detection in webhook | Custom invoice line item parsing to detect proration type | Subscription metadata written during `changePlan` | Metadata is explicit, authoritative, and survives action failures. Line item parsing is fragile across Stripe API versions. |
| Credit grant deduplication | New dedup table or stripeInvoiceId-based dedup for upgrades | Existing `grantUpgradeProRataCredits` dedup (grantType + fromPlan + toPlan + period) | Already implemented, already tested. Adding another dedup layer increases complexity without benefit. |
| Webhook retry/audit logging | Custom retry queue or logging for upgrade grant path | Existing `processInvoiceForGrantNonBlocking` retry + `stripeEventLogs` audit | The existing `invoice.paid` handler already has 60s retry with audit logging. Reuse this infrastructure. |
| Invoice-to-subscription metadata resolution | Inline metadata fetch in the webhook handler | Extend `processInvoiceForGrant` action which already has Stripe API access | The action already fetches the invoice from Stripe. Adding a subscription retrieve call keeps all Stripe API calls in the same context. |

**Key insight:** The entire infrastructure for this phase already exists. The `grantUpgradeProRataCredits` mutation is idempotent. The `invoice.paid` webhook handler fires for proration invoices. The `processInvoiceForGrant` action fetches from Stripe and classifies invoices. Phase 5 wires these components together by adding metadata to the upgrade write and a detection branch to the invoice processor.

## Common Pitfalls

### Pitfall 1: Proration Invoice Triggers Monthly Credit Grant (Double-Grant)

**What goes wrong:** If `classifyMonthlyCreditInvoice` were to classify `subscription_update` as eligible, the user would receive BOTH a full monthly credit grant (from `grantMonthlyCredits`) AND an upgrade pro-rata grant (from `grantUpgradeProRataCredits`).

**Why it happens:** The `subscription_update` billing reason is in `NON_RECURRING_REASONS`, not `ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS`. If someone mistakenly moves it, or if a new billing reason appears that bypasses the classifier, the monthly grant fires.

**How to avoid:** (1) Never add `subscription_update` to `ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS`. (2) Add a unit test (UPGR-03) that explicitly asserts `classifyMonthlyCreditInvoice({ invoiceBillingReason: "subscription_update" })` returns `ignore_non_recurring`. (3) Add a comment in `invoiceGrantPolicy.ts` explaining why this classification is critical.

**Warning signs:** `creditTransactions` table shows two grants for the same upgrade: one with `description` matching "Monthly credit grant" and another matching "Upgrade pro-rata credit grant".

### Pitfall 2: Metadata Not Present When Webhook Fires

**What goes wrong:** If the upgrade metadata is written in a separate Stripe API call AFTER `subscriptions.update()`, there is a window where the webhook fires before metadata is present. The webhook handler would not detect the upgrade and would silently skip the credit grant.

**Why it happens:** The `subscriptions.update()` call atomically applies the price change, proration, AND metadata. But if someone refactors to write metadata in a separate `subscriptions.update()` call, the atomicity is broken.

**How to avoid:** Write upgrade metadata in the SAME `subscriptions.update()` call that changes the price. The existing code already passes `metadata: clearPendingPlanMetadata(...)` to this call -- extend it with upgrade fields.

**Warning signs:** Webhook handler logs show `subscription_update` invoices with no upgrade metadata on the subscription.

### Pitfall 3: Stale Metadata From Previous Upgrade

**What goes wrong:** If upgrade metadata is not cleared after webhook processing, a subsequent `subscription_cycle` invoice could see stale `upgradeFromPlan`/`upgradeToPlan` metadata and misclassify as an upgrade proration.

**Why it happens:** Metadata persists on the Stripe subscription until explicitly cleared.

**How to avoid:** The new webhook code path should check `billing_reason === "subscription_update"` AND metadata exists AND `upgradeTimestamp` is recent (within the current billing period). The `grantUpgradeProRataCredits` dedup also catches stale re-triggers because the same fromPlan + toPlan + period would match an existing grant.

**Warning signs:** `grantUpgradeProRataCredits` returning `already_granted` on subscription cycle invoices.

### Pitfall 4: Webhook Handler Needs Stripe API Access (Must Be Action, Not Mutation)

**What goes wrong:** Reading subscription metadata from Stripe requires an API call. Convex mutations cannot make external API calls. If the upgrade detection logic is placed in a mutation, it cannot read metadata.

**Why it happens:** The `invoice.paid` handler calls `processInvoiceForGrantNonBlocking` which runs `processInvoiceForGrant` as an `internalAction`. This action already has Stripe API access. The upgrade detection code MUST be placed in this action, not in the downstream `grantMonthlyCredits` mutation.

**How to avoid:** Add the subscription metadata fetch and upgrade detection in `processInvoiceForGrantLogic` (the action), then pass the resolved upgrade context down to `grantUpgradeProRataCredits` (the mutation).

**Warning signs:** Runtime error "Cannot make fetch requests from mutations" if detection logic is accidentally placed in a mutation.

### Pitfall 5: Period Boundaries Must Come From Stripe, Not Local DB

**What goes wrong:** `grantUpgradeProRataCredits` requires `currentPeriodStartMs` and `currentPeriodEndMs` to calculate the pro-rata ratio and for dedup. If these are read from the local DB subscription record, they may be stale (the `syncSubscription` mutation may not have run yet when the webhook fires).

**Why it happens:** The webhook and the action sync mutations may execute in any order.

**How to avoid:** In the webhook path, fetch the subscription from Stripe API (which `processInvoiceForGrant` already does for the invoice). Read `current_period_start` and `current_period_end` from the fresh Stripe subscription object.

**Warning signs:** Pro-rata credit amounts that differ between the action path and webhook path for the same upgrade.

## Code Examples

### Code Example 1: Write Upgrade Metadata in changePlan

```typescript
// convex/subscriptions/actions.ts :: changePlan :: upgraded_immediately branch
// CURRENT (line ~693):
const updated = await stripe.subscriptions.update(stripeSubscription.id, {
  items: [{ id: item.id, price: args.targetPriceId, quantity: item.quantity ?? 1 }],
  proration_behavior: "always_invoice",
  proration_date: args.prorationDate,
  payment_behavior: "error_if_incomplete",
  cancel_at_period_end: false,
  metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
});

// NEW:
const updated = await stripe.subscriptions.update(stripeSubscription.id, {
  items: [{ id: item.id, price: args.targetPriceId, quantity: item.quantity ?? 1 }],
  proration_behavior: "always_invoice",
  proration_date: args.prorationDate,
  payment_behavior: "error_if_incomplete",
  cancel_at_period_end: false,
  metadata: {
    ...clearPendingPlanMetadata(stripeSubscription.metadata || {}),
    upgradeFromPlan: currentPlan,
    upgradeToPlan: targetPlan,
    upgradeTimestamp: String(Date.now()),
  },
});
```

### Code Example 2: Detect Upgrade Proration in processInvoiceForGrant

```typescript
// convex/credits/actions.ts :: processInvoiceForGrantLogic
// After the existing classifyMonthlyCreditInvoice check, when decision is "ignore_non_recurring"
// and billing_reason is "subscription_update":

if (
  decision.decision === "ignore_non_recurring" &&
  invoiceBillingReason === "subscription_update" &&
  stripeSubscriptionId
) {
  // This may be an upgrade proration invoice -- check subscription metadata
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const meta = subscription.metadata ?? {};
  const upgradeFromPlan = meta.upgradeFromPlan;
  const upgradeToPlan = meta.upgradeToPlan;
  const upgradeTimestamp = meta.upgradeTimestamp;

  if (upgradeFromPlan && upgradeToPlan && upgradeTimestamp) {
    // Resolve the user from the subscription
    const subRecord = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByStripeId,
      { stripeSubscriptionId }
    );

    if (subRecord?.userId) {
      const sub = subscription as any;
      const periodStartMs = (sub.current_period_start ?? 0) * 1000;
      const periodEndMs = (sub.current_period_end ?? 0) * 1000;

      const grantResult = await ctx.runMutation(
        internalApi.credits.internal.grantUpgradeProRataCredits,
        {
          userId: subRecord.userId,
          fromPlan: upgradeFromPlan,
          toPlan: upgradeToPlan,
          currentPeriodStartMs: periodStartMs,
          currentPeriodEndMs: periodEndMs,
          stripeSubscriptionId,
        }
      );

      return {
        outcome: grantResult.outcome,
        message: grantResult.message,
        usedFallbackSubscription,
      };
    }
  }

  // No upgrade metadata or no user found -- fall through to normal ignore
}
```

### Code Example 3: Unit Test for Firewall (UPGR-03)

```typescript
// tests/credit-grant-classifier.test.ts (extend existing)
import { classifyMonthlyCreditInvoice } from "../convex/credits/lib/invoiceGrantPolicy";

describe("upgrade resilience firewall", () => {
  it("subscription_update never triggers monthly credit grant (UPGR-03)", () => {
    const result = classifyMonthlyCreditInvoice({
      stripeSubscriptionId: "sub_123",
      invoiceStatus: "paid",
      invoiceBillingReason: "subscription_update",
    });

    // CRITICAL: subscription_update must ALWAYS be classified as non-recurring.
    // If this changes, upgrade proration invoices would trigger both a monthly
    // credit grant AND an upgrade pro-rata grant, causing double-grants.
    expect(result.decision).toBe("ignore_non_recurring");
    expect(result.classification).toBe("ignored_non_recurring_reason");
  });
});
```

### Code Example 4: Query to Look Up Subscription by Stripe ID

```typescript
// convex/subscriptions/internal.ts (new internal query)
export const getSubscriptionByStripeId = internalQuery({
  args: { stripeSubscriptionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      plan: planValidator,
      status: subscriptionValidator,
      currentPeriodStart: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .first();

    if (!sub) return null;
    return {
      userId: sub.userId,
      plan: sub.plan,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  },
});
```

Note: This query may already exist in a different form. Check `getSubscriptionByUser` in `subscriptions/internal.ts`. The existing `getSubscriptionByStripeOrMetadata` private function has similar logic but is not exported as an internal query. A lightweight internal query indexed on `by_stripe_sub` is needed for the webhook path.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Credit grants only in action (no backup) | Dual-path convergence: action (optimistic) + webhook (authoritative) | This phase | Credits are never permanently lost |
| No upgrade context in Stripe metadata | Upgrade metadata written atomically with price change | This phase | Webhook handler can detect and process upgrade proration invoices |
| `subscription_update` firewall untested | Unit test verifies `ignore_non_recurring` classification | This phase | Regression protection for the most critical double-grant vector |

**Deprecated/outdated:**
- None relevant to this phase. All APIs and patterns are current.

## Open Questions

1. **Does `billing_reason: "subscription_update"` reliably appear on proration invoices created by `always_invoice`?**
   - What we know: Stripe documentation confirms proration invoices from `subscriptions.update()` with `proration_behavior: "always_invoice"` carry `billing_reason: "subscription_update"`. The existing `invoiceGrantPolicy.ts` already handles this value, implying it has been observed in practice. Multiple project research documents confirm this.
   - What's unclear: Whether edge cases (e.g., simultaneous proration + additive line items) change the billing reason.
   - Recommendation: Verify in Stripe test mode by triggering an actual upgrade and inspecting the resulting invoice's `billing_reason`. This is a pre-deployment validation step, not a blocker for implementation. Confidence: HIGH based on Stripe docs and existing code assumptions.

2. **Should upgrade metadata be cleared after webhook processing?**
   - What we know: Stale metadata is not dangerous because `grantUpgradeProRataCredits` dedup prevents re-granting. Clearing metadata keeps the subscription object clean.
   - What's unclear: Whether clearing metadata should happen in the webhook handler or in a separate cleanup step. Clearing in the webhook handler adds another Stripe API call. Leaving metadata is harmless but slightly messy.
   - Recommendation: Do NOT clear metadata in the webhook handler. The dedup is sufficient. Metadata will be overwritten by the next upgrade, or can be cleaned up by a future maintenance task. Clearing adds Stripe API latency and a new failure point in the webhook path.

3. **Does `processInvoiceForGrant` need a new internal query to resolve userId from stripeSubscriptionId?**
   - What we know: The existing `findGrantSubscription` function in `credits/internal.ts` resolves subscriptions from stripe IDs, but it runs in mutation context. The `processInvoiceForGrant` action needs to resolve the userId to call `grantUpgradeProRataCredits`.
   - What's unclear: Whether an existing internal query already exposes this lookup.
   - Recommendation: Add a lightweight `getSubscriptionByStripeId` internal query to `subscriptions/internal.ts`. The existing `by_stripe_sub` index makes this efficient. See "Code Example 4".

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `convex/subscriptions/actions.ts` (changePlan lines 526-843, metadata handling), `convex/credits/actions.ts` (processInvoiceForGrant lines 241-371), `convex/credits/internal.ts` (grantUpgradeProRataCredits lines 823-955), `convex/credits/lib/invoiceGrantPolicy.ts` (subscription_update classification), `convex/http.ts` (invoice.paid webhook handler)
- `.planning/research/ARCHITECTURE.md` -- Dual-path convergence architecture, Pattern 2 (metadata), Pattern 3 (invoice classification), build order
- `.planning/research/PITFALLS.md` -- Pitfall 6 (subscription_update firewall), Pitfall 7 (period boundary timestamps)
- `.planning/phases/04-upgrade-flow-fix/04-RESEARCH.md` -- Phase 4 scope boundary confirming metadata is Phase 5 scope
- Existing test patterns: `tests/credit-grant-classifier.test.ts`, `tests/credit-grant-policy.test.ts` (vitest, direct import from `convex/` modules)

### Secondary (MEDIUM confidence)
- Stripe documentation: proration invoices carry `billing_reason: "subscription_update"` when created by `always_invoice`. Confirmed by existing code assumptions and research documents. Not independently verified against live Stripe test-mode data in this research session.
- Stripe subscription metadata: string key-value pairs, persisted atomically with `subscriptions.update()`. Confirmed by existing usage of `clearPendingPlanMetadata` in the codebase.

### Tertiary (LOW confidence)
- None. All findings verified from codebase analysis and existing research documents.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all changes to existing code
- Architecture: HIGH -- dual-path convergence pattern is thoroughly documented in existing research, all integration points identified from direct code analysis
- Pitfalls: HIGH -- double-grant vector (Pitfall 6) already documented and analyzed, firewall exists and just needs test coverage

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- Stripe SDK and Convex patterns unlikely to change)
