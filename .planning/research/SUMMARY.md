# Project Research Summary

**Project:** OpenAlex Count — Stripe Billing Integration Audit
**Domain:** SaaS billing integration (Stripe subscriptions + credit system) in Convex + Next.js
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

This project is a billing integration audit and hardening effort for an existing, mature Stripe billing system embedded in a Convex + Next.js SaaS application. The codebase already implements all table-stakes billing features — subscription checkout, upgrade/downgrade with proration and subscription schedules, credit grants, credit top-ups, webhook idempotency, invoice reconciliation, and refund reversal. The architecture is fundamentally sound: webhook-driven state sync to Convex, dual credit pools (free + paid), and a belt-and-suspenders approach (webhooks + hourly cron reconciliation). The stack is current, all dependencies are at their latest versions, and the Stripe API version (`2026-01-28.clover`) is handled correctly throughout.

The recommended approach is a targeted audit and fix, not a rebuild. Three specific correctness bugs have been identified: (1) upgrades use `create_prorations` instead of `always_invoice`, meaning the proration difference is not immediately charged; (2) `syncSubscription` lacks timestamp guards, making it vulnerable to out-of-order webhook delivery corrupting subscription state; and (3) `handleSubscriptionCanceled` clears the Stripe subscription ID and creates orphan free-plan records rather than preserving the audit trail. Beyond these bugs, several "looks done but isn't" edge cases need verification: downgrade schedule cleanup on re-upgrade, reconciliation cron pagination, and abandoned checkout handling.

The key risk is silent revenue leakage and user trust erosion from the billing bugs — not system failure. Users can upgrade to Pro, get access, and not be charged the proration difference until their next renewal (or never, if they downgrade first). The mitigation is surgical: fix three specific code paths in `convex/subscriptions/actions.ts` and `convex/subscriptions/internal.ts`, add timestamp-guarded webhook handling, and add monitoring for `stripeEventLogs` with `failed` status. The credit system is well-designed and largely correct — the main credit risk is the free credit cap silently blocking monthly grants for paying users who haven't spent their accumulated credits.

## Key Findings

### Recommended Stack

The existing stack requires no new dependencies. `stripe@20.3.1`, `@convex-dev/stripe@0.1.3`, and `convex@1.32.0` are all at or near their latest versions and are fully compatible. The Stripe API version `2026-01-28.clover` is correctly pinned in both the SDK client instances and the webhook handling code. An optional safe upgrade to `stripe@20.4.0` is available (same API version, bug fixes only).

The critical architectural constraint is the boundary between what `@convex-dev/stripe` handles vs. what must use the Stripe SDK directly. The component handles checkout session creation, customer management, customer portal, webhook routing with signature verification, and cancellation. It does NOT handle subscription plan changes, proration, subscription schedules, invoice retrieval, or proration preview — these require direct Stripe SDK calls. The codebase correctly implements this split.

**Core technologies:**
- `stripe@20.3.1`: Stripe Node.js SDK — all direct Stripe API calls from Convex `"use node"` actions
- `@convex-dev/stripe@0.1.3`: Official Convex component — webhook routing, customer management, checkout sessions
- `convex@1.32.0`: Backend runtime — real-time DB, mutations, actions, scheduler, crons
- Next.js: Frontend — reactive billing UI via Convex hooks, no client-side billing mutations

### Expected Features

All table-stakes features are already implemented. The audit milestone (v1.1) is about verifying correctness and hardening edge cases, not adding features.

**Must have (table stakes) — all implemented:**
- Immediate upgrade with proration — implemented; bug: uses `create_prorations` instead of `always_invoice`
- Deferred downgrade via SubscriptionSchedule — implemented; needs schedule-leak verification
- Cancellation at period end — implemented; bug: cancellation handler creates orphan records
- Webhook idempotency via `stripeEventLogs` — implemented; needs out-of-order event guards
- Monthly credit grants on `invoice.paid` — implemented; free credit cap may silently block grants
- Credit top-up purchases — implemented; edge cases need verification
- Invoice reconciliation cron — implemented; needs pagination check for >100 invoices
- Refund credit reversal — implemented and correct
- Entitlement gating (`isEntitledStatus`) — implemented and correct

