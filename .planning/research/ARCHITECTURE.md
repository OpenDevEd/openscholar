# Architecture Research: Upgrade Flow with Proration Preview

**Domain:** Stripe subscription upgrade flow in Convex + Next.js (proration preview, pro-rata credit grants, atomicity)
**Researched:** 2026-02-27
**Confidence:** HIGH (based on direct codebase analysis + Stripe/Convex documentation)

## Existing System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Next.js)                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Pricing.tsx                                                      │  │
│  │    handleSubscribe() → getUpgradePreview() → open dialog          │  │
│  │    handleConfirmUpgrade() → changePlan() → refresh state          │  │
│  └─────────────────┬──────────────────────────┬─────────────────────┘  │
│                    │ useAction()               │ useAction()            │
├────────────────────┼──────────────────────────┼─────────────────────────┤
│                    ↓                          ↓                         │
│  CONVEX ACTIONS (Node.js runtime, NOT transactional)                   │
│  ┌──────────────────────────┐  ┌───────────────────────────────────┐  │
│  │ getUpgradePreview        │  │ changePlan                         │  │
│  │  1. Fetch Stripe sub     │  │  1. Fetch Stripe sub               │  │
│  │  2. invoices.createPreview│  │  2. Determine upgrade/downgrade   │  │
│  │  3. Calculate pro-rata   │  │  3. Release schedule if needed     │  │
│  │  4. Return preview data  │  │  4. stripe.subscriptions.update()  │  │
│  │     (read-only, safe)    │  │  5. syncLocalSubscriptionFromStripe│  │
│  └──────────────────────────┘  │  6. grantUpgradeProRataCredits     │  │
│                                │     (try/catch, non-fatal)         │  │
│                                └───────────┬───────────────────────┘  │
│                                            │                           │
│  CONVEX MUTATIONS (transactional, atomic)  │                           │
│  ┌─────────────────────┐  ┌───────────────┴───────────────────────┐  │
│  │ syncSubscription     │  │ grantUpgradeProRataCredits            │  │
│  │  - upsert plan/status│  │  - dedup by grantType+period          │  │
│  │  - update period     │  │  - calculate pro-rata                 │  │
│  │  - link customer     │  │  - apply tier cap                     │  │
│  └─────────────────────┘  │  - insert creditTransaction            │  │
│                            └──────────────────────────────────────┘  │
│                                                                       │
│  WEBHOOK PATH (separate, async)                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  customer.subscription.updated → handleSubscriptionWebhook     │  │
│  │    → re-fetch from Stripe API → syncLocalSubscriptionFromStripe│  │
│  │  invoice.paid → processInvoiceForGrantNonBlocking              │  │
│  │    → grantMonthlyCredits (deduped by stripeInvoiceId)          │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## The Core Atomicity Problem

The existing `changePlan` action performs three sequential operations that are NOT in a single transaction:

```
Step 1: stripe.subscriptions.update()     → Stripe API (external, irreversible)
Step 2: syncLocalSubscriptionFromStripe()  → Convex mutation (transactional)
Step 3: grantUpgradeProRataCredits()       → Convex mutation (transactional)
```

**Current failure modes in the existing code:**

| Failure Point | What Happens | User Impact |
|---------------|-------------|-------------|
| Step 1 fails (card declined) | Nothing changes | Clean -- `error_if_incomplete` ensures atomic Stripe behavior |
| Step 2 fails after Step 1 | Stripe charged, local DB stale | **Broken** -- plan shows old, user charged. Webhook eventually fixes plan sync but may be delayed |
| Step 3 fails after Steps 1+2 | Charged + plan synced, no credits | **Credits lost** -- user upgraded and paid but did not receive pro-rata credits. Currently logged as `console.error` but no recovery path |

The existing code wraps Step 3 in try/catch and logs the error as "non-fatal." This is correct in the sense that you should not roll back a successful Stripe charge for a credit-grant failure. But it means credits can silently go missing with no automated recovery.

## Recommended Architecture: Webhook-Driven Credit Grants

### Principle: Credit grants should NEVER depend on action-chain success

The Convex documentation is unambiguous: actions are NOT transactional. When an action calls a mutation, then another mutation, and the second fails, the first mutation's changes persist. There is no rollback across multiple `ctx.runMutation` calls within an action.

**The correct pattern for Convex + Stripe is:**

1. **Actions** handle Stripe API calls and optimistic local sync
2. **Webhooks** are the authoritative trigger for credit grants
3. **Mutations** provide the atomicity boundary (each mutation is individually transactional)

