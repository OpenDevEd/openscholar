# Requirements: OpenAlex Count

**Defined:** 2026-02-27
**Core Value:** Every billing operation produces correct financial outcomes — the right amount charged, at the right time, with proper proration and user feedback.

## v1.1 Requirements

Requirements for the Upgrade Flow milestone. Each maps to roadmap phases.

### Upgrade Correctness

- [ ] **UPGC-01**: User sees exact charge amount in preview that matches what Stripe charges (proration_date pinned between preview and execution)
- [ ] **UPGC-02**: User sees "credits are being processed" message when credit grant fails after successful plan change, not a fake success count
- [ ] **UPGC-03**: User sees actual credits granted in success toast, derived from server response, not the preview estimate
- [ ] **UPGC-04**: changePlan response returns explicit `creditsGranted: 0` on grant failure, not `undefined`

### Upgrade Resilience

- [ ] **UPGR-01**: User receives pro-rata credits via webhook backup path (invoice.paid for proration invoices) if action-path grant fails
- [ ] **UPGR-02**: Stripe subscription metadata carries upgrade context (fromPlan, toPlan, upgradeTimestamp) so webhook handler can classify proration invoices
- [ ] **UPGR-03**: subscription_update invoice firewall in invoiceGrantPolicy verified (with test) to prevent double-grants when both action and webhook paths succeed

### UX Polish

- [ ] **UXPL-01**: User sees payment method (card brand + last 4 digits) in upgrade confirmation dialog
- [ ] **UXPL-02**: User sees proration line item breakdown (credit for unused time + charge for new plan) in confirmation dialog
- [ ] **UXPL-03**: User cannot dismiss confirmation dialog via Escape key or click-outside while upgrade is processing

## Future Requirements

Deferred to after v1.1 is validated in production.

### Credit Grant Reconciliation

- **RECON-01**: Scheduled cron detects missing upgrade_prorate grants and retries them
- **RECON-02**: Dashboard visibility into failed/retried credit grants

### Upgrade UX Enhancements

- **UXEN-01**: Upgrade path suggestions when user runs low on credits
- **UXEN-02**: A/B testing upgrade dialog copy for conversion optimization

## Out of Scope

| Feature | Reason |
|---------|--------|
| Custom proration math | Stripe handles rounding, tax, and currency — bypassing creates discrepancies |
| Rollback upgrade on credit failure | Creates second proration + refund, more disruptive than delayed grant |
| Preview caching | Stripe prorates to the second — cached previews become stale instantly |
| Optimistic UI for credit balance | If grant fails or is capped, displayed balance would be wrong |
| Email confirmation before upgrade | Adds friction; in-app dialog is sufficient |
| Flexible billing mode migration | Requires testing all existing flows; defer to v2+ |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UPGC-01 | — | Pending |
| UPGC-02 | — | Pending |
| UPGC-03 | — | Pending |
| UPGC-04 | — | Pending |
| UPGR-01 | — | Pending |
| UPGR-02 | — | Pending |
| UPGR-03 | — | Pending |
| UXPL-01 | — | Pending |
| UXPL-02 | — | Pending |
| UXPL-03 | — | Pending |

**Coverage:**
- v1.1 requirements: 10 total
- Mapped to phases: 0
- Unmapped: 10

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after initial definition*
