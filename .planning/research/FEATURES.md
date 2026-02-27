# Feature Research

**Domain:** SaaS upgrade flow with proration preview and pro-rata credit grants
**Researched:** 2026-02-27
**Confidence:** HIGH (Stripe official docs + codebase analysis + established SaaS patterns)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist when upgrading a paid subscription. Missing any of these = broken or untrustworthy billing.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Proration preview before confirming upgrade** | Users must know exactly what they will be charged before committing. Surprise charges destroy trust and trigger chargebacks. Every major SaaS (Slack, Notion, GitHub) shows the amount before charging. | MEDIUM | Partially implemented. `getUpgradePreview` action uses `stripe.invoices.createPreview()` which is the correct current API (replaces deprecated `retrieveUpcoming`). Dialog component exists (`upgrade-confirmation-dialog.tsx`) and renders the preview data. **Key gap:** The `proration_date` is not pinned between preview and execution. Stripe prorates to the second, so the preview amount can drift from the actual charge. Must pass the same `proration_date` to both `createPreview` and `subscriptions.update`. |
| **Immediate plan upgrade with correct proration charge** | When a user upgrades mid-cycle, they expect instant access to the higher tier and a fair charge for the remaining days only. Industry standard since Stripe made it default. | LOW | Already implemented. `changePlan` uses `proration_behavior: "always_invoice"` with `payment_behavior: "error_if_incomplete"`. This charges the proration difference immediately and fails the request if payment cannot be collected. No changes needed to the Stripe API call itself. |
| **Pro-rata credit grant on mid-cycle upgrade** | If upgrading from Go (3,000 credits/month) to Pro (15,000 credits/month) with 15 days remaining, the user expects ~6,000 bonus credits immediately (not waiting until next renewal). | MEDIUM | Implemented but fragile. `grantUpgradeProRataCredits` calculates `floor(remainingRatio * creditDelta)` and applies the tier free-credit cap. **Key gap:** Credit grant is a separate mutation call after `subscriptions.update` succeeds. If the mutation fails (Convex transient error, timeout), the plan changes but credits are not granted. Currently this is logged as non-fatal (`console.error`) but the user sees a success toast with potentially wrong credit count. |
| **Atomic upgrade flow (charge + sync + grant succeed together, or user sees clear failure)** | If payment succeeds but credit grant fails, the user has paid more but has no additional credits. This is the known production bug. The user must never be left in a "paid but not credited" state without clear recovery. | HIGH | **This is the primary problem to solve.** Currently: (1) Stripe update succeeds, (2) local sync succeeds, (3) credit grant may fail silently. The `changePlan` action wraps the credit grant in try/catch and logs failures, but returns `success: true` with potentially `creditsGranted: undefined`. The client falls back to `upgradePreview.proRataCredits` for the toast, which may not match reality. |
| **Upgrade error recovery (card declined, network failure)** | When payment fails during upgrade, the user must see a clear message ("card declined") and remain on their current plan. No partial state changes. | LOW | Already implemented correctly. `error_if_incomplete` ensures Stripe does not change the subscription if payment fails. `StripeCardError` is caught and mapped to `BILLING_CHARGE_FAILED` with a user-friendly message. `StripeInvalidRequestError` maps to `BILLING_PLAN_CHANGE_CONFLICT`. The user stays on their current plan. |
| **Success feedback with accurate credit count** | After a successful upgrade, the user needs confirmation of: (a) new plan name, (b) amount charged, (c) credits granted. Generic "upgrade successful" is insufficient. | LOW | Partially implemented. The success toast shows plan name and credits via sonner. **Key gap:** `creditsGranted` in the `changePlan` response may be `undefined` if the grant mutation failed, and the UI falls back to the preview estimate. This means the toast could say "7,500 credits granted" when 0 were actually granted. Must make the toast reflect actual grant outcome. |
| **Confirmation dialog that prevents accidental upgrades** | Clicking "Upgrade" must not immediately charge the user. A confirmation step showing the exact charge amount is necessary to prevent support tickets and chargebacks. | LOW | Implemented. The `UpgradeConfirmationDialog` component gates the upgrade behind a two-step flow: (1) click "Upgrade to Pro" triggers `getUpgradePreview`, (2) dialog shows preview, (3) user clicks "Confirm upgrade" to execute. Dialog disables close during confirmation (prevents double-submit). |

### Differentiators (Competitive Advantage)