### Recommended Upgrade Flow Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 1: PREVIEW (read-only, no side effects)                       │
│                                                                      │
│  Client                          Convex Action                       │
│  ──────                          ────────────                        │
│  User clicks "Upgrade"  ──→  getUpgradePreview                      │
│                               │ 1. stripe.subscriptions.retrieve()  │
│                               │ 2. stripe.invoices.createPreview()  │
│                               │ 3. Calculate pro-rata credits       │
│                               │ 4. Return preview data              │
│  Show confirmation dialog ←──┘                                      │
│                                                                      │
│  STATUS: No changes anywhere. Safe to abandon.                       │
└──────────────────────────────────────────────────────────────────────┘
         │
         │ User clicks "Confirm Upgrade"
         ↓
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 2: EXECUTE (Stripe API call + optimistic sync)                │
│                                                                      │
│  Client                          Convex Action                       │
│  ──────                          ────────────                        │
│  handleConfirmUpgrade()  ──→  changePlan                             │
│                               │ 1. Release pending schedule          │
│                               │ 2. stripe.subscriptions.update({     │
│                               │      proration_behavior:             │
│                               │        "always_invoice",             │
│                               │      payment_behavior:               │
│                               │        "error_if_incomplete"         │
│                               │    })                                │
│                               │                                      │
│                               │ STRIPE CHARGE POINT ← atomic in     │
│                               │ Stripe: if charge fails, sub reverts │
│                               │                                      │
│                               │ 3. syncLocalSubscriptionFromStripe() │
│                               │    (optimistic -- webhook will       │
│                               │     also fire and converge)          │
│                               │                                      │
│                               │ 4. grantUpgradeProRataCredits()      │
│                               │    (optimistic -- webhook is the     │
│                               │     authoritative backup)            │
│                               │                                      │
│  Show success toast       ←──┘ Return { success, creditsGranted }    │
│                                                                      │
│  STATUS: Stripe is source of truth. Local DB is optimistic.          │
└──────────────────────────────────────────────────────────────────────┘
         │
         │ Stripe fires webhooks (within seconds, possibly minutes)
         ↓
┌──────────────────────────────────────────────────────────────────────┐
│  PHASE 3: CONVERGENCE (webhook-driven, authoritative)                │
│                                                                      │
│  Stripe Webhook                  Convex Handlers                     │
│  ──────────────                  ───────────────                     │
│  customer.subscription.updated   handleSubscriptionWebhook           │
│    ──→ Re-fetch from Stripe API ──→ syncSubscription mutation        │
│         (converges plan/status to match Stripe)                      │
│                                                                      │
│  invoice.paid (proration invoice)                                    │
│    ──→ processInvoiceForGrantNonBlocking                             │
│         ──→ NEW: detectUpgradeProrationInvoice()                     │
│              If this invoice is for a plan upgrade proration:        │
│              ──→ grantUpgradeProRataCredits (idempotent, deduped)    │
│                                                                      │
│  STATUS: Even if action's Step 4 failed, webhook catches it.         │
└──────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture

**Problem:** The action's credit grant (Step 4) can fail after Stripe charges the user.

**Solution:** Make the webhook `invoice.paid` handler ALSO trigger upgrade credit grants. Since `grantUpgradeProRataCredits` is already idempotent (deduped by `grantType + fromPlan + toPlan + period`), calling it from both the action and the webhook is safe.

**Result:** Credits are granted in the happy path immediately (action), and in the failure path eventually (webhook, within minutes). The user never permanently loses credits.

## Component Responsibilities

| Component | Responsibility | New vs Modified |
|-----------|---------------|-----------------|
| `Pricing.tsx` | Preview flow orchestration, confirmation dialog | **Modified** -- wire up preview fetch on upgrade click, open dialog |
| `upgrade-confirmation-dialog.tsx` | Display proration preview, collect confirmation | **Modified** -- already exists, needs refinement |
| `getUpgradePreview` action | Fetch proration preview from Stripe, calculate pro-rata credits | **Existing** -- already implemented, may need minor fixes |
| `changePlan` action | Execute upgrade via Stripe API, optimistic local sync + credit grant | **Modified** -- add metadata to Stripe subscription for webhook detection |
| `grantUpgradeProRataCredits` mutation | Idempotent pro-rata credit grant with dedup | **Existing** -- already implemented, already idempotent |
| `invoice.paid` webhook handler | Detect proration invoices and trigger credit grants | **Modified** -- add upgrade proration invoice detection |
| `processInvoiceForGrant` action | Inspect invoice to decide grant type | **Modified** -- add upgrade proration classification |

