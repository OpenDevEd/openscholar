# Phase 9: Lifecycle and Credit Specs - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E test specs covering the remaining billing lifecycle flows: downgrade (Pro to Go), cancel scheduled downgrade, cancel subscription, free signup credits, pro-rata upgrade credits, credit topup, and free credit cap banner. Tests use the Phase 7 billing fixture and Phase 8 patterns (checkout-bypass, webhook waiter, page objects) against real Stripe sandbox. This phase produces runnable spec files, not infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Spec file organization
- Three spec files mirroring logical flow groups:
  - `e2e/billing/specs/downgrade.spec.ts` — downgrade Pro→Go + cancel scheduled downgrade (PLAN-02, PLAN-03)
  - `e2e/billing/specs/cancel.spec.ts` — cancel subscription (CNCL-01)
  - `e2e/billing/specs/credits.spec.ts` — free signup credits, pro-rata upgrade credits, credit topup, free credit cap (CRED-01, CRED-03, CRED-04, CRED-05)
- Use `describe` + `test` blocks (consistent with Phase 8)
- Each test is fully independent — fresh Clerk user via billing fixture, no shared state

### Downgrade & cancel assertions
- Downgrade test: after triggering downgrade, assert pending-change banner is visible on billing page and contains downgrade-related text
- Downgrade test: assert scheduled badge appears on the Go plan card (not Pro)
- Cancel downgrade test: after canceling the scheduled change, assert pending-change banner disappears and Pro remains active
- Cancel subscription test: assert billing page shows "Expires on" instead of "Renews on" after cancellation
- Do NOT assert exact dates in banners (volatile, timing-dependent) — assert text patterns only

### Credit verification approach
- Free signup credits (CRED-01): assert exact expected balance for a fresh free user (known fixed amount)
- Pro-rata upgrade credits (CRED-03): calculate expected pro-rata at test time using `floor(remainingRatio * creditDelta)` from the Stripe subscription's current_period timestamps, then assert the displayed balance matches within a small tolerance (±1 credit for rounding)
- Credit topup (CRED-04): subscribe user first, record balance, purchase topup via checkout-bypass, assert balance increased by the known topup amount
- Free credit cap (CRED-05): create a free user at or above the credit cap, assert cap banner is visible on billing page
- All credit checks use total balance only (consistent with Phase 8 — no free vs paid breakdown)

### Test setup patterns
- Every test is fully self-contained: creates fresh user → sets up required state → performs action → asserts → cleans up
- Downgrade tests: create user → subscribe Pro via checkout-bypass → wait for sync → trigger downgrade via UI → assert
- Cancel downgrade: create user → subscribe Pro → trigger downgrade → cancel the downgrade → assert Pro restored
- Cancel subscription: create user → subscribe to a plan → cancel → assert expiry
- Credit topup: create user → subscribe → record credits → topup via checkout-bypass → assert increase
- Pro-rata credits: create user → subscribe Go → upgrade to Pro → calculate expected pro-rata → assert credits
- No sequential coupling between tests

### Plan breakdown
- 09-01: Downgrade and cancel specs (`downgrade.spec.ts`, `cancel.spec.ts`) — 3 tests total
- 09-02: Credit specs (`credits.spec.ts`) — 4 tests total
- Both plans can run in parallel (wave 1) — no dependencies between them

### Claude's Discretion
- Exact `describe` block naming and test descriptions
- Wait timing between actions and UI assertions (use webhook waiter patterns)
- Any additional page object methods or data-testid attributes needed
- How to drive the free credit cap state (pre-seed via API or consume credits in test)
- How to trigger downgrade and cancel actions in the UI (discover from existing components)

</decisions>

<specifics>
## Specific Ideas

- Follow Phase 8 test style: ~10-20 lines per test, leveraging billing fixture for setup/cleanup
- Downgrade and cancel-downgrade tests are a natural pair — both start with a Pro subscription
- Pro-rata credit test should calculate expected value from Stripe API timestamps rather than hardcoding, since the ratio depends on when in the billing cycle the upgrade happens
- Credit topup test needs a known topup product/price — use checkout-bypass pattern like subscribe tests

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-lifecycle-and-credit-specs*
*Context gathered: 2026-02-28*