Features that make the upgrade experience polished beyond the basics.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Payment method display in confirmation dialog** | Showing "Visa ending 4242 will be charged $X.XX" gives users confidence they know which card is being used. Reduces "wait, which card?" anxiety. | LOW | `getSubscriptionDetails` already returns `cardBrand` and `cardLast4`. Just needs to be threaded into the dialog preview data and rendered. Currently not shown in the confirmation dialog. |
| **Proration breakdown (credit + charge line items)** | Instead of just showing the net charge, showing "-$5.00 credit for unused Go" and "+$10.00 Pro for 15 days" helps users understand the math. Stripe's preview invoice contains line items for this. | MEDIUM | `stripe.invoices.createPreview()` returns line items in `preview.lines.data`. These are not currently extracted by `getUpgradePreview` -- only the net `amount_due` and `total` are returned. Adding line item extraction would require expanding the return type. |
| **Credit grant guarantee with reconciliation fallback** | If the in-flow credit grant fails, a background reconciliation detects the gap and retries. Users never permanently lose credits they paid for. | HIGH | The hourly `reconcileRecentPaidInvoicesFromStripe` cron handles monthly grants but does not currently handle upgrade pro-rata grants. The pro-rata grant uses a separate `upgrade_prorate` grant type. A reconciliation mechanism for failed upgrade grants would need to detect "plan changed but no upgrade_prorate transaction in this period" and re-run the grant. |
| **Animated transition in dialog** | Smooth loading state while preview is fetched, animated charge reveal, and success state give a premium feel to an otherwise anxious moment (being charged money). | LOW | Dialog currently shows a loading spinner while preview loads. Could be enhanced with skeleton states and a brief success animation before closing. Low priority but polished. |
| **Localized currency formatting** | Already using `next-intl`'s `useFormatter` for currency display. Users see "$12.50" or "12,50 EUR" based on locale. | LOW | Already implemented in both the pricing page and dialog. `format.number()` with `style: "currency"` handles this correctly. No changes needed. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for the upgrade flow specifically.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Custom proration math (bypass Stripe's calculation)** | "We want to round proration amounts to the nearest dollar" or "We want to give a discount on the proration" | Stripe's invoicing, tax calculation, and dispute resolution all depend on Stripe computing the proration. Custom math creates discrepancies between what you charge and what Stripe records, breaking refund flows and tax reporting. Already documented as out-of-scope in PROJECT.md. | Use Stripe's `invoices.createPreview()` for display and `always_invoice` for charging. Stripe handles rounding, tax, and currency correctly. |
| **Rollback upgrade on credit grant failure** | "If credits fail to grant, reverse the Stripe subscription back to the old plan" | Rolling back the subscription creates a second proration (this time a credit), a new invoice, and potentially a second webhook storm. The user's payment method gets charged then credited, which looks suspicious on bank statements. Far more disruptive than a delayed credit grant. | Grant credits as best-effort in the primary flow, with a reconciliation safety net for failures. The plan upgrade (the expensive Stripe operation) should be considered committed once Stripe confirms it. |
| **Upgrade preview caching (show preview without Stripe API call each time)** | "Cache the preview so users see it instantly when they click upgrade" | Proration amounts change by the second (Stripe prorates to the second). A cached preview becomes stale within minutes. Showing a stale amount and then charging a different amount is worse than a brief loading delay. | Fetch preview on demand when user clicks "Upgrade to X". Show a loading state in the dialog. The Stripe API call typically completes in 200-500ms. |
| **Optimistic UI for credit grant** | "Show the new credit balance immediately in the dialog before the server confirms" | If the grant fails or is capped, the displayed balance is wrong. Users who see "15,000 credits" then refresh to see "3,000 credits" will file support tickets. | Show credits from the server response only. The `changePlan` action returns `creditsGranted` -- use that for the success toast. If the value is missing/zero due to grant failure, show "Credits are being processed" instead of a specific number. |
| **Require email confirmation for upgrade** | "Send a confirmation email before charging" | Adds friction to a moment where the user has already decided to upgrade. Email delivery delays (seconds to minutes) create a terrible UX. No major SaaS does this for upgrades (though some do for cancellations). | In-app confirmation dialog (already implemented) is sufficient. The dialog shows the charge amount and requires an explicit "Confirm upgrade" click. |

## Feature Dependencies

