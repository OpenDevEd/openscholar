# Project Research Summary

**Project:** v1.1 Upgrade Flow (OpenAlex Count)
**Domain:** Stripe subscription upgrade flow — proration preview, pro-rata credit grants, atomic operations
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

The v1.1 milestone is a surgical bug-fix and reliability hardening of an existing Stripe upgrade flow, not a greenfield feature build. The core architecture (Convex action + Stripe API + reactive mutations) is already correct. All required technologies are installed. The broken behavior — users charged but not credited — stems from three implementation gaps, not missing infrastructure: the `proration_date` is not pinned between preview and execution, credit grant failures are silently swallowed, and the success toast falls back to a preview estimate rather than actual granted credits.

The recommended approach is a dual-path convergence pattern: the `changePlan` action performs an optimistic credit grant for immediate UX, while the `invoice.paid` webhook provides an authoritative, idempotent backup path. This resolves the "paid but not credited" state without introducing complexity — no workflow engine, no rollback logic, no new dependencies. The key insight is that `grantUpgradeProRataCredits` is already idempotent via a `grantType + fromPlan + toPlan + period` dedup key, so both paths calling it is safe and produces exactly one grant.

The primary risk is misclassifying proration invoices as monthly subscription invoices, which would cause double-grants. This risk is already mitigated by `invoiceGrantPolicy.ts` listing `subscription_update` as a non-recurring billing reason — but that firewall requires a regression test. Secondary risk is the `proration_date` drift between preview and execution, which is trivially fixed by passing the timestamp round-trip through the client. There are no architectural surprises; this is a well-documented Stripe pattern with established solutions.

## Key Findings

### Recommended Stack

No new dependencies are required. The existing stack fully covers v1.1 requirements. The broken upgrade flow is a coordination logic problem, not a missing library problem. Every technology needed for proration preview, atomic upgrade operations, confirmation dialogs, and pro-rata credit grants is already installed and partially implemented. See `.planning/research/STACK.md` for full version compatibility matrix.

**Core technologies:**
- `stripe@^20.3.0` (API `2026-01-28.clover`): Proration preview via `invoices.createPreview()`, atomic upgrade via `subscriptions.update()` with `error_if_incomplete` — already used correctly, no upgrade needed
- `convex@^1.31.7`: OCC-atomic mutations for credit grants, action coordination for Stripe calls — architecture is correct, three implementation gaps need fixing
- `@radix-ui/react-dialog@^1.1.15`: Confirmation dialog — already built as `upgrade-confirmation-dialog.tsx`, needs minor refinements
- `sonner@^2.0.7`: Success/failure toast feedback — already integrated, needs toast message logic fix for `creditsGranted: undefined` case
- `next-intl@^4.8.2`: Localized currency formatting in dialog — already implemented across 6 languages, no changes needed

### Expected Features

**Must have (table stakes — v1.1, all correctness-critical):**
- Proration preview before confirming upgrade with pinned `proration_date` — partially implemented; critical fix required to align preview timestamp with execution
- Immediate plan upgrade with correct proration charge — already works correctly via `always_invoice` + `error_if_incomplete`; no changes needed to the Stripe call itself
- Pro-rata credit grant on upgrade — implemented but fragile; credit grant failure is silently non-fatal with no retry or recovery path
- Atomic upgrade flow with clear success/failure states — primary bug: charge can succeed while credit grant silently fails, leaving user with wrong credit count
- Upgrade error recovery (card declined, network failure) — already correct; `error_if_incomplete` ensures no partial Stripe state on payment failure
- Accurate success feedback showing actual granted credits — broken; toast falls back to `upgradePreview.proRataCredits` when `creditsGranted` is `undefined`
- Confirmation dialog preventing accidental upgrades — implemented; needs keyboard-dismiss guard verification during upgrade execution

**Should have (differentiators — v1.x, add after v1.1 validation):**
- Payment method display in confirmation dialog — `cardBrand` and `cardLast4` already available in `subscriptionDetails`, just needs threading into dialog
- Proration line item breakdown — `preview.lines.data` already returned by Stripe, not yet extracted
- Upgrade credit grant reconciliation cron — extend existing cron to catch missed upgrade grants

**Defer (v2+):**
- Flexible billing mode migration (Stripe recommendation for more accurate prorations, requires all-flow regression)
- Upgrade path suggestions based on credit usage patterns
- A/B testing upgrade dialog copy

