# Pitfalls Research

**Domain:** Stripe billing integration (subscriptions, credits, webhooks) in a Convex + Next.js SaaS
**Researched:** 2026-02-27
**Confidence:** HIGH (verified against codebase, Stripe docs, and community sources)

## Critical Pitfalls

### Pitfall 1: Upgrade proration uses `create_prorations` instead of `always_invoice`

**What goes wrong:**
The current `changePlan` action uses `proration_behavior: "create_prorations"` for upgrades. This creates proration line items but does NOT immediately invoice the customer. The proration difference accumulates as a pending invoice item and only gets charged on the next billing cycle. Users upgrade, get immediate access to the higher plan, but are not charged the difference until renewal. If they downgrade before renewal, they may never pay the proration.

**Why it happens:**
`create_prorations` is Stripe's default behavior, so developers often use it without realizing it defers payment. The name "create prorations" sounds like it handles billing, but it only creates the line items without invoicing them.

**How to avoid:**
Use `proration_behavior: "always_invoice"` for upgrades. This creates the prorations AND immediately generates and finalizes an invoice for the difference. The customer pays the proration amount right away. Only use `create_prorations` (or `none`) when you explicitly want to defer billing.

**Warning signs:**
- Users upgrade but no immediate charge appears in Stripe dashboard
- Proration line items visible as "pending invoice items" on the customer in Stripe
- Revenue leakage when users upgrade then downgrade within the same billing period

**Phase to address:**
Phase 1 (Subscription lifecycle fixes) -- this is the known bug mentioned in PROJECT.md.

---

### Pitfall 2: Webhook event out-of-order delivery corrupts subscription state

**What goes wrong:**
Stripe does not guarantee event delivery order. A `customer.subscription.updated` event from an older state can arrive after a newer one, causing the local `subscriptions` table to revert to stale data. For example: user upgrades, two `subscription.updated` events fire. If the first (pre-upgrade) arrives after the second (post-upgrade), `syncSubscription` overwrites the correct state with the old plan.

**Why it happens:**
The current `syncSubscription` mutation unconditionally writes whatever data the webhook delivers. It does not compare timestamps or version counters to determine if the incoming event is newer than what is already stored.

**How to avoid:**
Compare `event.created` (Unix timestamp on the Stripe event) or `subscription.updated` timestamp against the locally stored `updatedAt`. Only apply the mutation if the incoming event is newer. Alternatively, after receiving a webhook, re-fetch the subscription from Stripe's API to get the canonical current state (the "single source of truth" pattern).

**Warning signs:**
- Users report their plan reverted after an upgrade/downgrade
- `subscriptions` table shows a plan that doesn't match what Stripe dashboard shows
- `stripeEventLogs` shows multiple events for the same subscription processed in rapid succession

**Phase to address:**
Phase 1 (Webhook hardening) -- add timestamp guards to `syncSubscription`.

---

### Pitfall 3: Credit deduction race condition between concurrent AI operations

**What goes wrong:**
The `deductCredits` mutation reads the current balance, checks sufficiency, then writes the new balance. In Convex, mutations are serialized per-document, so this is safe within a single mutation. However, `withAuthAndCreditsBatch` in `ai/helpers.ts` checks the balance *before* the AI operation runs (an action), then deducts *after*. Between the check and the deduction, another operation could drain the balance. Two concurrent AI operations could both pass the balance check with 100 credits, each use 80, and the final balance goes to -60.

**Why it happens:**
Actions in Convex are not transactional -- the balance check (query) and the deduction (mutation) run as separate transactions with the AI call in between. This is a classic TOCTOU (time-of-check-to-time-of-use) problem.

**How to avoid:**
Accept that the pre-check is optimistic and the deduction mutation is the real guard. The `deductCredits` mutation already throws on insufficient balance, which is correct. The risk is that the AI operation runs and consumes provider costs before the deduction fails. Mitigation options: (1) Reserve credits before the operation (pessimistic locking via a "hold" mutation), (2) Allow small negative balances and reconcile later, (3) Accept the rare overspend as a business cost. Option 2 is the pragmatic choice for this scale.