```
[Proration Preview]
    |--requires--> [Active Stripe subscription]
    |--requires--> [Valid target price ID]
    |--calls--> [stripe.invoices.createPreview()]
    |--returns--> [Preview data for confirmation dialog]

[Confirmation Dialog]
    |--requires--> [Proration Preview data]
    |--displays--> [Charge amount, plan change, credit estimate]
    |--on-confirm--> [changePlan action]

[changePlan (upgrade path)]
    |--step 1: releases--> [Existing SubscriptionSchedule if any]
    |--step 2: calls--> [stripe.subscriptions.update with always_invoice]
    |--step 3: calls--> [syncLocalSubscriptionFromStripe]
    |--step 4: calls--> [grantUpgradeProRataCredits]
    |                        |--requires--> [credits record exists]
    |                        |--deduplicates-via--> [creditTransactions by_user + upgrade_prorate + period]
    |                        |--applies--> [applyTierFreeCreditCap]
    |--returns--> [success + creditsGranted]

[Success Toast]
    |--requires--> [changePlan response.creditsGranted]
    |--fallback--> [upgradePreview.proRataCredits] (PROBLEM: may not match reality)

[Credit Grant Reconciliation] (NEW -- not yet implemented)
    |--requires--> [subscriptions table shows upgrade happened]
    |--requires--> [creditTransactions table missing upgrade_prorate for period]
    |--triggers--> [grantUpgradeProRataCredits retry]
```

### Dependency Notes

- **Proration preview requires active subscription**: Cannot preview if the user has no Stripe subscription. The `getUpgradePreview` action validates this and throws `BILLING_NO_ACTIVE_SUBSCRIPTION`.
- **Confirmation dialog requires preview data**: Dialog renders `null` if preview is not loaded. This is correct -- prevents showing empty/stale data.
- **changePlan step 2 is the point of no return**: Once `stripe.subscriptions.update` succeeds, the plan has changed in Stripe. Steps 3 and 4 can fail independently. Step 3 failure is self-healing (next webhook will sync). Step 4 failure needs reconciliation.
- **Success toast depends on changePlan response accuracy**: Currently the response `creditsGranted` can be `undefined` if step 4 fails, and the UI falls back to the preview estimate. This dependency is the source of the "wrong credit count" bug.
- **Proration date must be pinned**: The `proration_date` used in preview must match the one used in execution. Currently they are computed independently (`Math.floor(Date.now() / 1000)` at different times), which can cause a few-seconds drift in the charge amount.

## MVP Definition

### Must Ship (v1.1 -- This Milestone)

These are required to fix the broken upgrade flow and ship a reliable experience.

- [ ] **Pin `proration_date` between preview and execution** -- Pass the same unix timestamp from `getUpgradePreview` through the confirmation dialog to `changePlan`. Ensures the charge amount matches the preview exactly. Stripe documentation explicitly recommends this.
- [ ] **Make credit grant failure visible to the user** -- If `grantUpgradeProRataCredits` fails after plan change succeeds, the `changePlan` response must communicate this clearly. The UI must show "Your plan has been upgraded. Credits are being processed and will appear shortly." instead of claiming a specific credit count that was not actually granted.
- [ ] **Handle `creditsGranted: undefined` in success toast** -- The client currently falls back to `upgradePreview.proRataCredits` which may not match reality (cap applied, rounding, or grant failure). Replace with: if `creditsGranted` is present, show it; if absent, show a generic "credits processing" message.
- [ ] **Ensure confirmation dialog cannot be double-submitted** -- Currently `isConfirming` disables the close button and confirm button. Verify this also prevents keyboard dismissal (Escape key) and click-outside during the upgrade API call.

### Add After Validation (v1.x)

Features to add once the core upgrade flow is stable and confirmed working in production.

- [ ] **Payment method display in dialog** -- Thread `cardBrand` and `cardLast4` into the preview and show "Visa ...4242 will be charged $X.XX". Trigger: first production upgrade completes successfully.
- [ ] **Proration line item breakdown** -- Extract `preview.lines.data` from `createPreview` response and show credit/debit line items. Trigger: user feedback requesting more transparency.
- [ ] **Upgrade credit grant reconciliation** -- Extend the existing reconciliation cron to detect missing `upgrade_prorate` grants and re-run them. Trigger: observed instance of credit grant failure in production logs.

### Future Consideration (v2+)

Features to defer until the upgrade flow is proven stable.