### Architecture Approach

The system uses a dual-path convergence pattern: the `changePlan` action performs an optimistic credit grant for fast user feedback, and the `invoice.paid` webhook provides the authoritative backup path that catches action failures. Both paths call the same idempotent `grantUpgradeProRataCredits` mutation, which deduplicates by `grantType + fromPlan + toPlan + period`. The critical firewall is that `invoiceGrantPolicy.ts` must classify `subscription_update` invoices as non-recurring, preventing the webhook from triggering monthly credit grants on proration invoices. See `.planning/research/ARCHITECTURE.md` for full data flow diagrams.

**Major components:**
1. `getUpgradePreview` action — read-only proration preview from Stripe; already implemented; needs `proration_date` returned in response
2. `changePlan` action — executes Stripe upgrade + optimistic sync + optimistic credit grant; needs `proration_date` passed in, upgrade metadata written to Stripe subscription, and explicit failure handling for credit grant step
3. `grantUpgradeProRataCredits` mutation — idempotent credit grant with dedup; already correct, no changes needed
4. `invoice.paid` webhook handler — authoritative backup path; needs extension to classify proration invoices and trigger upgrade credit grants
5. `upgrade-confirmation-dialog.tsx` — UI gate for two-step confirm flow; already built, needs `proration_date` threading and improved toast messaging for grant failure case

### Critical Pitfalls

1. **Charge succeeds but credit grant fails silently (Pitfall 2 in PITFALLS.md)** — The current `try/catch` logs the error as non-fatal but has no retry or recovery path. Users are charged, their plan changes, and they receive zero pro-rata credits with a success toast. Fix: schedule a retry via `ctx.scheduler.runAfter()` on grant failure, and return `creditsGranted: undefined` explicitly so the UI shows "credits will appear shortly" rather than claiming a specific count.

2. **Preview-to-execution amount mismatch (Pitfall 3)** — Stripe prorates to the second; `proration_date` is independently computed at preview time and at execution time, causing drift. Fix: return `proration_date` from `getUpgradePreview`, pass it through the client to `changePlan`, and supply it to `stripe.subscriptions.update()` as the `proration_date` parameter. Two field additions; trivial.

3. **Proration invoice triggers monthly credit grant (Pitfall 6)** — If `invoiceGrantPolicy.ts` ever classifies `subscription_update` billing_reason as eligible for monthly grants, users receive double credits. The firewall is in place but must be protected by a regression test. Fix: add a unit test asserting `classifyMonthlyCreditInvoice({ invoiceBillingReason: "subscription_update", ... })` always returns `ignore_non_recurring`.

4. **Action-webhook race on subscription sync (Pitfall 1)** — Both `changePlan` action and the `customer.subscription.updated` webhook call `syncLocalSubscriptionFromStripe`. The race is currently benign, but requires a documented ownership contract to prevent future breakage: action owns optimistic sync and credit grant; webhook is the authoritative idempotent convergence path.

5. **Period date staleness for credit calculation (Pitfall 7)** — `changePlan` reads `currentPeriodStart/End` from the pre-update subscription object. Although `always_invoice` does not reset billing periods, reading these from the post-update return value of `stripe.subscriptions.update()` is a defensive fix worth making.

## Implications for Roadmap

Based on combined research, the work divides into two focused phases: correctness fixes (the known bug), then reliability hardening (idempotent webhook backup path + edge cases). A third optional phase covers UX polish.

### Phase 1: Fix the Broken Upgrade Flow

**Rationale:** The three correctness bugs (proration date drift, silent credit grant failure, inaccurate success toast) must be fixed before any other work. These are the root cause of the production bug. All fixes are logic changes within existing files — no new infrastructure, no new dependencies.

**Delivers:** A reliable upgrade flow where the proration amount shown matches the amount charged, credit grant failures are retried and communicated to the user, and the success toast reflects actual granted credits (not a preview estimate).

**Addresses (from FEATURES.md):**
- Pin `proration_date` between preview and execution (P1)
- Handle credit grant failure visibility (P1)
- Fix success toast for `creditsGranted: undefined` (P1)
- Verify dialog cannot be double-submitted via keyboard dismiss (P1)

**Avoids (from PITFALLS.md):**
- Pitfall 3: Preview-to-execution amount mismatch
- Pitfall 2: Charge succeeds but credits silently not granted
- Pitfall 7: Pre-update period dates used for credit calculation

