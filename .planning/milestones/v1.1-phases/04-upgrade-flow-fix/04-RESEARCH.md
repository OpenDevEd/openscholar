# Phase 4: Upgrade Correctness - Research

**Researched:** 2026-02-27
**Domain:** Stripe proration date pinning, credit grant failure handling, toast accuracy in Convex + Next.js
**Confidence:** HIGH

## Summary

Phase 4 fixes four correctness bugs in the existing upgrade flow. The code already works end-to-end (preview dialog, changePlan action, credit grant mutation, toast) but has specific defects: (1) proration_date is computed independently in preview and execution, causing amount drift; (2) when the credit grant fails after a successful plan change, the UI shows a fake credit count from the preview estimate instead of acknowledging the failure; (3) the success toast falls back to the preview estimate when the server returns 0 credits; (4) the changePlan response returns `undefined` for creditsGranted on failure instead of an explicit `0`.

All four bugs are localized to three files: `convex/subscriptions/actions.ts` (server), `components/Pricing.tsx` (client toast logic), and `messages/*.json` (i18n keys). No new libraries, no schema changes, no new API endpoints. The fixes are small, surgical edits to existing code paths.

**Primary recommendation:** Pin `proration_date` at preview time, thread it through `changePlan`, fix the `creditsGranted` return to always be a number (never undefined), and branch the toast on `creditsGranted === 0` vs `creditsGranted > 0`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Credits granted (happy path):** Toast shows actual credits from server response -- e.g. "Upgraded to Pro -- 1,234 credits added". Never use the preview estimate.
- **Credits processing (grant failed but plan changed):** Toast shows "Upgraded to Pro -- credits are being processed" with an info-level tone (not error). No fake credit count.
- **Complete failure (Stripe charge failed):** Error toast with actionable message -- e.g. "Upgrade failed -- your card was declined. Update your payment method and try again."
- Toast duration: success/processing = 5s auto-dismiss, error = persistent until dismissed
- Show the real current balance (not an estimate) -- the credit display should never show a number that hasn't been confirmed by the server
- No special "processing" indicator in the credit balance itself; the toast is sufficient to communicate the state
- Pin the proration_date at preview time and pass it through to the changePlan execution so Stripe uses the same timestamp for both
- Store the pinned timestamp alongside the preview data in the dialog state
- No user-facing disclaimer needed -- the pinning eliminates the drift problem entirely
- No preview expiration timeout -- the pinned date ensures correctness regardless of how long the user takes
- Card declined: error toast with "Update your payment method" guidance, dialog closes, user can retry
- Generic Stripe error: error toast with "Please try again" message, dialog closes
- No automatic retry -- user manually retries by clicking upgrade again
- Dialog returns to non-confirming state on error so the user can dismiss or retry

### Claude's Discretion
- Exact toast copy and i18n key naming
- Whether to log credit processing events to console for debugging
- Internal error boundary patterns for the changePlan response handling

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPGC-01 | User sees exact charge amount in preview that matches what Stripe charges (proration_date pinned between preview and execution) | Stripe SDK v20.3.0 confirms `proration_date` parameter on `subscriptions.update()` is designed for exactly this: "can be used to apply exactly the same prorations that were previewed with the create preview endpoint". Pin timestamp in `getUpgradePreview`, pass to `changePlan` as new arg, forward to `stripe.subscriptions.update()`. See "Pattern 1" and "Code Example 1". |
| UPGC-02 | User sees "credits are being processed" message when credit grant fails after successful plan change, not a fake success count | The `changePlan` action's catch block currently sets `creditsGranted` to `undefined`. Fix: set to explicit `0`. Client branches on `creditsGranted === 0` to show info toast instead of success toast. See "Pattern 2" and "Code Example 2". |
| UPGC-03 | User sees actual credits granted in success toast, derived from server response, not the preview estimate | Line 328 of `Pricing.tsx`: `const creditsGranted = result.creditsGranted || upgradePreview.proRataCredits` -- the `||` operator falls back to preview when server returns `0` or `undefined`. Fix: use server value directly. See "Code Example 3". |
| UPGC-04 | changePlan response returns explicit `creditsGranted: 0` on grant failure, not `undefined` | The return type declares `creditsGranted: v.optional(v.number())`. Change to `v.number()` (non-optional) and ensure the catch block returns `creditsGranted: 0`. See "Code Example 4". |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | ^20.3.0 | Stripe SDK for proration preview + subscription update | Already installed; `proration_date` param confirmed in SDK types |
| convex | (project version) | Backend runtime for actions/mutations | Existing stack; no changes needed |
| sonner | (project version) | Toast notifications with `toast.success()` and `toast()` (info) | Already used in `Pricing.tsx` for upgrade toasts |
| next-intl | (project version) | i18n for toast messages | Already used; new keys needed for processing/error toasts |