**Should have (differentiators) — all implemented:**
- Pending change visibility — "Downgrade scheduled for March 15" messaging in UI
- Smart pending-change cancellation — upgrade clears scheduled downgrade
- Dual credit wallet (free + paid) with free-first deduction
- Exponential backoff retry for credit grants (5s to 5min, 6 attempts)
- Event log with classification for ops debugging
- Backfill action for billing recovery after deployment/migration

**Defer (v2+):**
- Trial period support
- Stripe native Billing Credits API
- Usage-based metered billing via Stripe
- Multi-currency credit purchases
- Team/org billing with seat management
- Retention/churn flows

### Architecture Approach

The architecture follows a strict webhook-driven, Stripe-as-source-of-truth model. Stripe fires events, the Convex HTTP router (via `@convex-dev/stripe` `registerRoutes`) receives and verifies them, dispatches to typed handlers that sync state to Convex DB, and the Next.js UI subscribes reactively. An hourly reconciliation cron provides belt-and-suspenders reliability for missed webhooks. The data model separates concerns cleanly: `subscriptions` and `billingCustomers` mirror Stripe state, while `credits` and `creditTransactions` are app-owned state with no Stripe equivalent.

The dependency graph reveals the natural audit order: pure logic libraries first (zero side effects), then internal mutations, then actions (Stripe API callers), then the webhook router, then crons and consumers, then frontend. This is also the correct fix order — bugs in lower layers propagate upward.

**Major components:**
1. **Webhook Router** (`convex/http.ts`) — receives Stripe events, wraps in `runAuditedStripeHandler`, dispatches to 10 typed handlers; every event lifecycle tracked in `stripeEventLogs`
2. **Subscription Manager** (`convex/subscriptions/`) — checkout sessions, upgrade/downgrade (schedules + direct update), cancellation, state sync; `changePlan` is the primary action
3. **Credit System** (`convex/credits/`) — monthly grants on `invoice.paid`, top-up grants on `payment_intent.succeeded`, deduction on AI usage (free first, then paid), refund reversal on `charge.refunded`
4. **Invoice Grant Policy** (`convex/credits/lib/invoiceGrantPolicy.ts`) — classifies invoices as grant-eligible before any DB writes; prevents double-grants on proration invoices
5. **Schedule Planner** (`convex/subscriptions/lib/schedulePlanning.ts`) — builds Stripe SubscriptionSchedule phases for downgrades; determines change type (upgrade/downgrade/cancel pending)
6. **Reconciliation Cron** (`convex/crons.ts`) — hourly scan of recent paid invoices; safety net for missed webhooks; reports grants triggered vs already-granted

### Critical Pitfalls

1. **Upgrade uses `create_prorations` instead of `always_invoice`** — `create_prorations` creates proration line items but defers the charge to the next billing cycle. Users upgrade, get access, but aren't charged the difference immediately. Fix: use `proration_behavior: "always_invoice"` in `changePlan` for upgrades.

2. **Out-of-order webhook events corrupt subscription state** — Stripe does not guarantee event delivery order. `syncSubscription` unconditionally overwrites local state, so a stale event arriving late reverts the user to an old plan. Fix: compare event timestamps or re-fetch from Stripe API to always apply the canonical current state.

3. **Cancellation handler creates orphan subscription records** — `handleSubscriptionCanceled` clears `stripeSubscriptionId` and inserts a new free-plan record, breaking webhook linkage and accumulating N subscription records per user. Fix: preserve the Stripe ID on canceled records; derive free-plan entitlement from absence of active subscription rather than inserting a phantom record.

4. **Subscription schedule leak on rapid plan changes** — if `stripe.subscriptionSchedules.release()` fails but `stripe.subscriptions.update()` succeeds, the orphaned schedule fires at period end and silently downgrades the user. Fix: verify `subscription.schedule === null` after upgrade; add background check for conflicting orphaned schedules.