**Files touched:** `convex/subscriptions/actions.ts`, `convex/credits/internal.ts`, `components/Pricing.tsx`, `components/billing/upgrade-confirmation-dialog.tsx`, `messages/*.json` (toast text)

**Research flag:** Standard patterns. Implementation is fully specified across STACK.md, FEATURES.md, and ARCHITECTURE.md. No additional research needed.

---

### Phase 2: Add Webhook-Driven Credit Grant Backup Path

**Rationale:** The Phase 1 retry (`ctx.scheduler.runAfter()`) handles transient Convex failures, but does not cover the case where the entire `changePlan` action context fails before the retry is scheduled. The webhook-driven path provides a durable, independently-triggered convergence mechanism that catches all remaining failure modes.

**Delivers:** Credit grants resilient to action failures. Even if `changePlan` crashes after the Stripe charge succeeds, the `invoice.paid` webhook will detect the proration invoice, classify it as an upgrade, and trigger the same idempotent grant mutation.

**Addresses (from FEATURES.md):**
- Credit grant guarantee with reconciliation fallback (P2 differentiator)

**Avoids (from PITFALLS.md):**
- Pitfall 1: Action-webhook race (requires documented ownership contract + firewall comments)
- Pitfall 6: Proration invoice triggering monthly credit grant (requires unit test for `invoiceGrantPolicy.ts`)

**Build order (dependency-aware — must follow this sequence):**
1. Add upgrade metadata (`upgradeFromPlan`, `upgradeToPlan`, `upgradeTimestamp`) to `stripe.subscriptions.update()` call in `changePlan` — this is the data contract the webhook handler will read
2. Extend invoice classification in `invoiceGrantPolicy.ts` / `processInvoiceForGrant` to detect `billing_reason === "subscription_update"` + upgrade metadata
3. Wire `invoice.paid` webhook handler to call the extended classifier and trigger upgrade credit grants
4. Verify idempotency end-to-end: action path + webhook path = exactly one grant

**Files touched:** `convex/subscriptions/actions.ts`, `convex/credits/lib/invoiceGrantPolicy.ts`, `convex/credits/actions.ts`, `convex/http.ts`

**Research flag:** Architecture is fully specified. Invoice classification requires careful testing against real Stripe test-mode events to confirm `billing_reason` values match expectations. Validate in Stripe test mode before deploying.

---

### Phase 3: UX Polish and Edge Case Hardening (Optional)

**Rationale:** Once the core upgrade flow is reliable in production, address differentiating UX features and rare edge cases. All data required already exists in the system.

**Delivers:** A polished upgrade experience and protection against rare edge cases (rapid re-upgrade, credit cap mismatches between preview and actual grant).

**Addresses (from FEATURES.md):**
- Payment method display in confirmation dialog (card brand/last4 already in `subscriptionDetails`)
- Proration line item breakdown (line items already in `preview.lines.data`, not yet extracted)

**Avoids (from PITFALLS.md):**
- Pitfall 4: Rapid re-upgrade double grant (UI cooldown + broad dedup consideration)
- Pitfall 10: Credit cap interaction with preview amount (align `applyTierFreeCreditCap` in preview calculation)

**Research flag:** Standard patterns. Skip `/gsd:research-phase`. These are UI additions using data from existing APIs.

---

### Phase Ordering Rationale

- Phase 1 before Phase 2 because the webhook backup path depends on upgrade metadata written to Stripe during Phase 1. Deploying the webhook handler before the metadata exists would cause silent classification failures.
- Phase 2 before Phase 3 because UX polish is low-value if the underlying grant mechanism is unreliable. Confirm Phase 2 works in production before investing in optional polish.
- Phases 1 and 2 directly address the reported production bug; Phase 3 is optional and can be deferred based on user feedback.
- The idempotency of `grantUpgradeProRataCredits` is the load-bearing assumption for Phase 2. This must be verified before Phase 2 deploys.

### Research Flags