### Supporting
No new libraries needed. All changes use existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pinning proration_date | Re-fetching preview on confirm | User decision: pinning is correct; eliminates drift entirely without re-fetch latency |
| sonner toast.info() for processing state | Custom "pending" UI component | Decision: toast is sufficient; no persistent banner needed per user decision |

**Installation:**
No new packages to install.

## Architecture Patterns

### Recommended Project Structure
No structural changes. All edits are to existing files:
```
convex/subscriptions/actions.ts    # changePlan + getUpgradePreview
components/Pricing.tsx             # handleConfirmUpgrade toast logic
components/billing/upgrade-confirmation-dialog.tsx  # (minor: store pinned date)
messages/en-US.json (+ other locales)              # new i18n keys
```

### Pattern 1: Proration Date Pinning (UPGC-01)

**What:** Capture `proration_date` during preview, store it in client state, pass it to the execution call so Stripe uses the identical timestamp for both the preview and the actual charge.

**When to use:** Whenever Stripe's `invoices.createPreview()` is followed by `subscriptions.update()` and the user expects the previewed amount to match the charged amount.

**How it works in this codebase:**

1. `getUpgradePreview` already computes `proration_date: Math.floor(Date.now() / 1000)` at line 900 of `actions.ts`
2. **New:** Return this timestamp to the client as `prorationDate` in the preview response
3. **Client stores** it alongside the preview in `upgradePreview` state (already stores `targetPriceId` -- add `prorationDate`)
4. **New:** `changePlan` accepts optional `prorationDate` arg
5. **New:** `stripe.subscriptions.update()` receives `proration_date: args.prorationDate` instead of computing a fresh timestamp

**Stripe SDK confirmation (HIGH confidence):**
From `node_modules/stripe/types/SubscriptionsResource.d.ts` line 1143-1145:
> "If set, prorations will be calculated as though the subscription was updated at the given time. This can be used to apply exactly the same prorations that were previewed with the create preview endpoint."

### Pattern 2: Tri-State Toast (UPGC-02, UPGC-03)

**What:** Branch the post-upgrade toast into three states based on the `changePlan` response:
- `creditsGranted > 0` -- success toast with actual credit count
- `creditsGranted === 0` -- info toast with "credits are being processed"
- Action threw (catch block) -- error toast with card declined / generic error message

**When to use:** Whenever a multi-step backend operation (charge + credit grant) can partially succeed.

**Implementation:**
```
changePlan result
  |
  +-- threw exception (catch block)
  |     -> error toast (existing: toast.billing.checkoutFailed)
  |     -> dialog stays closeable, user can retry
  |
  +-- success: true, creditsGranted > 0
  |     -> sonnerToast.success("Upgraded to Pro -- 1,234 credits added")
  |     -> 5s auto-dismiss
  |
  +-- success: true, creditsGranted === 0
        -> sonnerToast("Upgraded to Pro -- credits are being processed")
        -> info-level tone (not error, not success)
        -> 5s auto-dismiss
```

### Pattern 3: Explicit Zero vs Undefined (UPGC-04)

**What:** Make the `creditsGranted` field non-optional in the `changePlan` return type, defaulting to `0` when the credit grant fails or is skipped.

**When to use:** Whenever a client needs to distinguish between "operation succeeded with zero result" and "operation was skipped/failed."

**Anti-Patterns to Avoid:**
- **Using `||` for numeric fallback:** `result.creditsGranted || fallback` treats `0` as falsy and falls back incorrectly. Use strict comparison `=== 0` or nullish coalescing `??`.
- **Using preview estimate as fallback:** The preview is a point-in-time estimate that may not match the actual grant (cap applied, rounding, period shift). Never show it as the "actual" result.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proration date synchronization | Custom timestamp caching or preview refresh on confirm | Stripe's built-in `proration_date` parameter | Stripe designed this parameter specifically for preview-to-execution consistency |
| Toast duration management | Manual setTimeout / dismiss logic | Sonner's built-in `duration` option | Already used in the project; sonner handles auto-dismiss natively |
| Error classification (card declined vs generic) | Custom error parsing from Stripe messages | Existing `createError` + `StripeCardError` instance check | Already implemented in `changePlan` catch block -- reuse the existing pattern |

