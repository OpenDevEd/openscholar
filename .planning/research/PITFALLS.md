# Domain Pitfalls: v1.1 Upgrade Flow

**Domain:** Stripe upgrade proration + pro-rata credit grants in Convex + Next.js
**Researched:** 2026-02-27
**Confidence:** HIGH (verified against codebase, Stripe API docs, and tested patterns)

---

## Critical Pitfalls

Mistakes that cause incorrect charges, missing credits, or broken user state.

### Pitfall 1: Action-Webhook Race on Upgrade State

**What goes wrong:** The `changePlan` action calls `stripe.subscriptions.update()`, then immediately runs `syncLocalSubscriptionFromStripe()` and `grantUpgradeProRataCredits()`. Meanwhile, the `customer.subscription.updated` webhook fires asynchronously and calls `handleSubscriptionWebhook`, which re-fetches from Stripe and runs its own `syncLocalSubscriptionFromStripe()`. These two code paths race against each other:

1. Action calls `syncLocalSubscriptionFromStripe()` with the `updated` response object (new plan)
2. Webhook fires, action `handleSubscriptionWebhook` re-fetches from Stripe, calls `syncLocalSubscriptionFromStripe()` (same new plan)
3. If the webhook's action happens to run between the action's sync and the credit grant, the subscription data could be written twice

**Why it happens:** In Convex, actions are non-transactional. The `changePlan` action makes multiple sequential calls: a Stripe API call, then a mutation (sync), then another mutation (credit grant). The webhook handler is a completely separate execution path triggered by Stripe. There is no coordination between them.

**Consequences:** In the current code, both paths write the same correct data (because `handleSubscriptionWebhook` re-fetches from Stripe), so the sync race is benign. The real danger is if the webhook also triggered a credit grant -- which it does NOT in the current design because `subscription_update` invoices are classified as non-recurring by `invoiceGrantPolicy.ts`. However, the `invoice.paid` event for the proration invoice could arrive and trigger `processInvoiceForGrant`, which would correctly classify it as `ignored_non_recurring_reason`. If that classification were ever wrong, double-grants would occur.

**Prevention:**
- KEEP the `invoiceGrantPolicy.ts` guard that classifies `subscription_update` billing_reason as non-recurring -- this is the critical firewall
- The `changePlan` action's inline credit grant (`grantUpgradeProRataCredits`) is the single owner of upgrade credit grants -- do NOT add a webhook-driven upgrade credit grant path
- Add a comment/contract in `http.ts` documenting that upgrade credits are granted by the action, not by webhooks

**Detection:** Log when both the action and webhook write to the same subscription within 5 seconds (the `[WebhookDivergence]` log already partially covers this).

**Phase to address:** Phase 1 (Reliable upgrade flow) -- document the contract, add guard comments.

---

### Pitfall 2: Charge Succeeds But Credit Grant Fails (Partial Success)

**What goes wrong:** This is the KNOWN BROKEN STATE described in PROJECT.md. The `changePlan` action calls `stripe.subscriptions.update()` with `always_invoice` + `error_if_incomplete`. The Stripe charge succeeds, the plan changes in Stripe, and `syncLocalSubscriptionFromStripe` updates the local DB. Then `grantUpgradeProRataCredits` throws (e.g., Convex OCC conflict, credits record missing, invalid plan config). The user is charged and their plan changes, but they receive zero pro-rata credits.

**Why it happens:** The current code wraps the credit grant in a try/catch that logs the error but does NOT roll back the plan change:

```typescript
try {
  const grantResult = await ctx.runMutation(
    internalApi.credits.internal.grantUpgradeProRataCredits, { ... }
  );
  creditsGranted = grantResult.grantedCredits;
} catch (err) {
  // Plan change already succeeded -- don't roll it back for a credit grant failure
  console.error("[changePlan] Pro-rata credit grant failed (non-fatal)", { ... });
}
```