5. **Free credit cap silently blocks monthly grants for paying users** — `applyTierFreeCreditCap` returns `actualAdded: 0` when the user is at cap, even for paying subscribers. This is by design but creates a poor UX. Fix: add explicit UI messaging ("Credits capped at X — use credits to receive your full monthly grant"); evaluate whether cap should be higher than `creditsPerMonth` (e.g., 2x for one-month rollover).

## Implications for Roadmap

Based on combined research, the audit has three natural phases ordered by correctness-criticality and component dependency.

### Phase 1: Subscription Lifecycle Fixes

**Rationale:** The three critical billing bugs (proration not charged, out-of-order webhook state corruption, cancellation orphan records) directly affect revenue and data integrity. These are in `convex/subscriptions/` which is a lower-layer component — fixing here first ensures Phase 2 credit work operates on correct subscription state. All three bugs are confirmed by cross-referencing STACK.md (proration behavior), PITFALLS.md (pitfalls 1, 2, 7), and ARCHITECTURE.md (dependency order).

**Delivers:** Correct upgrade proration charges, stable subscription state under concurrent webhooks, clean subscription record lifecycle (no orphan records).

**Addresses:** Pitfall 1 (`create_prorations` → `always_invoice`), Pitfall 2 (timestamp guards on `syncSubscription`), Pitfall 7 (cancellation handler refactor), Pitfall 5 (schedule leak post-upgrade verification).

**Key files:** `convex/subscriptions/actions.ts` (changePlan proration), `convex/subscriptions/internal.ts` (syncSubscription guards, handleSubscriptionCanceled), `convex/subscriptions/lib/schedulePlanning.ts` (schedule leak check).

### Phase 2: Credit System Audit and Monitoring

**Rationale:** Credit logic depends on correct subscription state (Phase 1). The credit system itself is largely correct — the risks are edge cases (double-grant verification, cap UX, reconciliation pagination) and missing observability (no alerts for `stripeEventLogs` with `failed` status that go unresolved). This phase makes the system production-observable.

**Delivers:** Verified credit grant idempotency under all event combinations, free credit cap communicated clearly in UI, reconciliation cron handles >100 invoices, failed-event monitoring in place, `checkSubscriptionStatus` cron takes corrective action (currently only logs).

**Addresses:** Pitfall 4 (double-grant verification), Pitfall 6 (free credit cap UX), reconciliation pagination edge case, abandoned checkout edge case.

**Key files:** `convex/credits/internal.ts` (grantMonthlyCredits idempotency), `convex/credits/actions.ts` (reconciliation pagination), `convex/crons.ts` (checkSubscriptionStatus corrective action), billing UI credit cap messaging.

### Phase 3: Edge Case Hardening and Scale Prep

**Rationale:** The credit deduction TOCTOU race (Pitfall 3) is not urgent at current scale but becomes important before significant user growth. Technical debt patterns (type safety, `internal as any` casts) should be addressed while the codebase is actively being modified. Scale bottlenecks (reconciliation cron, creditTransactions table growth) need a documented strategy even if not yet implemented.

**Delivers:** Documented TOCTOU mitigation strategy (optimistic pre-check accepted or credit reservation implemented), Stripe event object types in webhook handlers (replace `any`), documented scaling plan for reconciliation cron at 1k-100k users.

**Addresses:** Pitfall 3 (TOCTOU credit deduction race), technical debt in type safety, scaling considerations from ARCHITECTURE.md.

**Key files:** `convex/ai/helpers.ts` (withAuthAndCreditsBatch TOCTOU), `convex/http.ts` (Stripe event type safety), `convex/crons.ts` (scaling documentation).

### Phase Ordering Rationale

- Phase 1 before Phase 2 because subscription state correctness is a prerequisite for credit logic correctness — if `syncSubscription` reverts state, credit grants for the wrong plan follow.
- Phase 2 before Phase 3 because monitoring and verified idempotency must be in place before handling scale where race conditions become frequent.
- Phase 3 is not optional if user growth is expected — the TOCTOU issue becomes a real revenue leak at scale, not just a theoretical concern.
- The dependency graph from ARCHITECTURE.md confirms this order: pure libs → internal mutations → actions → webhook router → crons/consumers → frontend.