**Key insight:** All four fixes are about correctness of existing code, not about building new capabilities. The infrastructure (preview action, changePlan action, toast system, i18n) all exist. The bugs are in how data flows between them.

## Common Pitfalls

### Pitfall 1: The `||` Operator Treats Zero as Falsy
**What goes wrong:** Line 328 of `Pricing.tsx`: `const creditsGranted = result.creditsGranted || upgradePreview.proRataCredits`. When the server returns `creditsGranted: 0` (grant failed), `0 || preview` evaluates to the preview estimate. The toast shows fake credits.
**Why it happens:** JavaScript's `||` returns the right operand when the left is falsy (0, undefined, null, "").
**How to avoid:** Use the server value directly: `result.creditsGranted`. Branch on `=== 0` for the processing toast. Do NOT use `??` with a preview fallback either.
**Warning signs:** Any toast showing credits that match the preview exactly, especially after a slow upgrade.

### Pitfall 2: Proration Date Computed Twice Independently
**What goes wrong:** `getUpgradePreview` uses `Math.floor(Date.now() / 1000)` at preview time. `changePlan` does NOT pass a `proration_date` to `stripe.subscriptions.update()`, so Stripe uses execution time. The amounts differ by seconds-to-minutes of drift.
**Why it happens:** The two actions run in separate HTTP requests minutes apart.
**How to avoid:** Capture the timestamp once (in preview), return it to the client, pass it to changePlan.
**Warning signs:** `preview.immediateChargeCents` differs from actual Stripe charge by small amounts (cents to dollars depending on remaining time in period).

### Pitfall 3: Forgetting to Update the Return Type Validator
**What goes wrong:** The `changePlan` action has both a TypeScript return type AND a Convex `returns` validator. If you change `creditsGranted` from optional to required in TypeScript but forget to update the validator (or vice versa), the action will throw at runtime.
**Why it happens:** Convex validates return values at runtime using the `returns` schema. TypeScript types are erased at runtime.
**How to avoid:** Update both the `returns: v.object({...})` validator AND the TypeScript `Promise<{...}>` type annotation. Verify by checking that `v.optional(v.number())` changes to `v.number()`.
**Warning signs:** Runtime error like "Validator error: Expected number, got undefined" after deploying.

### Pitfall 4: Card Declined Error Must Not Show Processing Toast
**What goes wrong:** If the Stripe charge fails (card declined), `changePlan` throws a ConvexError. The catch block in `handleConfirmUpgrade` must show an error toast, not a processing toast. If the error handling order is wrong, the catch might fall through to a "credits are being processed" state.
**Why it happens:** Incorrect branching in the try/catch/finally flow.
**How to avoid:** The catch block handles ALL thrown errors (charge failed = exception). The success/processing branch only runs in the try block after `changePlan` returns successfully.
**Warning signs:** Seeing "credits are being processed" when the charge actually failed.

### Pitfall 5: Non-Upgrade changePlan Paths Must Return creditsGranted: 0
**What goes wrong:** `changePlan` has multiple code paths: `no_change`, `pending_change_cleared`, `upgraded_immediately`, and `downgrade_scheduled`. Only `upgraded_immediately` grants credits. If you make `creditsGranted` non-optional, the other paths must explicitly return `creditsGranted: 0`.
**Why it happens:** Adding a required field to the return type without checking all return statements.
**How to avoid:** Search for every `return {` in the `changePlan` handler and ensure `creditsGranted: 0` or `creditsGranted: actualValue` is present.
**Warning signs:** Convex runtime error "Validator error: Expected number, got undefined" on downgrade or no_change paths.

## Code Examples

### Code Example 1: Proration Date Pinning (UPGC-01)

**In `getUpgradePreview` -- return the pinned date:**
```typescript
// convex/subscriptions/actions.ts :: getUpgradePreview
const prorationDate = Math.floor(Date.now() / 1000);  // already exists at line 900

const preview = await stripe.invoices.createPreview({
  // ... existing params ...
  subscription_details: {
    items: [{ id: item.id, price: args.targetPriceId }],
    proration_behavior: "always_invoice",
    proration_date: prorationDate,  // use named variable
  },
});

return {
  // ... existing fields ...
  prorationDate,  // NEW: return to client
};
```

