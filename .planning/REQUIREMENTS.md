# Requirements: OpenAlex Count -- Stripe Integration Audit

**Defined:** 2026-02-28
**Core Value:** Every billing operation produces correct financial outcomes -- the right amount charged, at the right time, with proper proration and user feedback.

## v1.2 Requirements

Requirements for E2E Billing Tests milestone. Each maps to roadmap phases.

### Test Infrastructure

- [ ] **INFRA-01**: E2E test framework configured with Playwright billing project, 180s timeout, `workers: 1`, `locale: 'en-US'`
- [ ] **INFRA-02**: Fresh Clerk test user created and deleted per test scenario via `@clerk/backend` API
- [ ] **INFRA-03**: Webhook waiter utility polls Convex backend for state convergence before UI assertions
- [ ] **INFRA-04**: Stripe helpers create subscriptions, attach payment methods, and clean up test objects via API
- [ ] **INFRA-05**: Page Object Models for billing page and pricing page with `data-testid` selectors
- [ ] **INFRA-06**: `data-testid` attributes added to billing UI components for stable test targeting
- [ ] **INFRA-07**: Billing fixture composes user lifecycle, Stripe client, webhook waiter, and auto-cleanup into single test extension

### Subscription

- [ ] **SUB-01**: User can subscribe from free to Go plan via checkout-bypass pattern and see plan on billing page
- [ ] **SUB-02**: User can subscribe from free to Pro plan via checkout-bypass pattern and see plan on billing page

### Plan Changes

- [ ] **PLAN-01**: User can upgrade from Go to Pro via in-app confirmation dialog with proration preview
- [ ] **PLAN-02**: User can downgrade from Pro to Go, sees pending-change banner and scheduled badge
- [ ] **PLAN-03**: User can cancel a scheduled downgrade to keep current Pro plan

### Cancellation

- [ ] **CNCL-01**: User can cancel subscription and billing page shows "Expires on" instead of "Renews on"

### Credits

- [ ] **CRED-01**: User receives free signup credits on account creation and sees balance on billing page
- [ ] **CRED-02**: User receives correct monthly credits on subscription (3,000 Go / 15,000 Pro)
- [ ] **CRED-03**: User receives pro-rata credits on upgrade matching calculated `floor(remainingRatio * creditDelta)`
- [ ] **CRED-04**: User can purchase credit topup via checkout-bypass and see increased balance
- [ ] **CRED-05**: Free-tier user at credit cap sees cap banner on billing page

## Future Requirements

### Deferred to live-billing integration suite

- **LIVE-01**: Recurring payment cycle credit grants (requires Stripe test clocks, incompatible with browser checkout)
- **LIVE-02**: Payment failure E2E (requires Stripe Checkout iframe automation -- anti-feature)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automating Stripe Checkout card entry | Stripe actively blocks automated testing of hosted checkout page; use checkout-bypass pattern |
| Automating Stripe Customer Portal UI | Portal is a Stripe-hosted iframe; bypass via API |
| Visual regression / screenshot tests | Separate concern, notoriously flaky, not billing-specific |
| Per-locale billing page testing | Locale-specific rendering is a visual concern, not a billing logic concern |
| Testing webhook delivery mechanism | E2E tests assert UI outcomes, not infrastructure mechanisms |
| Duplicating live-billing backend assertions | E2E answers "does the user see the right thing?", not "does the backend do the right thing?" |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 7 | Pending |
| INFRA-02 | Phase 7 | Pending |
| INFRA-03 | Phase 7 | Pending |
| INFRA-04 | Phase 7 | Pending |
| INFRA-05 | Phase 7 | Pending |
| INFRA-06 | Phase 7 | Pending |
| INFRA-07 | Phase 7 | Pending |
| SUB-01 | Phase 8 | Pending |
| SUB-02 | Phase 8 | Pending |
| PLAN-01 | Phase 8 | Pending |
| PLAN-02 | Phase 9 | Pending |
| PLAN-03 | Phase 9 | Pending |
| CNCL-01 | Phase 9 | Pending |
| CRED-01 | Phase 9 | Pending |
| CRED-02 | Phase 8 | Pending |
| CRED-03 | Phase 9 | Pending |
| CRED-04 | Phase 9 | Pending |
| CRED-05 | Phase 9 | Pending |

**Coverage:**
- v1.2 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation*
