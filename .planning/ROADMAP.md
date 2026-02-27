# Roadmap: OpenAlex Count -- Stripe Integration Audit

## Overview

This audit fixes three confirmed billing bugs (upgrade proration not charged, out-of-order webhook state corruption, cancellation orphan records), hardens the credit system against edge cases (double grants, abandoned checkouts, reconciliation pagination), and adds operational infrastructure (monitoring, corrective crons, idempotency verification, TOCTOU documentation). The work flows from subscription correctness to credit correctness to operational hardening, following the codebase dependency graph: subscription state must be correct before credit logic can be trusted, and both must be solid before scale-readiness matters.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Subscription Lifecycle Correctness** - Fix the three critical billing bugs and harden subscription state transitions against edge cases
- [ ] **Phase 2: Credit System Correctness** - Verify and fix credit grant idempotency, top-up flow, refund reversal, and free credit cap UX
- [ ] **Phase 3: Operational Hardening** - Add monitoring, corrective cron actions, global idempotency verification, and TOCTOU scale documentation

## Phase Details

### Phase 1: Subscription Lifecycle Correctness
**Goal**: Users experience correct financial outcomes for every subscription change -- upgrades charge immediately, downgrades defer correctly, cancellations leave clean records, and payment failures are handled gracefully
**Depends on**: Nothing (first phase)
**Requirements**: SUB-01, SUB-02, SUB-03, SUB-04, SUB-05, SUB-06
**Success Criteria** (what must be TRUE):
  1. When a user upgrades from Starter to Pro, the proration difference is charged immediately (visible on their Stripe invoice within seconds, not deferred to next cycle)
  2. When two webhook events for the same subscription arrive out of order, the subscription record reflects the latest Stripe state (not the stale event)
  3. When a user cancels their subscription, the existing subscription record is updated in place (no orphan free-plan records created, Stripe subscription ID preserved on the canceled record)
  4. When a user has a scheduled downgrade and changes their payment method or metadata mid-period, the scheduled downgrade is not disrupted
  5. When a user re-upgrades after scheduling a downgrade, the orphaned subscription schedule is fully released and verified null on the subscription object
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- Webhook re-fetch + cancellation fix (SUB-02, SUB-03, SUB-04)
- [x] 01-02-PLAN.md -- Upgrade proration fix + schedule leak prevention (SUB-01, SUB-05)
- [x] 01-03-PLAN.md -- Payment failure UX + grace period (SUB-06)

### Phase 2: Credit System Correctness
**Goal**: Credit grants, top-up purchases, and refund reversals produce correct credit balances under all event combinations, and the free credit cap is communicated clearly to users
**Depends on**: Phase 1
**Requirements**: CRED-01, CRED-02, CRED-03, CRED-04, CRED-05, CRED-06
**Success Criteria** (what must be TRUE):
  1. When the same invoice triggers credit grants via both a webhook and the reconciliation cron, credits are granted exactly once (no double grants)
  2. When a user initiates a credit top-up checkout, completes payment, the credits appear in their balance and the UI updates reactively; if the user abandons checkout, no stale state blocks a new purchase attempt
  3. When a partial refund is issued for a credit purchase, credits are deducted proportionally and reprocessing the refund event produces no additional deduction
  4. When a paying user's free credits are at the cap, the UI displays a clear message explaining the cap and how to receive their full monthly grant
  5. When a customer has more than 100 invoices, the reconciliation cron paginates through all of them (not just the first page)
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Backend correctness: reconciliation pagination fix, dedup contract assertion, negative balance display (CRED-01, CRED-02, CRED-06)
- [ ] 02-02-PLAN.md -- Frontend UX: credit cap banner, top-up processing state + toast, Buy Credits links (CRED-03, CRED-04, CRED-05)

### Phase 3: Operational Hardening
**Goal**: The billing system is observable, self-correcting for stale state, globally idempotent, and has a documented strategy for credit deduction races at scale
**Depends on**: Phase 2
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):
  1. When `checkSubscriptionStatus` detects a subscription whose local state diverges from Stripe, it takes corrective action (syncs from Stripe API) rather than only logging a warning
  2. When a Stripe event in `stripeEventLogs` has `failed` status and remains unresolved for N hours, an alert or monitoring notification is triggered
  3. When any webhook event is delivered multiple times (replayed from Stripe dashboard or retried), reprocessing produces identical outcomes with no side effects
  4. The TOCTOU credit deduction race condition has a documented mitigation strategy with clear criteria for when to implement it (user count threshold or observed incident)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | 0/2 | Not started | - |
| 3. Operational Hardening | 0/2 | Not started | - |