## Data Flow: Preview

```
Client                    Action                         Stripe API
  │                         │                               │
  │ getUpgradePreview({     │                               │
  │   targetPriceId         │                               │
  │ })                      │                               │
  │────────────────────────→│                               │
  │                         │ subscriptions.retrieve()      │
  │                         │──────────────────────────────→│
  │                         │←──────────────────────────────│
  │                         │                               │
  │                         │ invoices.createPreview({      │
  │                         │   subscription_details: {     │
  │                         │     items: [new price],       │
  │                         │     proration_behavior:       │
  │                         │       "always_invoice",       │
  │                         │     proration_date: now       │
  │                         │   }                           │
  │                         │ })                            │
  │                         │──────────────────────────────→│
  │                         │←──────────────────────────────│
  │                         │                               │
  │ {                       │                               │
  │   prorationAmountCents, │                               │
  │   immediateChargeCents, │                               │
  │   proRataCredits,       │                               │
  │   remainingDays,        │                               │
  │   currentPlan,          │                               │
  │   targetPlan            │                               │
  │ }                       │                               │
  │←────────────────────────│                               │
```

## Data Flow: Execute Upgrade

```
Client              Action                  Stripe API            Webhook Path
  │                   │                        │                      │
  │ changePlan({      │                        │                      │
  │  targetPriceId    │                        │                      │
  │ })                │                        │                      │
  │──────────────────→│                        │                      │
  │                   │                        │                      │
  │                   │ subscriptions.update({ │                      │
  │                   │   items: [new price],  │                      │
  │                   │   proration_behavior:  │                      │
  │                   │     "always_invoice",  │                      │
  │                   │   payment_behavior:    │                      │
  │                   │     "error_if_incomplete",                    │
  │                   │   metadata: {          │                      │
  │                   │     upgradeFromPlan,   │                      │
  │                   │     upgradeToPlan,     │                      │
  │                   │     upgradeTimestamp   │                      │
  │                   │   }                    │                      │
  │                   │ })                     │                      │
  │                   │───────────────────────→│                      │
  │                   │                        │                      │
  │                   │ (if charge fails)      │                      │
  │                   │←── 402 error ──────────│                      │
  │←─ BILLING_CHARGE_ │                        │                      │
  │   FAILED error    │                        │                      │
  │                   │                        │                      │
  │                   │ (if charge succeeds)   │                      │
  │                   │←── updated sub ────────│                      │
  │                   │                        │                      │
  │                   │ syncSubscription()     │                      │
  │                   │ (mutation - plan sync) │                      │
  │                   │                        │                      │
  │                   │ grantUpgradeProRata()  │                      │
  │                   │ (mutation - credits)   │                      │
  │                   │                        │                      │
  │←─ { success: true,│                        │                      │
  │     creditsGranted│                        │                      │
  │   }               │                        │                      │
  │                   │                        │                      │
  │                   │                        │ Fires webhooks:      │
  │                   │                        │──────────────────────→│
  │                   │                        │ subscription.updated │
  │                   │                        │ invoice.paid         │
  │                   │                        │                      │
  │                   │                        │  Webhook handlers:   │
  │                   │                        │  - syncSubscription  │
  │                   │                        │    (converges, noop  │
  │                   │                        │     if already synced│
  │                   │                        │  - grantUpgradeProRata
  │                   │                        │    (idempotent, noop │
  │                   │                        │     if already       │
  │                   │                        │     granted)         │
```

## Architectural Patterns

### Pattern 1: Optimistic Action + Authoritative Webhook (Dual-Path Convergence)

**What:** The action performs an optimistic write (credit grant) for fast user feedback, while the webhook provides an authoritative backup that converges to the correct state regardless of action failures.

**When to use:** Whenever a Convex action calls an external API (Stripe) and needs to update local state based on the result, but the action's local writes can fail independently.

**Trade-offs:**
- PRO: User sees credits immediately if action succeeds
- PRO: Credits are never permanently lost even if action fails
- PRO: No new infrastructure needed (existing webhook handlers + idempotent mutations)
- CON: Brief window (seconds to minutes) where credits might not appear if action fails before webhook arrives
- CON: Must ensure idempotency in the grant mutation (already done)

**Implementation in this codebase:**