This is the correct error-handling philosophy (don't undo a successful charge), but the credits are silently lost. The user's success toast may even show `creditsGranted: 0` from the undefined fallback.

**Consequences:** User pays proration, sees "upgrade successful", but gets fewer credits than promised. Support ticket. Manual credit grant needed.

**Prevention:**
- On credit grant failure, schedule a retry via `ctx.scheduler.runAfter()` with exponential backoff (same pattern as `processInvoiceForGrantNonBlocking`)
- Store the pending grant attempt in a durable record (e.g., `stripeEventLogs` or a new `pendingUpgradeGrants` concept) so the reconciliation cron can pick it up
- Return `creditsGranted: undefined` to the UI explicitly, and show a different toast: "Upgrade complete. Credits will appear shortly." instead of claiming credits were granted when they were not
- Include the `stripeSubscriptionId` + `fromPlan` + `toPlan` in the scheduled retry args so the retry can reconstruct the grant

**Detection:** Monitor for `[changePlan] Pro-rata credit grant failed (non-fatal)` log lines. Alert on any occurrence.

**Phase to address:** Phase 1 (Reliable upgrade flow) -- this is the primary bug to fix.

---

### Pitfall 3: Preview-to-Execution Staleness (Amount Mismatch)

**What goes wrong:** `getUpgradePreview` calls `stripe.invoices.createPreview()` with `proration_date: Math.floor(Date.now() / 1000)`. The user reviews the dialog for 30 seconds to 5 minutes. Then `changePlan` calls `stripe.subscriptions.update()` WITHOUT passing a `proration_date`. Stripe calculates the actual proration using the current time at execution, which differs from the preview time. The charged amount differs from what was shown.

**Why it happens:** Stripe prorates to the second. If the preview runs at 14:00:00 and the actual update runs at 14:02:30, the remaining time in the period is 150 seconds shorter, producing a slightly different proration amount. The Stripe docs explicitly warn: "prorated amounts might change between the time they are previewed and the time the update is made."

**Consequences:**
- Small amounts: user is charged $14.23 instead of the previewed $14.25 -- minor discrepancy
- Large amounts or near-period-end: the difference can be significant (percentage grows as remaining time shrinks)
- Credit calculation also diverges: `getUpgradePreview` calculates `proRataCredits` using `Date.now()` at preview time, but `grantUpgradeProRataCredits` recalculates using `Date.now()` at execution time

**Prevention:**
- Store the `proration_date` from the preview and pass it to `stripe.subscriptions.update()` via the `proration_date` parameter
- Pass the same timestamp to `grantUpgradeProRataCredits` so the credit calculation matches the preview exactly
- Add a staleness check: if the preview is older than N minutes (e.g., 5), re-fetch before confirming
- Show "approximate" language in the dialog: "You will be charged approximately $14.25" or re-fetch the preview when the confirm button is clicked

**Detection:** Compare `preview.immediateChargeCents` with the actual `invoice.amount_due` from the webhook's `invoice.paid` event. Log discrepancies.

**Phase to address:** Phase 1 (Proration preview dialog) -- pass `proration_date` through the flow.

---

### Pitfall 4: Pro-Rata Credit Grant Double-Grant on Rapid Re-Upgrade

**What goes wrong:** User upgrades Go -> Pro, receives pro-rata credits. Then immediately (within seconds) goes to billing, sees they are on Pro, and clicks "Upgrade to Enterprise" (if such an option existed, or re-clicks before UI updates). The `grantUpgradeProRataCredits` dedup checks for an existing `upgrade_prorate` grant where `fromPlan === "go"` AND `toPlan === "pro"` in the current period. But the second upgrade is `fromPlan === "pro"` AND `toPlan === "enterprise"` -- different plan pair, so the dedup does NOT catch it. User receives two pro-rata grants in the same period, one for each upgrade step.

**Why it happens:** The dedup key is `(userId, fromPlan, toPlan, currentPeriodStart)`. Each upgrade step has a unique `(fromPlan, toPlan)` pair, so the dedup gate passes for each. This is CORRECT behavior for genuine multi-step upgrades (Go -> Pro -> Enterprise within one period should grant credits for each step). The pitfall is if the credit calculations overlap -- the first grant gives credits for `Pro - Go` remaining time, but the second grant calculates credits for `Enterprise - Pro` remaining time using the SAME period boundaries, which is correct.

**Assessment:** This is actually NOT a bug in the current implementation -- each upgrade step independently calculates the correct pro-rata delta. However, it becomes a pitfall if:
1. The first upgrade's credits have not been written yet (OCC retry) when the second upgrade reads the balance -- the second grant would see an artificially low `freeBalance`, potentially granting more than intended under the cap
2. The UI does not prevent rapid re-clicking

**Prevention:**
- Add a loading/cooldown state on the pricing page that prevents starting a new upgrade within 10 seconds of confirming one
- The Convex OCC will handle the mutation-level race correctly (serialize the two `grantUpgradeProRataCredits` calls), but the action-level state (period dates) could be stale if the subscription period shifted between upgrades
- Consider adding a broader dedup: if ANY `upgrade_prorate` grant exists in this period (regardless of plan pair), require a longer cooldown

**Phase to address:** Phase 2 (Edge case hardening) -- UI cooldown + broad dedup option.

---

## Moderate Pitfalls

### Pitfall 5: `createPreview` API Differences From Deprecated `retrieveUpcoming`

**What goes wrong:** The current code uses `stripe.invoices.createPreview()` (the new API), but many Stripe docs, tutorials, and Stack Overflow answers reference `stripe.invoices.retrieveUpcoming()` (the older API). The two APIs have subtly different parameter shapes:

- `createPreview` uses `subscription_details.items` (nested under `subscription_details`)
- `retrieveUpcoming` uses top-level `subscription_items` parameter
- `createPreview` returns a preview invoice that cannot be listed or paid
- `retrieveUpcoming` returns the actual upcoming invoice object

The comment in the code says "replacement for deprecated retrieveUpcoming" but `retrieveUpcoming` is NOT actually deprecated -- it still works. The two serve different purposes.

**Prevention:** The current `createPreview` usage is correct for preview-only scenarios. Just be aware that `retrieveUpcoming` is still valid and may be more appropriate if you need the actual upcoming invoice (e.g., for reconciliation). Do not mix parameter shapes between the two APIs.

**Phase to address:** No action needed -- current implementation is correct.

---

### Pitfall 6: Webhook `invoice.paid` for Proration Invoice Triggers Monthly Credit Logic

**What goes wrong:** When `always_invoice` creates a proration invoice, Stripe fires `invoice.paid` with `billing_reason: "subscription_update"`. This hits the `invoice.paid` handler in `http.ts`, which calls `processInvoiceForGrantNonBlocking`, which calls the full `processInvoiceForGrant` action, which re-fetches the invoice from Stripe and runs `classifyMonthlyCreditInvoice`.

If `classifyMonthlyCreditInvoice` were to classify `subscription_update` as eligible for a monthly grant, the user would receive BOTH the upgrade pro-rata credits (from the action) AND a full monthly credit grant (from the webhook). This would be a critical double-grant.

**Why it does NOT happen today:** `invoiceGrantPolicy.ts` line 9 explicitly lists `subscription_update` in `NON_RECURRING_REASONS`, causing `classifyMonthlyCreditInvoice` to return `ignore_non_recurring`. This is correct and critical.

**Prevention:**
- NEVER add `subscription_update` to `ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS`
- Add a unit test that explicitly asserts `classifyMonthlyCreditInvoice({ invoiceBillingReason: "subscription_update", ... })` returns `ignore_non_recurring`
- Add a comment in `invoiceGrantPolicy.ts` explaining why `subscription_update` must stay in the non-recurring set

**Phase to address:** Phase 1 -- add the unit test as a regression guard.

---

### Pitfall 7: Period Boundary Timestamps From Pre-Upgrade Subscription

**What goes wrong:** The `changePlan` action reads `currentPeriodStart` and `currentPeriodEnd` from `stripeSubscription` BEFORE calling `stripe.subscriptions.update()`:

```typescript
const periodStartMs = (stripeSubscription.current_period_start ?? ...) * 1000;
const periodEndMs = (stripeSubscription.current_period_end ?? ...) * 1000;
```

After the update, if the subscription's billing period changed (e.g., Stripe resets the period on immediate proration), these timestamps would be stale. The pro-rata credit calculation would use the old period boundaries to compute the remaining ratio, potentially granting too many or too few credits.

**Why it matters:** With `always_invoice`, Stripe does NOT reset the billing period -- the subscription retains its original `current_period_start` and `current_period_end`. The period only resets on `subscription_cycle` events (renewals). So this is actually safe for the current `always_invoice` usage. It would become a bug if the proration behavior were changed to `create_prorations` with a different billing anchor.

**Prevention:**
- Read period dates from the `updated` subscription object (the return value of `stripe.subscriptions.update()`), not from the pre-update fetch
- This is a defensive fix even though `always_invoice` does not change periods

**Phase to address:** Phase 1 -- use post-update timestamps.

---

### Pitfall 8: UI Shows Stale Credits After Upgrade

**What goes wrong:** After `handleConfirmUpgrade` succeeds, the Pricing component calls `getSubscriptionDetails` to refresh subscription state, then shows a success toast with `creditsGranted`. But the credits balance displayed elsewhere in the app (e.g., a header credit counter) reads from the Convex `credits` query, which is reactive. The credit grant mutation may not have propagated to the reactive query by the time the user navigates away from the pricing page.

**Why it happens:** Convex mutations are atomic and immediately visible to subsequent queries in the SAME mutation context. But the UI reads from a separate reactive query subscription, which may have a brief propagation delay (typically <100ms but can be longer under load).

**Prevention:**
- The success toast already shows the granted amount, which is correct
- If there is a separate credit balance display, it will update reactively within milliseconds -- this is a non-issue for Convex
- Do NOT add manual polling or cache invalidation -- let Convex reactivity handle it

**Phase to address:** No action needed -- Convex reactivity handles this correctly.

---

## Minor Pitfalls

### Pitfall 9: `Math.floor(Date.now() / 1000)` Timezone and Precision Issues

**What goes wrong:** Multiple places in the upgrade flow use `Math.floor(Date.now() / 1000)` to generate Unix timestamps for Stripe API calls. If the Convex action runtime's clock is slightly skewed from Stripe's clock, the `proration_date` could be in the past relative to Stripe, causing Stripe to reject it with "proration_date must be at or after the start of the current period."

**Prevention:** The Convex runtime uses NTP-synced clocks, so skew is typically <1 second. Add error handling for the `proration_date` rejection case -- if it fails, retry without a `proration_date` and accept the slight amount difference.

**Phase to address:** Phase 2 -- add error handling for clock skew.

---

### Pitfall 10: Credit Cap Interaction With Upgrade Pro-Rata Grants

**What goes wrong:** `grantUpgradeProRataCredits` applies `applyTierFreeCreditCap` using the NEW plan's cap. If the user is already at the old plan's cap (e.g., Go cap = 3000, user has 3000 free credits), and they upgrade to Pro (cap = 10000), the grant would succeed because 3000 < 10000. But if the user had accumulated credits near the Pro cap through purchases, the grant could be silently reduced by the cap. The preview dialog would show "You will receive X credits" but the actual grant is less.

**Prevention:**
- Calculate the post-cap grant amount in `getUpgradePreview` using the same `applyTierFreeCreditCap` logic with the user's current `freeBalance`
- Or show the preview amount as "up to X credits" rather than a guaranteed amount
- This is an edge case affecting users who have both a high free balance AND are upgrading

**Phase to address:** Phase 2 -- align preview with actual cap behavior.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Proration preview dialog | Preview amount diverges from actual charge (Pitfall 3) | Pass `proration_date` through preview -> execution flow |
| Reliable credit grant | Charge succeeds but grant fails (Pitfall 2) | Schedule retry on grant failure, store pending state |
| Invoice.paid for proration invoices | Proration invoice triggers monthly credit grant (Pitfall 6) | Unit test that `subscription_update` billing_reason is classified as non-recurring |
| Action vs webhook race | Both paths try to sync subscription state (Pitfall 1) | Document ownership contract: action owns sync + credits, webhook is idempotent backup |
| UI confirmation flow | User confirms stale preview after long delay (Pitfall 3) | Add staleness timeout or re-fetch on confirm |
| Error feedback | User charged but sees no credits (Pitfall 2) | Different toast for "credits pending" vs "credits granted" |
| Period date usage | Pre-update period dates used for credit calculation (Pitfall 7) | Read from post-update subscription object |
| Rapid re-upgrade | Multiple pro-rata grants stack within same period (Pitfall 4) | UI cooldown + broad dedup consideration |

## "Looks Done But Isn't" Checklist for v1.1

- [ ] **proration_date flow-through:** Preview and execution use the same timestamp -- not just "both use Date.now()" but literally the same stored value
- [ ] **Credit grant retry on failure:** `grantUpgradeProRataCredits` failure does not silently eat the error -- a retry is scheduled
- [ ] **subscription_update firewall:** Unit test proves proration invoices do not trigger monthly credit grants
- [ ] **Post-update timestamps:** Credit calculation uses period dates from the UPDATED subscription, not the pre-update fetch
- [ ] **UI feedback accuracy:** Toast message distinguishes between "credits granted" and "credits pending"
- [ ] **Preview staleness:** Dialog either re-fetches or warns if preview is >5 minutes old
- [ ] **Error recovery path:** Admin can manually trigger credit grant for failed upgrades without re-charging

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Charge succeeded but credits not granted (Pitfall 2) | LOW | Run `grantUpgradeProRataCredits` manually via Convex dashboard with the correct args. Or use `addCredits` mutation to grant the missing amount. |
| Preview amount differs from actual charge (Pitfall 3) | NEGLIGIBLE | The difference is typically <$1 for monthly subscriptions. No refund needed. Inform user if they complain. |
| Double pro-rata grant from rapid re-upgrade (Pitfall 4) | LOW | Query `creditTransactions` for multiple `upgrade_prorate` grants in the same period. Void the excess via `deductCredits`. |
| Proration invoice accidentally triggers monthly grant (Pitfall 6) | MEDIUM | Query `creditTransactions` for grants with `stripeInvoiceId` matching the proration invoice. Void the incorrect grant. Fix the `invoiceGrantPolicy.ts` classification. |
| Period date mismatch causes wrong credit amount (Pitfall 7) | LOW | Recalculate the correct pro-rata amount using the actual period dates from Stripe. Adjust via `addCredits` or `deductCredits`. |

## Sources

- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- `proration_date` must match between preview and execution; prorations are calculated to the second
- [Stripe Create Preview Invoice API](https://docs.stripe.com/api/invoices/create_preview) -- `subscription_details.proration_date` parameter behavior and caveats
- [Stripe Update Subscription API](https://docs.stripe.com/api/subscriptions/update) -- `error_if_incomplete` reverts subscription on payment failure; `always_invoice` creates and charges proration invoice immediately
- [Stripe Pending Updates](https://docs.stripe.com/billing/subscriptions/pending-updates) -- alternative approach using `pending_if_incomplete` for safer updates
- [Stripe Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) -- event ordering not guaranteed; `customer.subscription.updated` and `invoice.paid` events fire on subscription update
- [Billing Webhook Race Condition Solution Guide](https://excessivecoding.com/blog/billing-webhook-race-condition-solution-guide) -- webhook arrives 1-5s after API call; idempotent sync pattern
- [`customer.subscription.updated` webhook issue with @convex-dev/stripe](https://github.com/get-convex/stripe/issues/7) -- known issue with priceId not updating in component state
- [Stripe Preview Invoice Documentation](https://docs.stripe.com/invoicing/preview) -- exchange rates may vary between preview and actual creation; preview is a point-in-time snapshot
- Codebase analysis: `convex/subscriptions/actions.ts` (changePlan, getUpgradePreview), `convex/credits/internal.ts` (grantUpgradeProRataCredits), `convex/credits/lib/invoiceGrantPolicy.ts` (subscription_update classification), `convex/http.ts` (webhook handlers)

---
*Pitfalls research for: v1.1 Upgrade Flow -- OpenAlex Count*
*Researched: 2026-02-27*
