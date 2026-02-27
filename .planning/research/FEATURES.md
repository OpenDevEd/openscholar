# Feature Research

**Domain:** Stripe billing integration for SaaS subscription + credit system
**Researched:** 2026-02-27
**Confidence:** HIGH (codebase analysis + Stripe official docs + established industry patterns)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = billing is broken or trust is lost.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Immediate upgrade with proration** | Users who pay more want access now and expect a fair charge for the remaining period | MEDIUM | Already implemented: `changePlan` uses `proration_behavior: "create_prorations"` on `stripe.subscriptions.update`. Releases any pending downgrade schedule first. Verified in `convex/subscriptions/actions.ts`. |
| **Deferred downgrade (end of period)** | Users paid for the current period and expect to keep that plan until it expires | HIGH | Already implemented via `SubscriptionSchedule` API. `buildDowngradeSchedulePhases` creates a two-phase schedule (current plan until period end, then target plan). In `convex/subscriptions/lib/schedulePlanning.ts`. |
| **Cancellation at period end** | Users should not lose access immediately when they cancel; they already paid | LOW | Implemented via Stripe Customer Portal. `isSubscriptionScheduledToCancel` handles both `cancel_at_period_end` and `cancel_at` with tolerance. `handleSubscriptionCanceled` creates a free-plan record on `customer.subscription.deleted`. |
| **Webhook idempotency** | Double-processing causes double charges or double credit grants -- catastrophic for trust | MEDIUM | Implemented: `stripeEventLogs` table with `by_stripe_event_id` index. `upsertStripeEventLog` tracks received/processed/retrying/failed/ignored states. `creditTransactions` has `by_stripe_invoice` and `by_stripe_payment_intent` indexes for grant deduplication. |
| **Monthly credit grant on invoice.paid** | Subscription credits are the core value prop; not granting them = users cannot use the product | HIGH | Implemented: `processInvoiceForGrant` action fetches invoice from Stripe, `classifyMonthlyCreditInvoice` determines eligibility (only `subscription_create` and `subscription_cycle` billing reasons), `grantMonthlyCredits` mutation applies free-credit cap per tier. Includes retry with exponential backoff (5s, 15s, 30s, 60s, 120s, 300s). |
| **Credit top-up purchase (one-time)** | Users who exhaust monthly credits need to buy more without waiting for renewal | MEDIUM | Implemented: `createTopupCheckoutSession` creates Stripe Checkout in `payment` mode. Three bundles: 10k, 50k, 100k credits. `grantPurchasedCreditsFromPaymentIntent` fires on `payment_intent.succeeded`. |
| **Credit deduction (free first, then paid)** | Users expect free credits consumed before purchased credits -- standard for dual-wallet systems | LOW | Implemented in `credits/internal.ts:deductCredits`. Free balance consumed first, then paid. Transaction log maintained for both. |
| **Subscription sync on lifecycle events** | Local DB must reflect Stripe truth; stale state causes entitlement bugs | MEDIUM | Implemented: `syncSubscription` mutation fires on `customer.subscription.created`, `updated`, and `deleted` webhook events. Resolves userId via billing customer link, component store, or metadata fallback chain. |
| **Payment failure handling** | Users need to know their payment failed and still have a grace window to fix it | LOW | Implemented: `invoice.payment_failed` webhook fires `handlePaymentFailed`, setting subscription status to `past_due`. `past_due` is still an entitled status (users retain access while retrying). |
| **Stripe Customer Portal** | Users expect self-service for updating payment method, viewing invoices, and managing subscription | LOW | Implemented: `createPortalSession` resolves customer ID from billing customer link, local subscription, or component store fallback. |
| **Entitlement gating** | Access to premium features must be instantly gated on subscription status | LOW | Implemented: `isEntitledStatus` checks for `active`, `trialing`, `past_due`. `resolveEffectivePlan` returns `free` for non-entitled statuses. Used by AI mode routing layer. |
| **Invoice reconciliation cron** | Webhooks can be dropped; periodic reconciliation catches missed grants | HIGH | Implemented: hourly cron `reconcileRecentPaidInvoicesFromStripe` scans eligible customers, retrieves recent paid invoices, re-runs grant logic (deduplicated by `creditTransactions.by_stripe_invoice` index). |
| **Refund credit reversal** | When a credit top-up is refunded in Stripe, the credits must be clawed back proportionally | MEDIUM | Implemented: `charge.refunded` webhook fires `reversePurchasedCreditsFromRefund`. Calculates proportional credit reversal based on refund-to-charge ratio. Tracks `alreadyReversedCredits` for partial refund idempotency. |
| **Structured error handling for billing** | Users seeing generic "something went wrong" on billing actions will not trust the system | LOW | Implemented: Typed error codes (`BILLING_NO_SUBSCRIPTION_LINKED`, `BILLING_PLAN_CHANGE_CONFLICT`, etc.). `mapSubscriptionDetailsErrorCode` maps Stripe SDK errors to domain codes. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but make the billing experience polished.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Pending change visibility in UI** | Users see "Downgrade to Go scheduled for March 15" instead of wondering if the change took effect | LOW | Already implemented: `getSubscriptionDetails` returns `hasPendingChange`, `pendingTargetPriceId`, `pendingTargetPlan`, and `pendingEffectiveDate` by inspecting the subscription schedule. |
| **Smart pending-change cancellation** | If a user schedules a downgrade then changes their mind, one click clears the schedule and keeps the current plan | MEDIUM | Already implemented: `changePlan` detects `pending_change_cleared` via `determineChangeType`. Releases the schedule and clears pending metadata. |
| **Free credit cap per tier** | Prevents abuse of free credit accumulation; unused credits do not pile up forever | LOW | Already implemented: `applyTierFreeCreditCap` caps free balance at plan's `freeCreditCap` (e.g., Go = 3,000 cap, Pro = 15,000 cap). |
| **Backfill action for billing recovery** | After deployment or data migration, one action links billing customers, creates credit records, and reconciles invoices | HIGH | Already implemented: `backfillBillingAndCredits` iterates eligible subscriptions, upserts billing customer links, ensures credit records exist, then runs invoice reconciliation. |
| **Dual credit type (free + paid) with separate tracking** | Users can see exactly how their credits are being consumed and what they purchased vs. what was granted | LOW | Already implemented: `creditTransactions` table records `creditType` (free/paid) and `type` (grant/purchase/usage/refund) per transaction. |
| **Entitlement state in subscription details** | UI can show "Payment pending -- complete in billing portal" instead of silently failing | LOW | Already implemented: `getSubscriptionDetails` returns `entitlementState` (entitled/payment_pending/not_entitled) and `entitlementMessage`. |
| **Event log with classifications** | Ops can debug "why didn't credits arrive?" by querying `stripeEventLogs` with classification filters | MEDIUM | Already implemented: Events classified as `eligible_recurring_invoice`, `retry_invoice_not_paid`, `config_drift_missing_billing_reason`, `already_granted`, etc. |
| **Automatic retry with backoff for credit grants** | Webhooks arriving before subscription sync completes do not permanently fail; they self-heal | MEDIUM | Already implemented: 6-step exponential backoff (5s to 5min). Both action-level retries (processInvoiceForGrant) and mutation-level retries (grantMonthlyCredits, reconcileInvoiceCreditGrant). |
| **Payment method display** | Users see "Visa ending in 4242" next to their subscription -- builds confidence that billing is working | LOW | Already implemented: `getSubscriptionDetails` expands `default_payment_method` and returns `cardBrand` and `cardLast4`. |
| **Graceful degradation for credits-disabled mode** | If credits feature is toggled off, billing still functions for subscription management without crashing | LOW | Already implemented: `requireCreditsEnabled()` and `requireCreditTopupsEnabled()` feature flags gate credit operations. |
| **Usage-based credit metering with AI cost markup** | Credits map to real AI token costs with a configurable 1.3x markup, making pricing transparent and sustainable | LOW | Already implemented: `AI_COST_MARKUP = 1.3` in constants. Credit deduction happens in `withAuthAndCreditsBatch` per AI action. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. Deliberately excluded.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Immediate downgrade** | "I want to pay less right now" | User already paid for the current period. Immediate downgrade requires calculating and issuing a credit refund for unused time, which creates accounting complexity, Stripe proration edge cases, and user confusion when their credit balance changes unexpectedly. | Deferred downgrade via SubscriptionSchedule (already implemented). User keeps current plan until period end, new plan starts automatically. |
| **Custom proration logic (bypass Stripe)** | "We want to handle proration ourselves for special cases" | Maintaining a parallel proration engine creates divergence between Stripe's records and your DB. Invoice amounts will not match, tax calculations break, and dispute resolution becomes impossible. | Use Stripe's built-in `create_prorations` behavior. It handles currency rounding, tax recalculation, and invoice line items correctly. |
| **Credit expiry / time-based credit decay** | "Unused free credits should expire monthly to encourage usage" | Adds significant complexity (scheduled jobs, edge-case handling for mid-period grants, user anger when credits vanish). Cap-based approach already limits accumulation. | Free credit cap per tier already prevents infinite accumulation. Cap is checked on every grant; excess is silently discarded. |
| **Client-side subscription state polling** | "Check Stripe directly from the browser for real-time status" | Exposes Stripe API keys, creates rate limit issues, and the client can be manipulated. State desync between client poll and webhook creates race conditions. | Webhook-driven state synced to Convex (real-time queries auto-update all subscribing components). Convex's reactivity eliminates the need for polling. |
| **Multiple active subscriptions per user** | "Let users stack subscriptions for more credits" | Massively increases complexity: which subscription drives entitlement? What happens when one is canceled? How do credits reconcile? Stripe's invoicing becomes confusing with multiple concurrent subscriptions. | Single subscription with quantity scaling or credit top-ups for extra capacity (both already implemented). |
| **Build custom payment UI (skip Checkout/Portal)** | "We want a fully branded payment form" | PCI compliance burden, payment method handling, SCA/3DS flows, error handling, and localization. Stripe Checkout handles all of this with no PCI scope for you. | Stripe Checkout for new subscriptions + Customer Portal for management. Both support branding customization. |
| **Webhook-free architecture (poll Stripe API)** | "Webhooks are unreliable, just poll every minute" | API rate limits (25 requests/sec in test, 100 in live), increased latency for state changes, and higher cost. Polling at scale becomes a reliability problem itself. | Webhooks as primary + hourly reconciliation cron as safety net (already implemented). Best of both approaches. |
| **Real-time credit deduction notifications** | "Show a toast every time credits are consumed during AI operations" | Distracting during batch operations (extraction can consume hundreds of credits). Creates notification fatigue. | Credit balance query updates reactively in Convex. Users can check balance in settings. Show warnings only at low-balance thresholds. |