```typescript
// In changePlan action (optimistic path):
try {
  const grantResult = await ctx.runMutation(
    internalApi.credits.internal.grantUpgradeProRataCredits,
    { userId, fromPlan, toPlan, currentPeriodStartMs, currentPeriodEndMs, stripeSubscriptionId }
  );
  creditsGranted = grantResult.grantedCredits;
} catch (err) {
  // Non-fatal: webhook will catch this
  console.error("[changePlan] Pro-rata credit grant failed (non-fatal)", { ... });
}

// In invoice.paid webhook handler (authoritative path):
// Detect that this invoice is a proration invoice for an upgrade
// and trigger the same idempotent grant mutation
```

### Pattern 2: Stripe Metadata as Cross-System State Transfer

**What:** Write upgrade context (fromPlan, toPlan, timestamp) into Stripe subscription metadata during the `subscriptions.update()` call, so that webhook handlers can read it back without needing to re-derive the upgrade direction.

**When to use:** When the webhook handler needs context about the user's intent that is not available in the event payload alone.

**Trade-offs:**
- PRO: Webhook handler knows the exact fromPlan/toPlan without querying local DB history
- PRO: Metadata survives action failures (it is persisted in Stripe)
- CON: Metadata must be cleared after processing to avoid stale state
- CON: Metadata is limited to string key-value pairs

**Implementation:**

```typescript
// In changePlan action:
const updated = await stripe.subscriptions.update(stripeSubscription.id, {
  items: [{ id: item.id, price: args.targetPriceId }],
  proration_behavior: "always_invoice",
  payment_behavior: "error_if_incomplete",
  metadata: {
    ...clearPendingPlanMetadata(stripeSubscription.metadata),
    upgradeFromPlan: currentPlan,
    upgradeToPlan: targetPlan,
    upgradeTimestamp: String(Date.now()),
  },
});

// In invoice.paid webhook handler:
// Read metadata.upgradeFromPlan/upgradeToPlan from the subscription
// to determine if this is a proration invoice that needs credit grants
```

### Pattern 3: Invoice Classification for Grant Routing

**What:** When `invoice.paid` fires, classify the invoice to determine what kind of credit grant (if any) it triggers. The existing `classifyMonthlyCreditInvoice` handles recurring subscription invoices. A new classifier handles proration invoices from upgrades.

**When to use:** Always, in the invoice.paid handler, to route different invoice types to different grant logic.

**Trade-offs:**
- PRO: Single entry point for all credit grants (invoice.paid webhook)
- PRO: Each grant type has its own idempotency mechanism
- CON: Must correctly classify proration invoices vs. recurring invoices vs. one-time charges

**Classification logic:**

```
Invoice arrives at invoice.paid handler
  │
  ├─ billing_reason === "subscription_cycle"
  │    → Monthly credit grant (existing: grantMonthlyCredits)
  │
  ├─ billing_reason === "subscription_update"
  │    AND subscription.metadata.upgradeFromPlan exists
  │    AND subscription.metadata.upgradeToPlan exists
  │    → Upgrade pro-rata credit grant (grantUpgradeProRataCredits)
  │
  ├─ billing_reason === "subscription_create"
  │    → Initial subscription credit grant (existing path via reconciliation)
  │
  └─ Other
       → No credit grant action needed
```

## Anti-Patterns

### Anti-Pattern 1: Credit Grants Only in the Action

**What people do:** Call `grantUpgradeProRataCredits` only from the `changePlan` action, with no webhook backup path.

**Why it is wrong:** The action is NOT transactional across multiple `ctx.runMutation` calls. If the Stripe charge succeeds (Step 1) and the local sync succeeds (Step 2) but the credit grant fails (Step 3), the user loses credits permanently. The current `console.error` log is the only evidence. There is no automated recovery, no retry, and no alert.

**Do this instead:** Keep the optimistic grant in the action for fast UX, but ALSO trigger the same idempotent grant from the `invoice.paid` webhook. The webhook serves as a durable, automatically-retried convergence path.

### Anti-Pattern 2: Rolling Back Stripe on Credit Grant Failure

**What people do:** If `grantUpgradeProRataCredits` fails, attempt to reverse the Stripe subscription update (downgrade back to old plan).

**Why it is wrong:** Rolling back a successful Stripe charge introduces MORE failure modes (refund fails, double-charge, subscription in limbo). The user already authorized the upgrade and payment succeeded. Reversing it is confusing and potentially creates billing disputes.

**Do this instead:** Let the upgrade stand. Use webhook-driven retry to eventually grant the credits. Alert on persistent failures.

### Anti-Pattern 3: Using `pending_if_incomplete` for Upgrades