**Warning signs:**
- `INSUFFICIENT_CREDITS` errors appearing after successful AI operations
- Credit balances occasionally going negative (if the guard is relaxed)
- Users seeing "operation succeeded" but credits not deducted

**Phase to address:**
Phase 3 (Edge case hardening) -- not urgent at current scale, but important before significant user growth.

---

### Pitfall 4: Double credit grant from overlapping invoice events

**What goes wrong:**
When a subscription is created or renewed, Stripe can fire `invoice.paid`, `invoice.payment_succeeded`, `checkout.session.completed`, and `payment_intent.succeeded` events -- all for the same underlying payment. If multiple event handlers trigger credit grants independently, credits are granted more than once for the same billing cycle.

**Why it happens:**
Developers wire up credit granting to multiple event types "to be safe" without realizing they overlap. In the current codebase, `invoice.paid` triggers `processInvoiceForGrant`, and `checkout.session.completed` triggers `reconcileRecentPaidInvoicesFromStripe` which processes the same invoice. Additionally, the hourly cron also runs `reconcileRecentPaidInvoicesFromStripe`.

**How to avoid:**
The codebase already has the right idempotency guard: `grantMonthlyCredits` checks for existing `creditTransactions` by `stripeInvoiceId` before granting. This is correct. The risk is if different code paths use different identifiers (e.g., one uses `stripeInvoiceId`, another uses `stripePaymentIntentId`). Ensure ALL grant paths converge on a single idempotency key: the invoice ID. The current code does this correctly -- maintain this invariant.

**Warning signs:**
- Credit transaction log shows multiple "grant" entries for the same billing period
- `creditTransactions` with overlapping timestamps and similar descriptions
- Total granted credits exceed `creditsPerMonth` for a subscription

**Phase to address:**
Phase 2 (Credit system audit) -- verify existing guards, add monitoring/alerting.

---

### Pitfall 5: Subscription schedule leak on rapid plan changes

**What goes wrong:**
When a user schedules a downgrade (which creates a `SubscriptionSchedule`), then changes their mind and upgrades, the old schedule must be released before applying the upgrade. If `stripe.subscriptionSchedules.release()` fails (network error, Stripe outage) but the subsequent `stripe.subscriptions.update()` succeeds, the subscription gets upgraded but the old schedule remains attached. When the schedule fires at period end, it silently downgrades the user.

**Why it happens:**
The `changePlan` action does release the schedule before upgrading, but these are two separate Stripe API calls with no transactional guarantee. A partial failure leaves the system in an inconsistent state.

**How to avoid:**
After any plan change that should clear a schedule, verify that `subscription.schedule` is `null` on the returned subscription object. If it is still attached, retry the release. Add a background job (or extend the existing cron) that checks active subscriptions for orphaned schedules that conflict with the current plan.

**Warning signs:**
- Users report unexpected downgrades after a successful upgrade
- Stripe dashboard shows a subscription with both a schedule and a mismatching current price
- `subscription.updated` webhooks arriving with unexpected price changes at period boundaries

**Phase to address:**
Phase 1 (Subscription lifecycle fixes) -- add post-change schedule verification.

---

### Pitfall 6: Free credit cap blocks legitimate monthly grants

**What goes wrong:**
The `applyTierFreeCreditCap` function caps free credits at the plan's `freeCreditCap` (e.g., 3,000 for "go"). If a user has not consumed their credits from the previous month and their free balance is already at cap, the monthly grant returns `actualAdded: 0`. The user paid for the month but received zero new credits. This is by design but creates a negative user experience when users expect credits to roll over or accumulate.

**Why it happens:**
The cap exists to prevent unbounded credit accumulation, which is a valid business constraint. But the interaction between "paid subscription credits" and "free balance cap" is confusing. Users who use credits slowly get penalized.

