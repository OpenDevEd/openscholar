# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Stripe Integration Audit

**Shipped:** 2026-02-27
**Phases:** 3 | **Plans:** 7 | **Commits:** 29

### What Was Built
- Webhook handlers re-fetch from Stripe API on every event (eliminates out-of-order state corruption)
- Immediate proration charging on upgrade with card decline blocking
- Payment failure grace period (7 days) with auto-downgrade and billing UI banner
- Paginated reconciliation cron with 500-invoice safety cap and dedup contracts
- Credit cap banner, checkout return processing with reactive toast, Buy Credits links
- Corrective subscription sync cron and failed event monitoring
- Idempotency and TOCTOU contracts documented on all financial webhook handlers

### What Worked
- Three-phase structure (SUB -> CRED -> INFRA) following dependency graph kept work focused
- Consistent 3min average per plan — all 7 plans completed in ~21 minutes total
- Audit-first approach: understanding existing code before changing it prevented regressions
- Documentation-only plans (03-02 idempotency contracts) were fast and high-value

### What Was Inefficient
- Phase 2/3 plans not marked `[x]` in ROADMAP.md during execution (only Phase 1 was)
- Milestone audit had to be run twice (first after Phase 1, then after all phases)
- `getUpgradePreview` action was built in Phase 1 but has no UI consumer yet (Phase 4)

### Patterns Established
- `IDEMPOTENCY CONTRACT` and `TOCTOU CONTRACT` JSDoc patterns for financial handler audit trails
- Webhook re-fetch pattern: always `stripe.subscriptions.retrieve()` before syncing
- In-place update pattern for cancellation (no orphan records)
- Reactive checkout return pattern: capture balance on return, watch Convex subscription, fire toast on delta

### Key Lessons
1. Stripe webhook event payloads can arrive out of order — always re-fetch from API before syncing local state
2. `always_invoice` + `error_if_incomplete` together give immediate proration with card decline safety
3. Documentation-as-code (JSDoc contracts) is a high-value, low-risk deliverable for audit milestones
4. Convex JS runtime cannot use the Stripe npm package directly — must use internalActions in Node runtime

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 7 plans in ~21 minutes — consistent velocity with no blockers

---

## Milestone: v1.1 — Upgrade Flow

**Shipped:** 2026-02-27
**Phases:** 3 | **Plans:** 6 | **Commits:** 25

### What Was Built
- Proration date pinning between preview and execution (exact charge match)
- Tri-state toast feedback: actual credits on success, processing on grant failure, error on card decline
- Webhook-driven backup path for pro-rata credit grants via invoice.paid handler
- Upgrade metadata atomically written to Stripe subscriptions for webhook classification
- subscription_update firewall preventing double-grants (with regression test)
- Payment method display (card brand + last4) in upgrade confirmation dialog
- Proration line item breakdown (credit for unused + charge for new plan)
- Dismiss guard preventing dialog close during upgrade processing
- Full i18n translations for upgrade dialog across 6 locales

### What Worked
- Phase dependency chain (Correctness -> Resilience -> UX) meant each phase built cleanly on the last
- Average 2min per plan — all 6 plans completed in ~13 minutes total (faster than v1.0)
- Research phase before planning caught important details (Stripe billing_reason values, Radix dialog events)
- Atomic metadata write pattern eliminated a class of stale-data races in webhook handling

### What Was Inefficient
- ROADMAP.md plan checkboxes not updated during execution (same issue as v1.0)
- totalCharge i18n key had to be added as a deviation in Plan 01 to prevent runtime error — should have been in Plan 02's scope from the start
- paymentMethod i18n key added to all 6 locales but not consumed in JSX (caught by audit, one-line fix)

### Patterns Established
- Proration date pinning: capture timestamp at preview, thread through to execution call
- Dual-path convergence: action grants credits immediately, webhook grants as backup, dedup prevents doubles
- Radix dismiss prevention: onEscapeKeyDown + onPointerDownOutside + onInteractOutside for processing states
- Fresh Stripe API read for period boundaries (avoids stale local DB when webhook fires before sync)

### Key Lessons
1. Always thread server-reported values to UI — never fall back to preview estimates for financial amounts
2. Webhook backup paths need metadata written atomically in the same API call as the primary action
3. i18n keys should be planned alongside the component code that consumes them, not in a separate plan
4. Radix Dialog requires three separate event handlers for complete dismiss prevention (Escape, pointer, interact)

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 6 plans in ~13 minutes — 38% faster per-plan than v1.0

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Plans | Avg/Plan | Key Change |
|-----------|---------|--------|-------|----------|------------|
| v1.0 | 29 | 3 | 7 | 3min | Established billing audit patterns |
| v1.1 | 25 | 3 | 6 | 2min | Dual-path convergence, i18n integration |

### Top Lessons (Verified Across Milestones)

1. Always re-fetch from Stripe API before syncing — event payloads and local DB can be stale (v1.0 + v1.1)
2. ROADMAP.md plan checkboxes not updating during execution — recurring process gap (v1.0 + v1.1)
3. Audit-first approach prevents regressions and catches orphaned code (v1.0 audit, v1.1 i18n key catch)
