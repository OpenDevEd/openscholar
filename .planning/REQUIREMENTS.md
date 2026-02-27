# Requirements: OpenAlex Count — Stripe Integration Audit

**Defined:** 2026-02-27
**Core Value:** Every billing operation produces correct financial outcomes — the right amount charged, at the right time, with proper proration and user feedback.

## v1 Requirements

Requirements for the audit milestone. Each maps to roadmap phases.

### Subscription Lifecycle

- [x] **SUB-01**: Upgrade charges the proration difference immediately via `always_invoice` (not deferred to next cycle)
- [x] **SUB-02**: `syncSubscription` guards against out-of-order webhook events using timestamp comparison or Stripe API re-fetch
- [x] **SUB-03**: Cancellation handler preserves Stripe subscription ID on canceled records instead of creating orphan free-plan records
- [x] **SUB-04**: Downgrade schedule survives mid-period subscription updates (payment method change, metadata update)
- [x] **SUB-05**: Schedule leak is prevented on re-upgrade — verify `subscription.schedule === null` after upgrade; detect orphaned schedules
- [ ] **SUB-06**: Payment failure handling correctly transitions to `past_due` and retains user access during grace period

### Credit System

- [ ] **CRED-01**: Credit grant deduplication handles same-invoice-ID across different event IDs (no double grants)
- [ ] **CRED-02**: Reconciliation cron handles API pagination for customers with >100 invoices
- [ ] **CRED-03**: Abandoned checkout sessions don't leave stale state or block new checkout attempts
- [ ] **CRED-04**: Free credit cap communicates clearly in UI when grants are blocked ("Credits capped at X — use credits to receive your full monthly grant")
- [ ] **CRED-05**: Credit top-up purchase flow is correct end-to-end (Checkout → payment_intent.succeeded → credit grant → UI update)
- [ ] **CRED-06**: Refund credit reversal proportionally deducts credits and handles partial refund idempotency

### Infrastructure

- [ ] **INFRA-01**: `checkSubscriptionStatus` cron takes corrective action on stale/expired subscriptions (not just log warnings)
- [ ] **INFRA-02**: Failed Stripe events (`stripeEventLogs` with `failed` status) trigger monitoring/alerting if unresolved within N hours
- [ ] **INFRA-03**: All webhook handlers are idempotent — reprocessing the same event produces identical outcomes
- [ ] **INFRA-04**: TOCTOU credit deduction race condition is documented with mitigation strategy for scale

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Billing Features

- **BILL-01**: Trial period support with configurable duration per plan
- **BILL-02**: Multi-currency credit purchases (beyond USD-only)
- **BILL-03**: Team/org billing with seat management
- **BILL-04**: Retention flows (cancellation survey, discount offers)
- **BILL-05**: Stripe native Billing Credits API integration
- **BILL-06**: Usage-based metered billing reported to Stripe

## Out of Scope

| Feature | Reason |
|---------|--------|
| New subscription tiers or pricing changes | Audit correctness of existing tiers, not pricing strategy |
| Migrating away from @convex-dev/stripe | Work within existing integration |
| Stripe Connect / marketplace payments | Not applicable to this product |
| Mobile payment flows (Apple Pay, Google Pay) | Web-only product |
| Custom proration logic (bypass Stripe) | Use Stripe's built-in proration; custom logic creates divergence |
| Immediate downgrade with refund | Industry standard is deferred; already implemented correctly |
| Real-time credit deduction notifications | Notification fatigue during batch AI operations |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SUB-01 | Phase 1 | Complete |
| SUB-02 | Phase 1 | Complete |
| SUB-03 | Phase 1 | Complete |
| SUB-04 | Phase 1 | Complete |
| SUB-05 | Phase 1 | Complete |
| SUB-06 | Phase 1 | Pending |
| CRED-01 | Phase 2 | Pending |
| CRED-02 | Phase 2 | Pending |
| CRED-03 | Phase 2 | Pending |
| CRED-04 | Phase 2 | Pending |
| CRED-05 | Phase 2 | Pending |
| CRED-06 | Phase 2 | Pending |
| INFRA-01 | Phase 3 | Pending |
| INFRA-02 | Phase 3 | Pending |
| INFRA-03 | Phase 3 | Pending |
| INFRA-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation*