**How to avoid:**
Clearly communicate the cap in the billing UI: "Your plan includes 3,000 credits/month, capped at 3,000 total free credits." Consider whether the cap should be higher than `creditsPerMonth` (e.g., 2x) to allow one month of rollover. Alternatively, separate "subscription credits" from "free credits" so monthly grants always land even if the user has unused prior credits.

**Warning signs:**
- Support tickets: "I'm paying but not getting credits"
- `grantMonthlyCredits` returning `processed_no_credits` with classification `cap_reached_or_zero_grant` for paying subscribers
- Low credit utilization rates in analytics

**Phase to address:**
Phase 2 (Credit system audit) -- evaluate cap policy and UX messaging.

---

### Pitfall 7: `handleSubscriptionCanceled` clears `stripeSubscriptionId` and creates orphan records

**What goes wrong:**
When a subscription is canceled, `handleSubscriptionCanceled` sets `stripeSubscriptionId: undefined` on the old record and creates a new "free" subscription record. This means (1) the old subscription can no longer be found by `by_stripe_sub` index, breaking any subsequent webhook events that reference it, and (2) the user accumulates multiple subscription records over time (one canceled, one free, then a new paid one if they resubscribe).

**Why it happens:**
The intent is to cleanly transition the user to "free" status. But clearing the Stripe ID breaks the linkage, and inserting a new record without cleaning up or linking adds complexity to `selectCanonicalSubscription`.

**How to avoid:**
Keep `stripeSubscriptionId` on canceled records (set status to "canceled" but preserve the ID for audit). Do not create a new free subscription record -- instead, let `resolveEffectivePlan` return "free" when no active subscription exists. This simplifies the data model and prevents the N+1 subscription record problem.

**Warning signs:**
- Users with 5+ subscription records in the `subscriptions` table
- `selectCanonicalSubscription` returning the wrong record
- Webhook events for canceled subscriptions logging "No subscription found"