## Feature Dependencies

```
[Stripe Checkout Session]
    |--requires--> [Stripe Customer Resolution]
    |                  |--requires--> [billingCustomers table]
    |
    |--triggers--> [customer.subscription.created webhook]
                       |--triggers--> [syncSubscription mutation]
                       |                  |--requires--> [billingCustomers link]
                       |                  |--writes--> [subscriptions table]
                       |
                       |--triggers--> [invoice.paid webhook]
                                          |--triggers--> [processInvoiceForGrant]
                                                             |--requires--> [subscriptions table populated]
                                                             |--requires--> [credits record exists]
                                                             |--writes--> [credits table + creditTransactions]

[changePlan (upgrade)]
    |--requires--> [Active subscription in local DB]
    |--requires--> [Valid target priceId]
    |--may-release--> [Existing SubscriptionSchedule]
    |--triggers--> [customer.subscription.updated webhook]
    |--triggers--> [Proration invoice]

[changePlan (downgrade)]
    |--requires--> [Active subscription in local DB]
    |--creates--> [SubscriptionSchedule with 2 phases]
    |--triggers--> [customer.subscription.updated at period end]

[Credit Top-up Purchase]
    |--requires--> [Stripe Customer Resolution]
    |--triggers--> [payment_intent.succeeded webhook]
                       |--triggers--> [grantPurchasedCreditsFromPaymentIntent]
                                          |--requires--> [credits record exists]
                                          |--deduplicates-via--> [by_stripe_payment_intent index]

[Refund Reversal]
    |--requires--> [Original purchase transaction exists]
    |--triggers--> [charge.refunded webhook]
                       |--triggers--> [reversePurchasedCreditsFromRefund]
                                          |--requires--> [purchase transaction in creditTransactions]

[Invoice Reconciliation Cron]
    |--requires--> [subscriptions table with stripeCustomerId]
    |--requires--> [Stripe API access]
    |--reuses--> [processInvoiceForGrant logic]
    |--deduplicates-via--> [creditTransactions.by_stripe_invoice index]
```