**What people do:** Use `payment_behavior: "pending_if_incomplete"` to avoid hard failures on charge attempts.

**Why it is wrong:** With `pending_if_incomplete`, a failed charge leaves the subscription in a "pending update" state -- the price change is not applied, but the subscription object contains a `pending_update` hash. This is confusing to handle: you need to poll or wait for the customer to complete payment, and the local DB may show stale data for an indeterminate period.

**Do this instead:** Use `payment_behavior: "error_if_incomplete"`. This ensures the Stripe charge is atomic: either the charge succeeds and the subscription updates, or the charge fails and nothing changes. The action can surface a clear "card declined" error to the user.

## Integration Points: New vs Modified

### New Components

| Component | Purpose | Location |
|-----------|---------|----------|
| Upgrade proration invoice classifier | Detect `billing_reason === "subscription_update"` + upgrade metadata in invoice.paid handler | `convex/credits/lib/invoiceGrantPolicy.ts` (extend existing) |

### Modified Components

| Component | Change | Risk |
|-----------|--------|------|
| `convex/subscriptions/actions.ts` :: `changePlan` | Add upgrade metadata to Stripe subscription during `subscriptions.update()`. Clear metadata after successful processing. | LOW -- metadata is additive, does not change charge behavior |
| `convex/http.ts` :: `invoice.paid` handler | After processing monthly grants, also check for upgrade proration invoices and trigger `grantUpgradeProRataCredits` | LOW -- new code path, existing paths unchanged. Idempotent mutation prevents double-grants. |
| `convex/credits/internal.ts` :: `grantUpgradeProRataCredits` | No changes needed. Already idempotent by `grantType + fromPlan + toPlan + period`. | NONE |
| `convex/credits/actions.ts` :: `processInvoiceForGrant` | Add classification branch for upgrade proration invoices | MEDIUM -- must correctly identify proration invoices to avoid granting credits on non-upgrade invoices |
| `components/Pricing.tsx` | Already wired up for preview + dialog. May need error state refinements. | LOW |
| `components/billing/upgrade-confirmation-dialog.tsx` | Already implemented. May need minor UX polish. | LOW |

### Unchanged Components

| Component | Why Unchanged |
|-----------|--------------|
| `getUpgradePreview` action | Already correctly uses `invoices.createPreview`. Works as-is. |
| `syncSubscription` mutation | Already converges local state from Stripe. Webhook path already calls this. |
| `handleSubscriptionWebhook` internal action | Already re-fetches from Stripe API and syncs. No credit logic needed here. |
| Schema (creditTransactions) | Already has all needed fields: `metadata.grantType`, `userId` index for dedup queries. |

## Build Order (Dependency-Aware)

### Step 1: Add Stripe Metadata to Upgrade Path

**What:** In `changePlan`, write `upgradeFromPlan`, `upgradeToPlan`, `upgradeTimestamp` into Stripe subscription metadata during `subscriptions.update()`.

**Why first:** This is the data contract that the webhook handler will depend on. Must be deployed before the webhook handler can detect upgrades.

**Files:** `convex/subscriptions/actions.ts`

**Risk:** LOW -- purely additive metadata. Does not affect charge behavior or existing webhook handlers.

### Step 2: Extend Invoice Classification

**What:** Add a classification function that detects proration invoices from upgrades by checking `billing_reason === "subscription_update"` AND the presence of upgrade metadata on the associated subscription.

**Files:** `convex/credits/lib/invoiceGrantPolicy.ts` (extend), `convex/credits/actions.ts` (extend `processInvoiceForGrant`)

**Why second:** Depends on Step 1 (metadata must be present in Stripe for classification to work).

**Risk:** MEDIUM -- must not misclassify existing invoice types. Requires careful testing.

### Step 3: Wire Webhook Handler

**What:** In the `invoice.paid` webhook handler, after existing monthly-grant processing, call the extended `processInvoiceForGrant` which now handles upgrade proration invoices.

**Files:** `convex/http.ts` (minor), `convex/credits/actions.ts` (already extended in Step 2)

**Why third:** Depends on Steps 1 and 2.

**Risk:** LOW -- additive code path. Existing invoice.paid handling is unchanged. New path is gated by invoice classification.

### Step 4: Verify Idempotency End-to-End

**What:** Test that when both the action's optimistic grant AND the webhook's authoritative grant fire, the user receives credits exactly once.

