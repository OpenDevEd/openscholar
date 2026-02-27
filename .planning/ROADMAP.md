# Roadmap: OpenAlex Count -- Stripe Billing

## Milestones

- **v1.0 Stripe Integration Audit** -- Phases 1-3 (shipped 2026-02-27)
- **v1.1 Upgrade Flow** -- Phases 4-6 (in progress)

## Phases

<details>
<summary>v1.0 Stripe Integration Audit (Phases 1-3) -- SHIPPED 2026-02-27</summary>

- [x] Phase 1: Subscription Lifecycle Correctness (3/3 plans) -- completed 2026-02-27
- [x] Phase 2: Credit System Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 3: Operational Hardening (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### v1.1 Upgrade Flow (In Progress)

**Milestone Goal:** Fix the broken upgrade flow so it reliably charges, syncs, and grants credits -- with a confirmation dialog so users know what they are paying before committing.

- [ ] **Phase 4: Upgrade Correctness** - Fix proration date drift, credit grant failure handling, and success toast accuracy
- [ ] **Phase 5: Upgrade Resilience** - Add webhook-driven credit grant backup path for durable recovery
- [ ] **Phase 6: UX Polish** - Payment method display, line item breakdown, and dialog dismiss guard

## Phase Details

### Phase 4: Upgrade Correctness
**Goal**: Users can upgrade their subscription and receive correct charges and credits every time
**Depends on**: Phase 3
**Requirements**: UPGC-01, UPGC-02, UPGC-03, UPGC-04
**Success Criteria** (what must be TRUE):
  1. User sees a proration amount in the confirmation dialog that exactly matches the amount Stripe charges (proration_date pinned between preview and execution)
  2. User sees "credits are being processed" message when credit grant fails after a successful plan change, never a fake credit count
  3. User sees actual credits granted in the success toast, derived from the server response, not the preview estimate
  4. When credit grant fails, the changePlan response explicitly returns creditsGranted: 0, not undefined
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — Server-side: pin proration_date between preview and execution, make creditsGranted non-optional
- [x] 04-02-PLAN.md — Client-side: tri-state toast logic, prorationDate passthrough, i18n keys

### Phase 5: Upgrade Resilience
**Goal**: Users receive their pro-rata credits even when the primary grant path fails
**Depends on**: Phase 4 (webhook backup path depends on upgrade metadata written to Stripe in Phase 4)
**Requirements**: UPGR-01, UPGR-02, UPGR-03
**Success Criteria** (what must be TRUE):
  1. User receives pro-rata credits via the invoice.paid webhook backup path when the action-path credit grant fails
  2. Stripe subscription metadata carries upgrade context (fromPlan, toPlan, upgradeTimestamp) after every upgrade operation
  3. When both action and webhook paths succeed, the user receives exactly one credit grant -- not two (invoiceGrantPolicy firewall verified with test)
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Write upgrade metadata to Stripe subscription + subscription_update firewall regression test
- [ ] 05-02-PLAN.md — Extend processInvoiceForGrant with upgrade proration detection via webhook backup path

### Phase 6: UX Polish
**Goal**: Users have full visibility into what they are paying and cannot accidentally disrupt an in-progress upgrade
**Depends on**: Phase 5 (cosmetic work ships after reliability is confirmed)
**Requirements**: UXPL-01, UXPL-02, UXPL-03
**Success Criteria** (what must be TRUE):
  1. User sees their payment method (card brand + last 4 digits) in the upgrade confirmation dialog
  2. User sees proration line item breakdown (credit for unused time + charge for new plan) in the confirmation dialog
  3. User cannot dismiss the confirmation dialog via Escape key or click-outside while an upgrade is processing
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md -- Backend getUpgradePreview extension + dialog component (payment method, line items, dismiss guard)
- [ ] 06-02-PLAN.md -- i18n keys for all 6 locales + human verification checkpoint

## Progress

**Execution Order:** Phase 4 -> Phase 5 -> Phase 6

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | v1.0 | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | v1.0 | 2/2 | Complete | 2026-02-27 |
| 3. Operational Hardening | v1.0 | 2/2 | Complete | 2026-02-27 |
| 4. Upgrade Correctness | v1.1 | 2/2 | Complete | 2026-02-27 |
| 5. Upgrade Resilience | v1.1 | 1/2 | In Progress | - |
| 6. UX Polish | v1.1 | 0/0 | Not started | - |