**Phase to address:**
Phase 1 (Subscription lifecycle fixes) -- refactor cancellation handler.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `any` type for Stripe event objects in webhook handlers | Faster development, no type import hassle | Silently accessing wrong properties, runtime errors on Stripe API version changes | Never in production -- use `Stripe.Invoice`, `Stripe.Subscription`, etc. |
| Casting `internal` to `any` (`const internalApi = internal as any`) | Bypasses Convex codegen type issues | No compile-time safety for mutation/action arg mismatches | Only during rapid prototyping, should be replaced with proper typing |
| Hourly reconciliation cron as safety net | Catches missed webhooks, eventual consistency | Masks webhook handler bugs, adds Stripe API load, delays credit grants by up to 1 hour | Acceptable as belt-and-suspenders, but should not be relied on as primary mechanism |
| Fallback subscription resolution via `stripe.subscriptions.list` | Recovers from missing subscription pointers | Extra Stripe API call per invoice, rate limit pressure at scale | Acceptable for now, but add caching or fix root cause (ensure subscription pointer is always set) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe Subscription Schedules | Creating a schedule `from_subscription` but not handling the schedule's `released` / `canceled` lifecycle events | Listen for `subscription_schedule.completed`, `subscription_schedule.released`, and `subscription_schedule.canceled` events; sync local state accordingly |
| Stripe Customer Portal | Assuming portal handles all plan changes and not intercepting user actions | If using custom plan change logic (like `changePlan`), configure the portal to disable self-service plan changes, or handle portal-initiated changes via webhooks |
| `@convex-dev/stripe` component | Assuming the component handles all billing logic including credits | The component only provides webhook registration, customer management, and subscription state mirroring. Custom credit systems, proration logic, and plan change flows must be built manually on top |
| Stripe API versioning | Not pinning the webhook endpoint API version separately from the SDK version | Pin the webhook endpoint's API version in Stripe Dashboard to match the version your code expects. The SDK version (`apiVersion: "2026-01-28.clover"`) and the webhook endpoint version can differ, causing field shape mismatches |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reconciliation cron calling `stripe.invoices.list` for every active customer every hour | Stripe API rate limits (25 req/s live, 100 req/s test), slow cron execution, 429 errors | Batch requests, add jitter, only reconcile customers with recent activity, increase cron interval as customer count grows | 100+ active subscribers (~100 API calls/hour, fine) to 1,000+ (hits rate limits) |
| `selectCanonicalSubscription` collecting ALL subscription records per user on every query | Query latency grows linearly with subscription record count | Add a `.take(10)` limit since users rarely have more than 3-5 subscriptions, or clean up old canceled records | 50+ subscription records per user (unlikely but possible with churn) |
| Credit deduction creating a new `creditTransactions` record for every AI operation | Table grows quickly with heavy AI usage, slows down `by_user` index scans | Consider batching small operations, or archiving old transactions periodically | 100K+ transactions per user (heavy extraction users) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting `metadata.userId` from Stripe webhooks without verification | Attacker could forge metadata if they gain access to Stripe Dashboard or intercept API calls | Always verify the Stripe customer -> user mapping via `billingCustomers` table lookup, not just metadata. The current code does this as a fallback, which is correct |
| Not validating `amountReceived` against expected price for credit top-ups | Users could potentially receive credits for a lower payment if the PaymentIntent is modified | The current code validates `amountReceivedCents >= expectedMinimumAmountCents`, which is correct. Maintain this validation |
| Stripe webhook secret stored as environment variable without rotation | Secret compromise allows forged webhooks | Implement secret rotation process. Use Stripe's recommended pattern of supporting two secrets simultaneously during rotation |
| Credit balance going negative allowing free AI operations | Users consume AI resources without paying | The `deductCredits` mutation checks `totalAvailable < args.amount`, which is correct. Ensure this check is never bypassed. The TOCTOU issue in actions is the gap (see Pitfall 3) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No immediate feedback after plan change -- state depends on webhook | User clicks "Upgrade", nothing changes for seconds/minutes until webhook fires | Optimistically update the UI immediately, then confirm via webhook. Show a "processing" state if the webhook takes more than 2 seconds |
| Credit cap silently blocks monthly grants | Paying user sees no credit increase, assumes billing is broken | Show a clear message: "Credits capped at X. Use credits to receive your full monthly grant." |
| Proration amount not shown before confirming upgrade | User upgrades without knowing what they will be charged today | Call `stripe.invoices.createPreview()` or `stripe.invoices.retrieveUpcoming()` to show the prorated amount before the user confirms |
| Downgrade effective date not communicated clearly | User downgrades, expects immediate price reduction, finds they are still charged at the higher rate until period end | Show: "You will be on the Go plan starting [date]. Until then, you keep all Pro features." |

## "Looks Done But Isn't" Checklist