**Test scenario:**
1. Trigger upgrade via action (credits granted optimistically)
2. Webhook fires invoice.paid with the proration invoice
3. Webhook handler classifies it as upgrade proration
4. Calls `grantUpgradeProRataCredits` -- should return `already_granted`
5. Verify: credit balance unchanged after webhook (no double-grant)

**Files:** Test files only

### Step 5: UX Polish (if needed)

**What:** Refine the confirmation dialog, error messages, loading states, and success toasts.

**Files:** `components/Pricing.tsx`, `components/billing/upgrade-confirmation-dialog.tsx`

**Why last:** Functional correctness (Steps 1-4) before cosmetic refinements.

## Key Decision: Should Credit Grants Happen in the Action or Be Triggered by Webhooks?

**Answer: BOTH.** Use the dual-path convergence pattern:

1. **Action path (optimistic):** Grant credits immediately in the `changePlan` action after the Stripe charge succeeds. This gives the user instant feedback. If it fails, log the error and continue -- the webhook will catch it.

2. **Webhook path (authoritative):** When `invoice.paid` fires for a proration invoice, classify it as an upgrade and trigger the same idempotent grant mutation. This catches cases where the action's grant failed.

3. **Idempotency layer:** The `grantUpgradeProRataCredits` mutation deduplicates by `grantType + fromPlan + toPlan + currentPeriodStartMs`. Whether called once (action only), once (webhook only), or twice (both), the result is the same: exactly one credit grant.

## Key Decision: How to Handle the Atomicity Problem

**Answer: Accept partial success and converge.**

Convex actions are explicitly non-transactional across multiple mutation calls. The correct response is NOT to try to make them transactional (impossible) or to roll back on failure (dangerous). Instead:

1. **Stripe `error_if_incomplete`** ensures the charge itself is atomic -- either the subscription updates and charge succeeds, or nothing happens.
2. **Optimistic local sync** in the action provides fast UX. If it fails, the webhook converges within minutes.
3. **Optimistic credit grant** in the action provides instant credits. If it fails, the webhook-driven grant converges.
4. **No operation leaves the user in a permanently broken state.** The worst case is a brief delay (webhook latency) before credits appear.

## Key Decision: Preview -> Confirm -> Execute Architecture in Convex

**Answer: Three separate action calls from the client.**

```
1. getUpgradePreview (action)   → Read-only. No side effects. Safe to call multiple times.
2. User reviews dialog          → Client-side only. No backend calls.
3. changePlan (action)          → Mutating. Calls Stripe API + local mutations.
```

This is the correct pattern for Convex because:
- **Actions cannot hold state between calls.** There is no "session" or "transaction" that spans preview and execute.
- **The preview data may be slightly stale** by the time the user confirms (proration amounts can shift by cents). This is acceptable and matches Stripe's own documentation: "prorated amounts might change between the time they are previewed and the time the update is made."
- **The client holds the preview state** in React state (`upgradePreview`), which is appropriate for ephemeral UI data.

## Scaling Considerations

| Scale | Concern | Approach |
|-------|---------|---------|
| Current (low volume) | Webhook latency for credit convergence | Acceptable -- seconds to minutes |
| 1K+ upgrades/day | Webhook ordering and dedup load | Already handled -- idempotent mutations + `stripeEventLogs` table |
| 10K+ upgrades/day | Invoice classification overhead | Monitor -- `processInvoiceForGrant` makes one Stripe API call per invoice. Add caching if needed. |

## Sources

- [Convex Actions Documentation](https://docs.convex.dev/functions/actions) -- Actions are NOT transactional, cannot be auto-retried
- [Convex OCC and Atomicity](https://docs.convex.dev/database/advanced/occ) -- Mutations ARE transactional with OCC
- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- Preview + execute flow, `always_invoice` behavior
- [Stripe Subscription Update API](https://docs.stripe.com/api/subscriptions/update) -- `error_if_incomplete` behavior
- [Stripe Pending Updates](https://docs.stripe.com/billing/subscriptions/pending-updates) -- Why `pending_if_incomplete` is NOT recommended here
- [Convex + Stripe Integration Guide](https://stack.convex.dev/stripe-with-convex) -- Mutation-first pattern for durable workflows
- [Convex Action Retry Patterns](https://stack.convex.dev/retry-actions) -- Scheduler-based retry for idempotent actions
- Direct codebase analysis of `convex/subscriptions/actions.ts`, `convex/credits/internal.ts`, `convex/http.ts`

---
*Architecture research for: Upgrade flow with proration preview in Convex + Stripe*
*Researched: 2026-02-27*