**In `changePlan` -- accept and forward the pinned date:**
```typescript
// convex/subscriptions/actions.ts :: changePlan
export const changePlan = action({
  args: {
    targetPriceId: v.string(),
    prorationDate: v.optional(v.number()),  // NEW: optional for backward compat
  },
  // ...
  handler: async (ctx, args) => {
    // ... in upgraded_immediately branch:
    const updated = await stripe.subscriptions.update(stripeSubscription.id, {
      items: [{ id: item.id, price: args.targetPriceId, quantity: item.quantity ?? 1 }],
      proration_behavior: "always_invoice",
      proration_date: args.prorationDate,  // NEW: pin to preview timestamp
      payment_behavior: "error_if_incomplete",
      cancel_at_period_end: false,
      metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
    });
    // ...
  },
});
```

**In client -- pass pinned date to changePlan:**
```typescript
// components/Pricing.tsx :: handleConfirmUpgrade
const result = await changePlan({
  targetPriceId: upgradePreview.targetPriceId,
  prorationDate: upgradePreview.prorationDate,  // NEW: forward pinned date
});
```

### Code Example 2: Tri-State Toast (UPGC-02, UPGC-03)

```typescript
// components/Pricing.tsx :: handleConfirmUpgrade (replacement for lines 328-334)
setIsUpgradeDialogOpen(false);
setUpgradePreview(null);

if (result.creditsGranted > 0) {
  // Happy path: credits granted immediately
  sonnerToast.success(td("upgradeSuccess"), {
    description: td("upgradeSuccessCredits", {
      plan: upgradePreview.targetPlan,
      credits: result.creditsGranted.toLocaleString(),
    }),
    duration: 5000,
  });
} else {
  // Grant failed or zero: credits are being processed
  sonnerToast(td("upgradeSuccess"), {
    description: td("upgradeProcessingCredits", {
      plan: upgradePreview.targetPlan,
    }),
    duration: 5000,
  });
}
```

Note: `sonnerToast()` (no method) renders an info-level toast in sonner, which matches the user decision for "info-level tone (not error)."

### Code Example 3: Fix the Falsy Fallback (UPGC-03)

**Before (buggy):**
```typescript
const creditsGranted = result.creditsGranted || upgradePreview.proRataCredits;
```

**After (correct):**
```typescript
// No fallback needed -- server value is authoritative
// Branch on the value directly:
if (result.creditsGranted > 0) { /* success toast */ }
else { /* processing toast */ }
```

### Code Example 4: Explicit creditsGranted: 0 (UPGC-04)

**In `changePlan` return validator:**
```typescript
// Before:
creditsGranted: v.optional(v.number()),

// After:
creditsGranted: v.number(),
```

**In `changePlan` catch block for credit grant failure:**
```typescript
// Before:
} catch (err) {
  console.error("[changePlan] Pro-rata credit grant failed (non-fatal)", { ... });
  // creditsGranted remains undefined
}

// After:
} catch (err) {
  console.error("[changePlan] Pro-rata credit grant failed (non-fatal)", { ... });
  creditsGranted = 0;  // Explicit zero
}
```

**In all non-upgrade return paths:**
```typescript
// no_change path:
return { success: true, mode: "updated", changeType, message: "...", creditsGranted: 0 };

// pending_change_cleared path:
return { success: true, mode: "updated", changeType, message: "...", creditsGranted: 0 };

// downgrade_scheduled path:
return { success: true, mode: "scheduled", changeType, message: "...", effectiveDate: ..., creditsGranted: 0 };
```

### Code Example 5: New i18n Keys

```json
{
  "upgradeDialog": {
    "upgradeSuccess": "Upgrade successful",
    "upgradeSuccessCredits": "Upgraded to {plan} -- {credits} credits added",
    "upgradeProcessingCredits": "Upgraded to {plan} -- credits are being processed",
    "upgradeFailedCardDeclined": "Upgrade failed -- your card was declined. Update your payment method and try again.",
    "upgradeFailedGeneric": "Upgrade failed -- please try again."
  }
}
```

Note: The card declined error is already handled by the existing `createError("BILLING_CHARGE_FAILED", ...)` pattern routed through `toast.billing.checkoutFailed()`. The new i18n keys are for the success/processing toasts only.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `stripe.invoices.retrieveUpcoming()` | `stripe.invoices.createPreview()` | Stripe API 2022-08 | Already using new API -- no change needed |
| `creditsGranted: undefined` on failure | `creditsGranted: 0` (explicit) | This phase | Enables client to distinguish success from failure |
| Independent proration_date computation | Pinned proration_date flow-through | This phase | Eliminates preview-to-charge drift |

**Deprecated/outdated:**
- None relevant to this phase. All APIs and patterns are current.

## Open Questions