- [ ] **Flexible billing mode migration** -- Stripe recommends migrating existing subscriptions to flexible billing mode for more accurate prorations and mixed intervals. Requires testing all existing flows against the new mode.
- [ ] **Upgrade path suggestions** -- When a user runs low on credits, suggest upgrading with a preview of what they would get. Requires usage pattern analysis.
- [ ] **A/B testing upgrade dialog copy** -- Test different wordings for the proration explanation to see which converts better. Requires analytics infrastructure.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Pin `proration_date` between preview and execution | HIGH | LOW | P1 |
| Handle credit grant failure visibility | HIGH | LOW | P1 |
| Fix success toast for `creditsGranted: undefined` | HIGH | LOW | P1 |
| Verify dialog cannot be double-submitted | HIGH | LOW | P1 |
| Payment method in confirmation dialog | MEDIUM | LOW | P2 |
| Proration line item breakdown | LOW | MEDIUM | P2 |
| Upgrade credit grant reconciliation | MEDIUM | HIGH | P2 |
| Flexible billing mode migration | LOW | HIGH | P3 |
| Upgrade path suggestions | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must fix for v1.1 -- correctness-critical for the upgrade flow
- P2: Should add once v1.1 is stable -- enhances confidence and resilience
- P3: Future consideration -- not part of upgrade flow fix scope

## Confirmation Dialog: What Good Looks Like

Based on Stripe documentation, SaaS best practices (Slack, Notion, GitHub patterns), and the existing codebase, a good upgrade confirmation dialog shows:

### Required Information (Table Stakes)
1. **Plan transition**: "Go -> Pro" with visual arrow/indicator
2. **Prorated charge amount**: The exact dollar amount that will be charged right now (from `invoices.createPreview`)
3. **Time context**: "for the 15 remaining days in your billing cycle" -- explains why the amount is less than full price
4. **Credits granted**: "7,500 credits granted immediately" -- the primary value the user gets from upgrading mid-cycle
5. **Going-forward rate**: "Then 15,000 credits/month starting next cycle" -- sets expectation for future billing
6. **Clear confirm/cancel actions**: "Confirm upgrade" (primary) and "Cancel" (secondary)
7. **Loading state during execution**: Spinner + "Upgrading..." text with both buttons disabled

### Good-to-Have Information (Differentiators)
8. **Payment method**: "Visa ending 4242 will be charged" -- removes ambiguity about which card
9. **Proration math breakdown**: "-$5.00 unused Go time / +$10.00 Pro for 15 days = $5.00 due now"
10. **Current balance context**: "Your current balance: 1,200 credits + 7,500 new = 8,700 total"

### What the Existing Dialog Already Has
The current `upgrade-confirmation-dialog.tsx` covers items 1-7 correctly. The i18n strings are already localized into 6 languages (en-US, en-GB, fr, zh, hi, ja). The component structure is clean with `DialogHeader`, content sections, and `DialogFooter`. The primary gaps are the proration date pinning (backend), credit grant failure handling (backend + frontend), and the optional card display (frontend).

## Sources

- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- proration behavior, `createPreview` API, `proration_date` pinning recommendation (HIGH confidence)
- [Stripe Create Preview Invoice API](https://docs.stripe.com/api/invoices/create_preview) -- parameters and response shape for preview (HIGH confidence)
- [Stripe Pending Updates](https://docs.stripe.com/billing/subscriptions/pending-updates) -- `error_if_incomplete` and `pending_if_incomplete` behaviors (HIGH confidence)
- [Stripe Modify Subscriptions](https://docs.stripe.com/billing/subscriptions/change) -- upgrade/downgrade patterns (HIGH confidence)
- [Stigg: Upgrade & Downgrade Flows Guide](https://www.stigg.io/blog-posts/the-only-guide-youll-ever-need-to-implement-upgrade-downgrade-flows-part-2) -- SaaS patterns for mid-cycle changes (MEDIUM confidence)
- [Chargebee: Proration in SaaS](https://www.chargebee.com/blog/ask-us-proration-saas-important/) -- industry proration patterns (MEDIUM confidence)
- [Zenskar: Prorated Billing for SaaS](https://www.zenskar.com/blog/prorated-billing) -- pro-rata credit calculation patterns (MEDIUM confidence)
- Codebase analysis: `convex/subscriptions/actions.ts`, `convex/credits/internal.ts`, `components/billing/upgrade-confirmation-dialog.tsx`, `components/Pricing.tsx`, `convex/lib/constants.ts` (HIGH confidence)

---
*Feature research for: SaaS upgrade flow with proration preview and pro-rata credit grants*
*Researched: 2026-02-27*
