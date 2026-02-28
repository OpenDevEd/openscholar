# Requirements: OpenAlex Count -- Stripe Integration Audit

**Defined:** 2026-02-28
**Core Value:** Every billing operation produces correct financial outcomes -- the right amount charged, at the right time, with proper proration and user feedback.

## v1.2 Requirements

Requirements for E2E Billing Tests milestone. Each maps to roadmap phases.

### Test Infrastructure

- [x] **INFRA-01**: E2E test framework configured with Playwright billing project, 180s timeout, `workers: 1`, `locale: 'en-US'`
- [x] **INFRA-02**: Fresh Clerk test user created and deleted per test scenario via `@clerk/backend` API
- [x] **INFRA-03**: Webhook waiter utility polls Convex backend for state convergence before UI assertions
- [x] **INFRA-04**: Stripe helpers create subscriptions, attach payment methods, and clean up test objects via API
- [x] **INFRA-05**: Page Object Models for billing page and pricing page with `data-testid` selectors
- [x] **INFRA-06**: `data-testid` attributes added to billing UI components for stable test targeting
- [x] **INFRA-07**: Billing fixture composes user lifecycle, Stripe client, webhook waiter, and auto-cleanup into single test extension

### Subscription

- [x] **SUB-01**: User can subscribe from free to Go plan via checkout-bypass pattern and see plan on billing page
- [x] **SUB-02**: User can subscribe from free to Pro plan via checkout-bypass pattern and see plan on billing page

### Plan Changes

- [x] **PLAN-01**: User can upgrade from Go to Pro via in-app confirmation dialog with proration preview
- [x] **PLAN-02**: User can downgrade from Pro to Go, sees pending-change banner and scheduled badge
- [x] **PLAN-03**: User can cancel a scheduled downgrade to keep current Pro plan

### Cancellation

- [x] **CNCL-01**: User can cancel subscription and billing page shows "Expires on" instead of "Renews on"

### Credits

- [x] **CRED-01**: User receives free signup credits on account creation and sees balance on billing page
- [x] **CRED-02**: User receives correct monthly credits on subscription (3,000 Go / 15,000 Pro)
- [x] **CRED-03**: User receives pro-rata credits on upgrade matching calculated `floor(remainingRatio * creditDelta)`
- [x] **CRED-04**: User can purchase credit topup via checkout-bypass and see increased balance
- [x] **CRED-05**: Free-tier user at credit cap sees cap banner on billing page

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
| INFRA-01 | Phase 7 | Complete |
| INFRA-02 | Phase 7, Phase 13 (hardening) | Complete |
| INFRA-03 | Phase 7 | Complete |
| INFRA-04 | Phase 7 | Complete |
| INFRA-05 | Phase 7 | Complete |
| INFRA-06 | Phase 7 | Complete |
| INFRA-07 | Phase 7 | Complete |
| SUB-01 | Phase 8 | Complete |
| SUB-02 | Phase 8 | Complete |
| PLAN-01 | Phase 8 | Complete |
| PLAN-02 | Phase 9 | Complete |
| PLAN-03 | Phase 9 | Complete |
| CNCL-01 | Phase 9 | Complete |
| CRED-01 | Phase 9, Phase 10 (gap closure) | Complete |
| CRED-02 | Phase 8, Phase 13 (hardening) | Complete |
| CRED-03 | Phase 9 | Complete |
| CRED-04 | Phase 9 | Complete |
| CRED-05 | Phase 9, Phase 10 (gap closure) | Complete |

**Coverage:**
- v1.2 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after gap closure phase creation*
