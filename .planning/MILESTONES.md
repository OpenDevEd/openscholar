# Milestones

## v1.0 Stripe Integration Audit (Shipped: 2026-02-27)

**Phases completed:** 3 phases, 7 plans
**Git range:** `d0aff9e..ae7c867` (29 commits)
**Files changed:** 38 files, +3181/-172 lines

**Key accomplishments:**
- Webhook handlers re-fetch from Stripe API, eliminating out-of-order event state corruption
- Upgrades charge proration immediately via `always_invoice` with card decline blocking
- Payment failure grace period with auto-downgrade after 7 days and billing UI banner
- Paginated reconciliation cron with dedup contracts for credit grant correctness
- Credit cap banner, checkout processing state with toast, and Buy Credits links throughout UI
- Corrective subscription sync cron and failed event monitoring
- Idempotency and TOCTOU contracts documented on all financial webhook handlers

---


## v1.1 Upgrade Flow (Shipped: 2026-02-27)

**Phases completed:** 3 phases, 6 plans
**Git range:** `326a94f..a49d797` (25 commits)
**Files changed:** 36 files, +4,136/-210 lines

**Key accomplishments:**
- Pinned proration_date between preview and execution so charge matches preview exactly
- Tri-state toast: actual credit count on success, processing message on grant failure, error on card decline
- Webhook-driven backup path grants pro-rata credits when action-path fails (invoice.paid handler)
- Upgrade metadata (fromPlan, toPlan, upgradeTimestamp) written atomically to Stripe subscriptions
- subscription_update firewall prevents double-grants when both action and webhook paths succeed
- Payment method (card brand + last4) and line item breakdown in upgrade confirmation dialog
- Dismiss guard prevents dialog close during processing (Escape, click-outside, close button)
- Full i18n translations for upgrade dialog across 6 locales

**Tech debt carried forward:**
- 9 human verification items requiring Stripe test mode
- 3 pre-existing TypeScript errors in test files (unrelated to milestone)

---