### Dependency Notes

- **processInvoiceForGrant requires subscriptions table populated**: The invoice.paid webhook often arrives before customer.subscription.created is fully processed. The retry mechanism (5s-5min exponential backoff) handles this race condition by re-attempting subscription lookup.
- **changePlan requires active subscription**: Cannot upgrade/downgrade without an existing Stripe subscription. Users must go through Checkout first.
- **Credit top-up requires billing customer link**: The `resolveTopupUserId` function falls back to metadata and billingCustomers table. If neither exists (edge case), the grant fails.
- **Refund reversal requires original purchase**: If `charge.refunded` arrives but the `payment_intent.succeeded` has not been processed yet, the reversal silently no-ops (`ignored_no_purchase`). No retry mechanism for this -- relies on Stripe event ordering.
- **Reconciliation cron enhances webhook reliability**: The cron is not a dependency but a safety net. If all webhooks fire correctly, the cron detects `already_granted` and no-ops.

## MVP Definition

### Already Implemented (v1 -- Current State)

All table-stakes features are implemented. The codebase has a mature billing integration.

- [x] Subscription checkout via Stripe Checkout
- [x] Upgrade with immediate proration
- [x] Downgrade via SubscriptionSchedule (deferred)
- [x] Cancellation at period end (via Customer Portal)
- [x] Monthly credit grants on invoice.paid
- [x] Credit top-up purchases
- [x] Webhook idempotency via event log
- [x] Invoice reconciliation cron (hourly)
- [x] Refund credit reversal
- [x] Payment failure handling (past_due status)
- [x] Entitlement gating
- [x] Structured billing error codes

