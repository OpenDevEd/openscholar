# Phase 8: Subscription and Upgrade Specs - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E test specs verifying the two highest-value billing flows: new subscription (free to Go, free to Pro) and plan upgrade (Go to Pro). Tests use the Phase 7 billing fixture, page objects, and checkout-bypass helpers against real Stripe sandbox and Clerk test mode. This phase produces runnable spec files, not infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Spec file organization
- Two spec files: `e2e/billing/specs/subscribe.spec.ts` and `e2e/billing/specs/upgrade.spec.ts`
- Use `describe` + `test` blocks (not flat `test()` calls)
- Each test is fully independent — gets its own fresh Clerk user via the billing fixture
- No shared state or sequential coupling between tests

### Assertion strategy
- After subscribing: verify plan name, credit balance (total only), AND active status badge on billing page
- After subscribing: also navigate to pricing page and verify "Current Plan" badge appears on the subscribed plan
- Credit balance checks use total credits only (no free vs paid breakdown)
- After upgrade: verify credit balance updated to reflect Pro-level credits

### Upgrade proration dialog
- Verify the upgrade confirmation dialog appears and is visible
- Verify dialog mentions plan names (upgrading from Go to Pro)
- Do NOT assert exact proration dollar amounts (volatile, depends on subscription timing)
- Click confirm and verify outcome on billing page

### Upgrade test setup
- Upgrade test is fully self-contained: creates fresh user, subscribes to Go via checkout-bypass, waits for sync, then performs in-app upgrade to Pro
- After upgrade, verify pricing page also updates ("Current Plan" badge moves from Go to Pro)

### Plan breakdown
- 08-01: Subscribe specs (`subscribe.spec.ts`) — Go and Pro subscription tests
- 08-02: Upgrade spec (`upgrade.spec.ts`) — Go-to-Pro upgrade test
- Both plans run in parallel (wave 1) — no dependencies between them
- All tests run against real Stripe sandbox (not mocked)

### Claude's Discretion
- Exact `describe` block naming and test descriptions
- Wait timing between checkout-bypass and UI assertions (use webhook waiter patterns from Phase 7)
- Any additional page object methods needed beyond what Phase 7 provides
- Error handling for flaky network conditions in test setup

</decisions>

<specifics>
## Specific Ideas

- Subscribe tests cover both Go (3,000 credits) and Pro (15,000 credits) as separate test cases within one describe block
- Upgrade test should verify the full journey: subscribe Go → see Go on billing page → trigger upgrade → see proration dialog with plan names → confirm → see Pro on billing page → see Pro credits → see Pro on pricing page
- Tests should be ~10-15 lines each (leveraging the billing fixture from Phase 7)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-subscription-and-upgrade-specs*
*Context gathered: 2026-02-28*
