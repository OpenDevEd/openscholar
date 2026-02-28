# Roadmap: OpenAlex Count -- Stripe Billing

## Milestones

- **v1.0 Stripe Integration Audit** -- Phases 1-3 (shipped 2026-02-27)
- **v1.1 Upgrade Flow** -- Phases 4-6 (shipped 2026-02-27)
- **v1.2 E2E Billing Tests** -- Phases 7-9 (in progress)

## Phases

<details>
<summary>v1.0 Stripe Integration Audit (Phases 1-3) -- SHIPPED 2026-02-27</summary>

- [x] Phase 1: Subscription Lifecycle Correctness (3/3 plans) -- completed 2026-02-27
- [x] Phase 2: Credit System Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 3: Operational Hardening (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Upgrade Flow (Phases 4-6) -- SHIPPED 2026-02-27</summary>

- [x] Phase 4: Upgrade Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 5: Upgrade Resilience (2/2 plans) -- completed 2026-02-27
- [x] Phase 6: UX Polish (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

### v1.2 E2E Billing Tests (In Progress)

**Milestone Goal:** Comprehensive Playwright E2E tests exercising every billing flow through the actual UI against Clerk test mode, Stripe sandbox, and Convex dev backend.

- [ ] **Phase 7: Test Infrastructure Foundation** - Support utilities, fixtures, page object models, and data-testid attributes
- [ ] **Phase 8: Subscription and Upgrade Specs** - E2E specs for subscription creation, upgrade flow, and subscription credit grants
- [ ] **Phase 9: Lifecycle and Credit Specs** - E2E specs for downgrade, cancellation, credit topup, pro-rata credits, and free credit cap

## Phase Details

### Phase 7: Test Infrastructure Foundation
**Goal**: A developer can write a billing E2E test in a few lines using the fixture and page objects, with correct isolation, cleanup, and webhook timing built in
**Depends on**: Phase 6 (v1.1 codebase is the system under test)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07
**Success Criteria** (what must be TRUE):
  1. Running `npx playwright test --project=billing` executes the billing test project with 180s timeout, serial execution, and en-US locale
  2. A test using the billing fixture gets a fresh Clerk user that is signed in and cleaned up automatically after the test ends
  3. A test can call the webhook waiter to block until Convex reflects a subscription or credit state change before making UI assertions
  4. A test can use the billing page and pricing page objects to assert on plan name, credit balance, and subscription status without raw CSS selectors
  5. Billing UI components have stable `data-testid` attributes that page objects target
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md -- Add data-testid attributes to billing UI components
- [ ] 07-02-PLAN.md -- Configure billing Playwright project, Stripe helpers, webhook waiter
- [ ] 07-03-PLAN.md -- Create page object models and billing test fixture

### Phase 8: Subscription and Upgrade Specs
**Goal**: The two highest-value billing flows -- new subscription and upgrade -- are covered by E2E tests that verify the user sees correct plan, credits, and proration in the browser
**Depends on**: Phase 7
**Requirements**: SUB-01, SUB-02, PLAN-01, CRED-02
**Success Criteria** (what must be TRUE):
  1. A test subscribes a free user to the Go plan via checkout-bypass and the billing page shows the Go plan with 3,000 credits
  2. A test subscribes a free user to the Pro plan via checkout-bypass and the billing page shows the Pro plan with 15,000 credits
  3. A test upgrades a Go user to Pro via the in-app confirmation dialog, sees the proration preview, confirms, and the billing page shows Pro
  4. Credit balances displayed on the billing page after subscription match the expected grant amounts (3,000 for Go, 15,000 for Pro)
**Plans**: TBD

Plans:
- [x] 08-01: Subscribe spec with Go and Pro checkout-bypass tests
- [x] 08-02: Upgrade spec with Go-to-Pro confirmation dialog test

### Phase 9: Lifecycle and Credit Specs
**Goal**: The remaining billing lifecycle flows -- downgrade, cancellation, credit topup, pro-rata upgrade credits, and free credit cap -- are covered by E2E tests
**Depends on**: Phase 8
**Requirements**: PLAN-02, PLAN-03, CNCL-01, CRED-01, CRED-03, CRED-04, CRED-05
**Success Criteria** (what must be TRUE):
  1. A test downgrades a Pro user to Go and the billing page shows a pending-change banner and a scheduled badge on the Go card
  2. A test cancels a scheduled downgrade and the billing page returns to showing Pro as the active plan without a pending-change banner
  3. A test cancels a subscription and the billing page shows "Expires on" instead of "Renews on"
  4. A test verifies a new free user receives signup credits and the billing page displays the correct balance
  5. A test upgrades Go to Pro and verifies the pro-rata credit grant matches the calculated `floor(remainingRatio * creditDelta)`
  6. A test purchases a credit topup via checkout-bypass and the billing page shows the increased balance
  7. A test verifies a free-tier user at the credit cap sees the cap banner on the billing page
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | v1.0 | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | v1.0 | 2/2 | Complete | 2026-02-27 |
| 3. Operational Hardening | v1.0 | 2/2 | Complete | 2026-02-27 |
| 4. Upgrade Correctness | v1.1 | 2/2 | Complete | 2026-02-27 |
| 5. Upgrade Resilience | v1.1 | 2/2 | Complete | 2026-02-27 |
| 6. UX Polish | v1.1 | 2/2 | Complete | 2026-02-27 |
| 7. Test Infrastructure Foundation | v1.2 | 3/3 | Complete | 2026-02-28 |
| 8. Subscription and Upgrade Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 9. Lifecycle and Credit Specs | v1.2 | 0/? | Not started | - |