### Research Flags

Phases with standard, well-documented patterns (no additional research needed):
- **Phase 1:** Stripe proration behavior is fully documented (`always_invoice` vs `create_prorations`). Subscription schedule lifecycle is well-specified. Implementation changes are surgical.
- **Phase 2:** Credit idempotency patterns are established. Convex cron pagination is standard. No novel integration required.
- **Phase 3:** TOCTOU mitigation options are well-understood (reserve/hold pattern, optimistic accept). Stripe event typing is available from the Stripe SDK.

No phases require `/gsd:research-phase` — all required patterns are fully covered by existing research with HIGH confidence.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry on 2026-02-27; `@convex-dev/stripe` source code read directly from node_modules; Stripe API version confirmed against official changelog |
| Features | HIGH | Codebase analysis of all billing modules; implementation status verified by reading source, not inferred; Stripe official docs confirm expected behavior |
| Architecture | HIGH | Direct codebase analysis; dependency graph built from actual imports; all component boundaries verified; data flow traced through webhook handlers |
| Pitfalls | HIGH | Each pitfall cross-referenced against Stripe official docs and codebase; warning signs are specific and observable; recovery strategies are concrete |

**Overall confidence:** HIGH

### Gaps to Address

- **Proration behavior intent:** The PROJECT.md states "Upgrade flow charges the proration difference immediately" but `create_prorations` is currently used. The fix to `always_invoice` is clear, but the team should confirm whether there are any edge cases (free trial periods, coupon codes) where `always_invoice` behaves unexpectedly. Verify in Stripe test mode before deploying to production.
- **Cancellation handler refactor scope:** Changing `handleSubscriptionCanceled` to not insert a free-plan record requires auditing all callers of `selectCanonicalSubscription` to confirm they handle "no subscription record" correctly (returning free-plan entitlement from `resolveEffectivePlan` rather than from a DB record). This is a behavioral change that needs integration testing.
- **`checkSubscriptionStatus` corrective action:** The current cron only logs warnings. What corrective action it should take is undefined — this requires a business decision (e.g., cancel stale subscriptions? notify users? sync from Stripe?). Flag for product discussion before Phase 2.
- **Free credit cap policy:** Whether the cap should be higher than `creditsPerMonth` (to allow rollover) is a business decision, not a technical one. Phase 2 should include a product discussion before changing the cap values.

## Sources

### Primary (HIGH confidence)

- [Stripe API Changelog: Clover](https://docs.stripe.com/changelog/clover) — API version verification
- [Stripe Basil: Item-level billing periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) — `current_period_end` migration
- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) — `create_prorations` vs `always_invoice` behavior
- [Stripe Subscription Schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) — downgrade deferral pattern and schedule lifecycle
- [Stripe Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) — event types and ordering guarantees
- [Stripe Cancel Subscriptions](https://docs.stripe.com/billing/subscriptions/cancel) — cancellation lifecycle
- [Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests) — idempotency key patterns
- [`@convex-dev/stripe` source code](https://github.com/get-convex/stripe) — component capabilities verified via installed `node_modules/@convex-dev/stripe/src/client/index.ts`
- Codebase analysis: `convex/subscriptions/`, `convex/credits/`, `convex/http.ts`, `convex/crons.ts`, `convex/ai/helpers.ts`, `convex/lib/`, `lib/billing/entitlements.ts` (all files read directly)
- npm registry queries (`npm view`) — installed vs latest version verification

### Secondary (MEDIUM confidence)

- [Stripe Billing Credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) — native credit system for comparison; Stripe's credits feature is still maturing
- [Stigg: Stripe Webhook Best Practices](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks) — webhook integration lessons
- [Billing Webhook Race Condition Solution Guide](https://excessivecoding.com/blog/billing-webhook-race-condition-solution-guide) — single-writer pattern for webhook handling
- [Stripe Webhooks: Solving Race Conditions](https://www.pedroalonso.net/blog/stripe-webhooks-deep-dive/) — webhook idempotency patterns

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