- [ ] **Upgrade flow:** Often missing immediate invoicing -- verify `proration_behavior: "always_invoice"` is set and a charge actually appears in Stripe
- [ ] **Downgrade flow:** Often missing schedule cleanup on reupgrade -- verify that upgrading after scheduling a downgrade correctly releases the old schedule
- [ ] **Cancellation flow:** Often missing credit expiration -- verify that when a subscription is canceled, remaining free credits are handled (expired, preserved, or clearly communicated)
- [ ] **Webhook idempotency:** Often missing duplicate event handling -- verify that replaying the same Stripe event twice produces the same outcome (check `stripeEventLogs` deduplication)
- [ ] **Credit top-up:** Often missing refund reversal -- verify that `charge.refunded` correctly reverses the credit grant proportionally
- [ ] **Monthly grant:** Often missing cap communication -- verify that users at the free credit cap are informed and the grant outcome is logged
- [ ] **Subscription status sync:** Often missing out-of-order event protection -- verify that a stale `subscription.updated` event does not overwrite a newer state
- [ ] **Payment failure handling:** Often missing grace period logic -- verify that `past_due` subscriptions still grant feature access for a configurable grace period before cutting off credits

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double credit grant | LOW | Query `creditTransactions` for duplicate `stripeInvoiceId`, void the extra grant, adjust `credits.freeBalance` |
| Stale subscription state from out-of-order webhooks | LOW | Re-fetch subscription from Stripe API (`stripe.subscriptions.retrieve`), re-run `syncSubscription` with current data |
| Orphaned subscription schedule causing unexpected downgrade | MEDIUM | List subscription schedules via `stripe.subscriptionSchedules.list`, release any that conflict with the current plan, re-sync subscription |
| Credit balance went negative from TOCTOU race | LOW | Set balance to 0 or absorb the cost. If recurring, implement credit reservation |
| Proration not charged (used `create_prorations` instead of `always_invoice`) | MEDIUM | Generate a manual invoice for the outstanding proration items via `stripe.invoices.create` for the customer, then finalize and pay |
| Cancellation handler created orphan free subscription records | LOW | Query for users with multiple active subscription records, delete the duplicates, ensure canonical resolution logic is correct |
| Free credit cap silently blocked grants for paying users | LOW | Backfill grants using `backfillBillingAndCredits` action after adjusting the cap policy |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Upgrade uses `create_prorations` instead of `always_invoice` | Phase 1: Subscription lifecycle | Stripe dashboard shows immediate charge on upgrade; `invoice.paid` webhook fires within seconds |
| Out-of-order webhook events corrupt state | Phase 1: Webhook hardening | Replay same event twice via Stripe CLI; verify `subscriptions` table shows correct state |
| Credit deduction TOCTOU race | Phase 3: Edge case hardening | Run two concurrent AI operations with near-zero balance; verify no negative balance |
| Double credit grant from overlapping events | Phase 2: Credit system audit | Trigger `invoice.paid` + reconciliation for same invoice; verify single `creditTransactions` entry |
| Subscription schedule leak on plan change | Phase 1: Subscription lifecycle | Upgrade after scheduling downgrade; verify schedule is released in Stripe dashboard |
| Free credit cap blocks monthly grants | Phase 2: Credit system audit | User at cap receives monthly grant; verify cap policy matches business intent |
| Cancellation handler creates orphan records | Phase 1: Subscription lifecycle | Cancel subscription; verify single subscription record per user; resubscribe and verify clean state |
| Stale subscription state from portal changes | Phase 1: Webhook hardening | Change plan via Stripe Customer Portal; verify local state matches |

## Sources

- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) -- `create_prorations` vs `always_invoice` behavior
- [Stripe Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) -- event ordering is not guaranteed
- [Stripe Subscription Schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) -- downgrade deferral patterns
- [Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests) -- API-level idempotency
- [Stripe Webhooks: Solving Race Conditions](https://www.pedroalonso.net/blog/stripe-webhooks-deep-dive/) -- webhook idempotency and optimistic locking patterns
- [The Race Condition You're Probably Shipping Right Now With Stripe Webhooks](https://dev.to/belazy/the-race-condition-youre-probably-shipping-right-now-with-stripe-webhooks-mj4) -- eager sync anti-pattern
- [Billing Webhook Race Condition Solution Guide](https://excessivecoding.com/blog/billing-webhook-race-condition-solution-guide) -- single-writer pattern for webhook handling
- [Stripe: Modify Subscriptions](https://docs.stripe.com/billing/subscriptions/change) -- official guide for plan changes
- [Stripe: Cancel Subscriptions](https://docs.stripe.com/billing/subscriptions/cancel) -- cancellation lifecycle
- [Stripe Customer Invoice Balance](https://docs.stripe.com/billing/customer/balance) -- credit and balance edge cases
- Current codebase analysis: `convex/http.ts`, `convex/subscriptions/actions.ts`, `convex/credits/internal.ts`, `convex/credits/actions.ts`, `convex/ai/helpers.ts`

---
*Pitfalls research for: Stripe billing integration in OpenAlex Count*
*Researched: 2026-02-27*