1. **Should `creditsGranted` initialization change from `let creditsGranted: number | undefined` to `let creditsGranted = 0`?**
   - What we know: Setting default to `0` and overwriting on success is cleaner than catching undefined.
   - What's unclear: Whether any downstream code relies on `undefined` to mean "not attempted."
   - Recommendation: Initialize to `0`. The return type change from optional to required makes this the natural pattern. No existing client code checks for `undefined` -- they all use the `||` fallback which we're removing anyway.

2. **Should toast duration be set explicitly or use sonner defaults?**
   - What we know: User decision specifies 5s for success/processing, persistent for error.
   - What's unclear: Current sonner default for `toast.success()` -- sonner defaults to 4000ms.
   - Recommendation: Set `duration: 5000` explicitly on success/processing toasts. For error toasts, the existing `showStyledToast("error", ...)` already uses `duration: 4000` -- but user wants persistent. This may need the error toast path to use `duration: Infinity` or omit duration (sonner's error default is longer). Verify sonner's error behavior.

3. **Should the `getUpgradePreview` return validator be updated?**
   - What we know: Adding `prorationDate: v.number()` to the return validator is needed.
   - What's unclear: Whether the `UpgradePreview` TypeScript type in `upgrade-confirmation-dialog.tsx` needs updating too (it does -- it must include `prorationDate`).
   - Recommendation: Update both the Convex validator and the client-side TypeScript type.

## Scope Boundary: Phase 4 vs Phase 5

Phase 4 focuses on correctness of the existing single-path upgrade flow. Specifically:
- **In scope:** Fix the four UPGC bugs. The `changePlan` action's try/catch for credit grant failure correctly returns `creditsGranted: 0` and the UI shows the processing toast.
- **Out of scope:** Adding the webhook backup path for credit grants (that is Phase 5: UPGR-01, UPGR-02, UPGR-03). Phase 4 does NOT add Stripe metadata for webhook detection.
- **Boundary:** After Phase 4, a credit grant failure still means the user waits for manual reconciliation. Phase 5 adds automatic recovery via webhooks.

## Files That Need Changes

| File | Change Summary | Risk |
|------|---------------|------|
| `convex/subscriptions/actions.ts` | (1) `getUpgradePreview`: return `prorationDate`. (2) `changePlan`: accept `prorationDate` arg, forward to `stripe.subscriptions.update()`, make `creditsGranted` non-optional, set to `0` in catch block, add `creditsGranted: 0` to all non-upgrade return paths. | LOW -- additive arg + return field changes |
| `components/Pricing.tsx` | (1) `handleConfirmUpgrade`: pass `prorationDate` to `changePlan`, replace `||` fallback with tri-state toast branch. (2) Store `prorationDate` in `upgradePreview` state. | LOW -- localized toast logic change |
| `components/billing/upgrade-confirmation-dialog.tsx` | Add `prorationDate` to `UpgradePreview` type. | TRIVIAL -- type-only change |
| `messages/en-US.json` (+ 5 locales) | Add `upgradeSuccessCredits`, `upgradeProcessingCredits` keys. Possibly rename existing `upgradeSuccessDescription`. | LOW -- additive i18n keys |

## Sources

### Primary (HIGH confidence)
- Stripe SDK types (`node_modules/stripe/types/SubscriptionsResource.d.ts` line 1143-1145): `proration_date` parameter documentation confirming preview-to-execution pinning
- Direct codebase analysis: `convex/subscriptions/actions.ts` (changePlan lines 526-837, getUpgradePreview lines 843-930), `components/Pricing.tsx` (handleConfirmUpgrade lines 314-341), `components/billing/upgrade-confirmation-dialog.tsx`, `convex/credits/internal.ts` (grantUpgradeProRataCredits lines 823-955)
- `.planning/research/PITFALLS.md` -- Pitfalls 2 and 3 directly describe the bugs this phase fixes
- `.planning/research/ARCHITECTURE.md` -- Dual-path convergence architecture (Phase 5 dependency documented)

### Secondary (MEDIUM confidence)
- Sonner toast API: `toast()` renders info-level toast, `toast.success()` renders success toast. Verified by existing usage in `Pricing.tsx` line 329.
- Toast `duration` option: sonner supports `duration` in milliseconds. Default is 4000ms. Verified by `showStyledToast` usage in `sonner.tsx` line 121.

### Tertiary (LOW confidence)
- None. All findings verified from codebase and SDK types.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all changes to existing code
- Architecture: HIGH -- four localized bug fixes, no architectural changes
- Pitfalls: HIGH -- bugs are well-documented in existing research, fixes are straightforward

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- Stripe SDK and Convex patterns unlikely to change)