### Audit & Harden (v1.1 -- This Milestone)

Verify correctness and harden edge cases in existing implementation.

- [ ] Verify proration invoice is actually charged (not just created) on upgrade -- confirm `payment_behavior` setting
- [ ] Verify downgrade schedule survives mid-period subscription updates (e.g., payment method change)
- [ ] Verify credit grant deduplication handles the exact-same-invoice-ID-different-event-ID case
- [ ] Verify `handleSubscriptionCanceled` correctly creates a free-plan record when subscription has custom metadata
- [ ] Verify reconciliation cron handles API pagination for customers with >100 invoices
- [ ] Verify credit top-up handles edge case where checkout session is abandoned and a new one is started
- [ ] Verify `checkSubscriptionStatus` maintenance job actually takes corrective action (currently just logs warnings)
- [ ] Add monitoring/alerting for `stripeEventLogs` with `failed` status that are not resolved within N hours

### Future Consideration (v2+)

- [ ] Trial period support (currently no trial config in PLAN_CONFIG) -- add when onboarding conversion is a priority
- [ ] Stripe Billing Credits API integration (native Stripe credit system) -- evaluate when Stripe's credits feature matures beyond its current state
- [ ] Usage-based metered billing via Stripe (report actual AI token usage to Stripe) -- currently credits are managed locally, which is simpler but less Stripe-native
- [ ] Multi-currency credit purchases -- currently USD-only, `CREDIT_TOPUP_CURRENCY = "usd"`
- [ ] Team/org billing with seat management -- currently single-user subscriptions with quantity field reserved
- [ ] Retention flows (cancellation survey, discount offers) -- consider when churn metrics indicate need

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Verify upgrade proration charging | HIGH | LOW | P1 |
| Verify downgrade schedule resilience | HIGH | LOW | P1 |
| Verify credit grant deduplication completeness | HIGH | LOW | P1 |
| Make `checkSubscriptionStatus` take corrective action | MEDIUM | MEDIUM | P1 |
| Add failed-event monitoring/alerting | MEDIUM | LOW | P1 |
| Verify cancellation flow creates correct free-plan record | HIGH | LOW | P1 |
| Verify reconciliation handles pagination | MEDIUM | LOW | P2 |
| Verify abandoned checkout edge cases | LOW | LOW | P2 |
| Trial period support | MEDIUM | MEDIUM | P3 |
| Multi-currency support | LOW | HIGH | P3 |
| Team/org billing | MEDIUM | HIGH | P3 |
| Retention/churn flows | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must verify/fix in this audit milestone -- correctness-critical
- P2: Should verify -- edge cases that could surface under load
- P3: Future consideration -- not part of the current audit scope

## Competitor Feature Analysis

Not directly applicable -- this is a billing infrastructure audit, not a competitive product analysis. However, the implementation aligns with patterns seen in well-regarded SaaS billing systems:

| Pattern | Industry Standard | OpenAlex Count Approach | Assessment |
|---------|-------------------|-------------------------|------------|
| Upgrade proration | Immediate with `create_prorations` | Same | Correct |
| Downgrade timing | Deferred to period end | Same (via SubscriptionSchedule) | Correct |
| Cancellation | `cancel_at_period_end` | Customer Portal handles this | Correct |
| Webhook idempotency | Store event IDs, check before processing | `stripeEventLogs` + `creditTransactions` indexes | Correct |
| Credit grants | On invoice.paid for subscription_cycle/create | Same, with retry backoff | Correct |
| Reconciliation | Periodic cron as safety net | Hourly cron | Correct |
| Credit wallet | Dual-wallet (free + paid), free consumed first | Same | Correct |
| Refund handling | Proportional credit reversal | Same | Correct |

## Sources

- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- proration behavior options and best practices (HIGH confidence)
- [Stripe Subscription Schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) -- schedule API for deferred plan changes (HIGH confidence)
- [Stripe Cancel Subscriptions](https://docs.stripe.com/billing/subscriptions/cancel) -- cancellation flow options and `cancel_at_period_end` (HIGH confidence)
- [Stripe Billing Credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) -- native credit system for comparison (MEDIUM confidence)
- [Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests) -- idempotency key patterns (HIGH confidence)
- [Stigg: Stripe Webhook Best Practices](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks) -- webhook integration lessons learned (MEDIUM confidence)
- [Stripe Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) -- required webhook events for lifecycle management (HIGH confidence)
- Codebase analysis: `convex/subscriptions/`, `convex/credits/`, `convex/http.ts`, `convex/crons.ts`, `convex/lib/constants.ts`, `lib/billing/entitlements.ts` (HIGH confidence)

---
*Feature research for: Stripe billing integration audit & fix*
*Researched: 2026-02-27*