Phases needing attention during implementation:
- **Phase 2 (invoice classification):** Detecting upgrade proration invoices via `billing_reason === "subscription_update"` + subscription metadata is sound, but validate that real Stripe test-mode proration invoices carry the expected `billing_reason` value before shipping. If the behavior differs, the classification silently fails to trigger grants (no double-grant risk, but backup path is ineffective).

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1:** Every fix is clearly specified in research with no ambiguity. Straight implementation.
- **Phase 3:** UI additions using data already returned by existing APIs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions confirmed compatible. No new dependencies. Validated against installed `package.json` and Stripe API changelog. |
| Features | HIGH | Derived from Stripe official docs + direct codebase analysis. Table stakes match Stripe's documented proration patterns exactly. Implementation gaps confirmed by reading source code, not inferred. |
| Architecture | HIGH | Dual-path convergence is the Convex-recommended pattern for Stripe integrations. Data flow verified against actual code in `convex/subscriptions/actions.ts` and `convex/http.ts`. |
| Pitfalls | HIGH | Each pitfall verified against the actual codebase (confirmed to exist in current code), Stripe docs (proration_date warning is explicit), and Convex docs (non-transactional actions). Not inferred — observed. |

**Overall confidence:** HIGH

### Gaps to Address

- **Stripe `billing_reason` for proration invoices:** Research confirms `invoice.paid` fires with `billing_reason: "subscription_update"` for proration invoices created by `always_invoice`. This should be verified in a Stripe test environment before Phase 2 deploys. If the value differs in practice, the webhook classifier in Phase 2 will need adjustment.
- **Credit cap behavior in preview:** The `applyTierFreeCreditCap` calculation in `getUpgradePreview` may not match the cap applied in `grantUpgradeProRataCredits` if the user's free credit balance changes between preview and execution. This edge case affects users with high free balances near the Pro cap. Address in Phase 3 by aligning the cap calculation in the preview action.
- **Webhook retry on Phase 2 handler failure:** If the `invoice.paid` webhook handler fails in the Phase 2 code path, Stripe retries the webhook with exponential backoff up to 72 hours. The idempotency of the classification + grant must hold under repeated delivery. Confirm `grantUpgradeProRataCredits` handles this correctly (it already deduplicates, so this should be satisfied).

## Sources

### Primary (HIGH confidence)
- [Stripe Prorations Documentation](https://docs.stripe.com/billing/subscriptions/prorations) — `proration_date` alignment, `always_invoice` behavior, preview-then-confirm workflow
- [Stripe Create Preview Invoice API](https://docs.stripe.com/api/invoices/create_preview) — `subscription_details` parameters, response shape for preview
- [Stripe Update Subscription API](https://docs.stripe.com/api/subscriptions/update) — `payment_behavior: error_if_incomplete` semantics; `always_invoice` creates and immediately charges proration invoice
- [Stripe Invoice Preview API Deprecations](https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations) — `GET /v1/invoices/upcoming` removed in `2025-03-31.basil`, confirmed `createPreview` is the correct replacement
- [Convex Actions Documentation](https://docs.convex.dev/functions/actions) — non-transactional semantics, `ctx.runMutation` from actions, error handling responsibility
- [Convex OCC and Atomicity](https://docs.convex.dev/database/advanced/occ) — mutation atomicity guarantees, automatic retry on OCC conflict
- Codebase review: `convex/subscriptions/actions.ts`, `convex/credits/internal.ts`, `convex/credits/lib/invoiceGrantPolicy.ts`, `convex/http.ts`, `components/billing/upgrade-confirmation-dialog.tsx`, `components/Pricing.tsx`

### Secondary (MEDIUM confidence)
- [Stripe Pending Updates](https://docs.stripe.com/billing/subscriptions/pending-updates) — why `pending_if_incomplete` is not recommended for upgrade flows
- [Convex Workflow Component](https://www.convex.dev/components/workflow) — durable workflow capabilities; confirmed NOT appropriate for this use case (fast operation, Stripe provides payment atomicity, credit grant has webhook fallback)
- [Stripe Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) — event ordering, `customer.subscription.updated` and `invoice.paid` timing relative to API call response
- [Billing Webhook Race Condition Solution Guide](https://excessivecoding.com/blog/billing-webhook-race-condition-solution-guide) — idempotent sync pattern for action-webhook races
- SaaS proration UX patterns (Stigg, Chargebee, Zenskar) — industry standard confirmation dialog content and required information

### Tertiary (LOW confidence)
- [`customer.subscription.updated` webhook issue with @convex-dev/stripe](https://github.com/get-convex/stripe/issues/7) — known issue with priceId not updating in component state; relevant only if `@convex-dev/stripe` is ever used for subscription updates (currently it is not)

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
