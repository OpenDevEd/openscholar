# Project Research Summary

**Project:** OpenAlex Count — v1.2 E2E Billing Tests
**Domain:** Playwright E2E test suite for SaaS billing flows (Stripe + Clerk + Convex + Next.js)
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

This milestone adds a browser-level E2E test suite that validates the user-visible billing flows in OpenAlex Count: subscribing to a plan, upgrading, downgrading, cancelling, and purchasing credit top-ups. The project already has a mature Vitest live-billing integration test suite that covers backend correctness (webhook idempotency, credit grant logic, Stripe API interactions). The E2E suite is deliberately scoped to cover what integration tests cannot: UI reactivity after webhook processing, in-app upgrade dialog behavior, redirect flows, and billing page rendering. No new npm packages are required — all tooling (`@playwright/test`, `@clerk/testing`, `@clerk/backend`, `stripe`) is already installed.

The central architectural decision is a hybrid approach to Stripe Checkout. Stripe's hosted checkout page (`checkout.stripe.com`) has security measures that actively prevent reliable automated card-filling. Attempting to fill card details there is the number one source of flakiness in billing test suites. The recommended approach: verify that the app generates the correct redirect URL in the browser, then complete the payment server-side via Stripe API using `tok_visa`, navigate to the return URL, and verify the UI updates correctly. In-app flows that stay on your domain (upgrade confirmation dialog, downgrade, plan display) are tested fully in the browser end-to-end.

The most significant risks are timing-related: Stripe webhooks are delivered asynchronously (1–30 seconds) and must be processed by Convex before the UI reflects updated state. The mitigation is a polling-based `WebhookWaiter` utility (built on the existing `waitForCondition` pattern from `tests/live-billing/support.ts`) that confirms backend state convergence before asserting on the UI. Test isolation is enforced by creating a fresh Clerk user per test scenario — different Stripe customer IDs mean in-flight webhooks from one test cannot contaminate another. Sequential execution (`workers: 1`) is mandatory due to a confirmed `@clerk/testing` bug with concurrent workers.

## Key Findings

### Recommended Stack

No new dependencies are required. The full stack for E2E billing tests is already installed. The work is entirely about writing test infrastructure code (fixtures, page object models, utilities) and spec files. See `.planning/research/STACK.md` for full details.

**Core technologies:**
- `@playwright/test ^1.58.2`: E2E test runner — already configured with `webServer` auto-start, `fullyParallel: false`, `workers: 1` in CI
- `@clerk/testing ^1.14.1`: `clerkSetup()`, `clerk.signIn()`, `clerk.loaded()` — already used in `e2e/global.setup.ts`
- `@clerk/backend ^2.32.1`: `createClerkClient()` for programmatic user creation/deletion — already used in global setup
- `stripe ^20.3.0`: Stripe API client for server-side subscription creation, cleanup, and state verification — already used in live-billing tests
- `convex ^1.31.7`: Convex CLI (`npx convex run`) for backend function invocation — already used in live-billing tests

**Configuration changes needed:**
- Increase `playwright.config.ts` test timeout from 120s to 180s (billing flows include Stripe roundtrips + webhook processing)
- Increase `expect.timeout` from 15s to 30s
- Add `locale: 'en-US'` to prevent locale-dependent currency formatting failures in assertions

### Expected Features

The test suite must cover two priority tiers. See `.planning/research/FEATURES.md` for full coverage matrix and dependency graph.

**Must have (table stakes — P0):**
- Subscription creation E2E (free to Go, free to Pro) — the primary revenue conversion path
- Upgrade E2E (Go to Pro via in-app confirmation dialog) — highest-value test, stays fully in-app
- Downgrade E2E (Pro to Go via subscription schedule) — verify pending-change banner and scheduled badge
- Cancellation E2E — verify billing page shows "Expires on" after cancel
- Credit grant on subscription — assert exact credit amounts (3,000 for Go, 15,000 for Pro)
- Credit top-up purchase E2E — full checkout-bypass flow for credit bundles
- Test infrastructure (fixtures, utilities, cleanup) — foundational; every other test depends on it

**Should have (differentiators — P1):**
- Upgrade pro-rata credit verification — assert calculated `floor(remainingRatio * creditDelta)` matches UI
- Free credit capping behavior — cap banner visible for free-tier users at cap
- Downgrade cancel / keep current plan — verify scheduled downgrade can be cancelled via UI
- Credit top-up return state handling — "Processing purchase" banner + URL cleanup on `?topup=success`

**Defer (not for this milestone):**
- Recurring payment cycle credit grant — keep in existing Vitest live-billing suite (test clocks are incompatible with Checkout-created customers)
- Payment failure E2E — requires Checkout iframe automation (explicitly an anti-feature); live-billing suite already covers this
- Per-locale billing page screenshots — visual regression is a separate concern and notoriously flaky

**Anti-features to avoid:**
- Automating Stripe Checkout or Customer Portal UI — Stripe explicitly blocks this; tests break on Stripe's update schedule, not yours
- Testing webhook delivery itself — tests should assert outcomes (UI state), not mechanisms (webhook arrival)
- Duplicating live-billing integration test assertions in E2E — E2E answers "does the USER see the right thing?", not "does the BACKEND do the right thing?"

### Architecture Approach

The architecture follows a two-layer hybrid strategy: browser automation for in-app flows (upgrade dialog, downgrade, plan display) and server-side Stripe API orchestration for flows that involve Stripe-hosted pages (subscription checkout, credit top-up). Page Object Models isolate DOM selectors from test logic. A central `billingFixture` composes all test infrastructure — Stripe client, Convex CLI runner, fresh test user lifecycle, and cleanup — into a single extended Playwright test object. See `.planning/research/ARCHITECTURE.md` for full POM implementations and data flow diagrams.

**Major components to build:**
1. `e2e/support/clerk-user.ts` — fresh Clerk user creation/deletion via Backend API; no deps on other new files
2. `e2e/support/stripe-helpers.ts` — attach payment methods, create subscriptions via Stripe API; configure with `maxNetworkRetries: 3`
3. `e2e/support/webhook-waiter.ts` — poll Convex CLI to confirm webhook-driven state convergence before UI assertions
4. `e2e/fixtures/billing.fixture.ts` — composes all three support modules into a Playwright fixture with automatic teardown
5. `e2e/pages/billing.page.ts` — POM for `/settings/billing`; depends on `data-testid` additions to UI components
6. `e2e/pages/pricing.page.ts` — POM for `/pricing` including upgrade dialog fragment; depends on `data-testid` additions
7. `e2e/billing/*.spec.ts` — 7 spec files organized by billing flow (subscribe, upgrade, downgrade, cancellation, credit-grant, credit-topup, free-credit-cap)

**Existing components that need minor changes:**
- `components/billing/credit-balance-card.tsx`, `credit-topup-card.tsx`, `upgrade-confirmation-dialog.tsx`, `components/Pricing.tsx`, `app/settings/billing/page.tsx` — add `data-testid` attributes for stable POM selectors
- `playwright.config.ts` — add billing test project, increase timeouts, set `locale: 'en-US'`
- `package.json` — add `test:e2e:billing` script

### Critical Pitfalls

1. **Webhook timing flakiness** — Never use `page.waitForTimeout()`. Always poll Convex state via `WebhookWaiter` (2s intervals, 60s timeout) before navigating to the UI for final assertions. The two-phase approach (backend convergence then UI assertion) eliminates the most common E2E flake source.

2. **Stripe Checkout automation brittleness** — Do not automate `checkout.stripe.com`. Use the Stripe API to create subscriptions server-side, then navigate the browser to the return URL. Reserve any direct Checkout page interaction for at most one smoke test; remove it if it proves flaky.

3. **Cross-test state pollution via shared Convex backend** — Use a fresh Clerk user per test scenario. Different users have different Stripe customer IDs, so late-arriving webhooks from Test A cannot contaminate Test B. After cleanup, allow a short settling period for in-flight webhooks to exhaust before the next test creates state.

4. **Clerk concurrent worker authentication timeout** — `clerk.signIn()` has a confirmed bug with `workers >= 2` (GitHub issue #7891). Set `workers: 1` globally (not just in CI) and document the constraint.

5. **Orphaned Stripe test objects from failed tests** — Implement a global cleanup sweep at the START of the test suite that queries Stripe for test-email-pattern customers and deletes them before creating new state. Configure the Stripe client with `maxNetworkRetries: 3` to handle sandbox rate limits (25 ops/sec cap).

## Implications for Roadmap

The natural build order is driven by dependency chains: support utilities must exist before fixtures, fixtures before page objects, page objects before specs. The phase structure below follows this dependency order. All four research files agree on the same phase groupings.

### Phase 1: Test Infrastructure Foundation

**Rationale:** Every billing spec depends on the support utilities, fixtures, and stable DOM selectors. Building these first means each subsequent phase can focus purely on test scenario logic. This phase addresses infrastructure-level pitfalls before they can affect actual test writing — specifically Pitfalls 1, 2, 4, 5, 7, 8, 10, and 12 (the majority of pitfalls are infrastructure concerns, not spec-level concerns).

**Delivers:** A complete, reusable test harness. At the end of this phase, a developer can write a billing test with a handful of lines using the fixture and POM, and it will have correct isolation, cleanup, and timing behavior out of the box.

**Addresses (from FEATURES.md):** Test infrastructure (fixtures, utilities, cleanup)

**Implements:**
- `e2e/support/clerk-user.ts` — fresh user creation with `skipPasswordChecks: true`, Convex user sync verification after Clerk webhook
- `e2e/support/stripe-helpers.ts` — `attachTestPaymentMethod`, `createGoSubscription`, `createProSubscription`, `cleanupStripeForTestUser`; wraps existing live-billing patterns; Stripe client configured with `maxNetworkRetries: 3`
- `e2e/support/webhook-waiter.ts` — `WebhookWaiter` class polling Convex CLI for `subscriptionSynced`, `creditGrantForInvoice`, `planEquals`
- `e2e/fixtures/billing.fixture.ts` — extends Playwright test with `stripeClient`, `testUser`, `signInAsTestUser`, `waitForWebhook`, and automatic teardown (Stripe cancel + Convex reset + Clerk delete)
- Add `data-testid` attributes to billing UI components (prerequisite for stable POM selectors)
- `e2e/pages/billing.page.ts` and `e2e/pages/pricing.page.ts` — POMs with `expectPlan()`, `expectStatus()`, `expectCreditBalanceAtLeast()`, upgrade dialog fragment
- `playwright.config.ts` updates: billing test project, 180s timeout, 30s expect timeout, `locale: 'en-US'`, global cleanup sweep in `globalSetup`

**Avoids:** Pitfall 4 (`workers: 1` enforced), Pitfall 7 (global cleanup sweep in `globalSetup`), Pitfall 8 (Stripe client retry config), Pitfall 12 (fixed locale)

**Research flag:** Standard patterns, well-documented. Skip `gsd:research-phase` — implementation patterns are fully specified in the research files with working code examples. The existing `tests/live-billing/support.ts` provides proven reference implementations for most utilities.

### Phase 2: Core Subscription and Upgrade Specs

**Rationale:** Subscription creation is the foundational billing operation — every other flow (upgrade, downgrade, cancel) requires an active subscription as a precondition. The upgrade dialog is the highest-value target because it is the v1.1 feature most exposed to regressions and involves the most UI components. These specs generate the most confidence per line of test code.

**Delivers:** Coverage of the primary revenue path (free to paid) and the primary upsell path (Go to Pro). These are the two flows most financially impactful if they break silently.

**Addresses (from FEATURES.md):** Subscription creation E2E (both tiers), Upgrade E2E, Credit grant on subscription

**Implements:**
- `e2e/billing/subscribe.spec.ts` — free to Go and free to Pro using checkout-bypass pattern; verifies redirect URL generated, plan visible on billing page, credit balance shown
- `e2e/billing/upgrade.spec.ts` — full browser flow (Pattern 3, in-app only): upgrade dialog opens, proration amount displayed, confirm button triggers upgrade, success toast appears, billing page shows Pro
- `e2e/billing/credit-grant.spec.ts` — assert exact credit amounts (3,000 / 15,000) on billing page after subscription and after upgrade

**Avoids:** Pitfall 3 (checkout bypass for subscription specs), Pitfall 5 (coverage matrix — not duplicating live-billing backend assertions), Pitfall 6 (mandate at least one `page.locator()` assertion per test)

**Research flag:** Standard patterns. Upgrade dialog (full-browser flow) and checkout bypass are both fully specified in ARCHITECTURE.md with code examples. Skip `gsd:research-phase`.

### Phase 3: Downgrade, Cancellation, Credits, and Edge Cases

**Rationale:** These flows build on the subscription and upgrade tests and share the same infrastructure. They can be implemented once Phase 2 specs prove the fixture and POM layers work correctly under real conditions. Grouping them in one phase avoids context-switching between infrastructure work and spec writing.

**Delivers:** Complete lifecycle coverage (subscribe, upgrade, downgrade, cancel) plus credit-specific flows (top-up purchase, free credit cap). All P0 and P1 features covered.

**Addresses (from FEATURES.md):** Downgrade E2E, Cancellation E2E, Credit top-up E2E, Free credit capping, Upgrade pro-rata credit verification, Downgrade cancel / keep current plan

**Implements:**
- `e2e/billing/downgrade.spec.ts` — Pro to Go via subscription schedule; verifies pending-change banner, "Scheduled" badge on Go card, plan still shows Pro before billing boundary
- `e2e/billing/cancellation.spec.ts` — cancel via Stripe API (bypass portal); billing page shows "Expires on" instead of "Renews on"
- `e2e/billing/credit-topup.spec.ts` — checkout-bypass flow for credit bundles; "Processing purchase" banner, credit balance increases reactively
- `e2e/billing/free-credit-cap.spec.ts` — cap banner visible for free-tier users at limit
- P1 differentiators: pro-rata credit verification within `upgrade.spec.ts`; downgrade cancel / keep current plan within `downgrade.spec.ts`

**Avoids:** Pitfall 3 (cancellation is API-driven, no portal iframe), Pitfall 9 (test clock constraints — subscription renewal stays in live-billing suite), Pitfall 14 (Stripe portal redirect — verify URL generation only, drive cancellation via API)

**Research flag:** Cancellation and downgrade via Stripe API follow the same patterns as subscription creation. Credit top-up checkout-bypass is identical to subscription checkout-bypass. Skip `gsd:research-phase`.

### Phase 4: Configuration, CI, and Hardening

**Rationale:** Once all specs are working locally, finalize CI integration, add failure artifact capture, and document operational requirements (Convex deployment stability, periodic Stripe sandbox maintenance).

**Delivers:** A reliable, maintainable CI pipeline that does not require manual intervention to keep the Stripe sandbox clean or the tests green.

**Implements:**
- `package.json` `test:e2e:billing` script with correct env setup
- CI pipeline configuration (separate billing E2E job from unit/integration jobs)
- Artifact capture on failure: billing snapshot + Stripe event list saved as test artifacts for debugging
- Operational documentation: Convex deployment must be stable (`convex deploy` before E2E, not `convex dev`); periodic Stripe sandbox cleanup schedule
- Validation of the "looks done but isn't" checklist from PITFALLS.md

**Research flag:** May benefit from a brief `gsd:research-phase` if the specific CI provider has constraints around external network access to `api.stripe.com` or secrets management for billing API keys. Otherwise standard CI configuration.

### Phase Ordering Rationale

- Infrastructure before specs is mandatory: fixtures and POMs have no value without the support utilities beneath them
- Subscribe before upgrade: the upgrade spec requires an active subscription as a precondition; the subscribe spec also validates the fixture infrastructure under real conditions for the first time
- Downgrade and cancel after upgrade: these are lower-risk flows (less financial impact if they regress) and share patterns already proven in Phase 2
- CI hardening last: ensures artifact capture and timeout budgets are tuned against real test output rather than theoretical estimates

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 4 (CI):** If the CI provider has unusual constraints around external network calls to Stripe's sandbox or secrets management for billing API keys, a brief `gsd:research-phase` is warranted.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Infrastructure):** All patterns are fully specified in STACK.md and ARCHITECTURE.md with working code examples. The existing `tests/live-billing/support.ts` provides proven reference implementations for most utilities.
- **Phase 2 (Subscribe + Upgrade):** Checkout-bypass and full-browser upgrade dialog patterns are both fully documented with code.
- **Phase 3 (Downgrade + Credits):** Follows the same checkout-bypass and API-driven patterns established in Phase 2.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct codebase inspection confirms all packages installed. No new dependencies needed. All version constraints verified. |
| Features | HIGH | Stripe official docs confirm the anti-automation stance on hosted pages. Codebase analysis confirms what UI components exist to test. Coverage matrix clearly separates E2E scope from live-billing scope. |
| Architecture | HIGH | Hybrid checkout-bypass pattern is confirmed by Stripe docs, Playwright community reports, and existing live-billing code patterns. POM and fixture patterns are well-established Playwright idioms with full code examples in research. |
| Pitfalls | HIGH | Each pitfall is sourced from official docs (Stripe rate limits, test clock limits, Clerk concurrent worker bug) and direct codebase analysis of the existing live-billing test suite. Mitigation strategies are concrete and actionable, not theoretical. |

**Overall confidence:** HIGH

### Gaps to Address

- **Stripe Checkout selector stability (low impact if avoided):** If the team decides to exercise the actual Stripe Checkout page for even one smoke test, the DOM selectors (`[name="cardNumber"]`, `[data-testid="hosted-payment-submit-button"]`) are not officially documented. Treat them as fragile and isolate them in a single helper file. The full checkout-bypass approach eliminates this gap entirely — this is the recommendation.

- **Convex user sync timing after Clerk user creation:** The Clerk `user.created` webhook to Convex is asynchronous. The `clerkTestUser` utility must include an explicit poll for the Convex `users` row before proceeding with billing setup. The code pattern is specified in ARCHITECTURE.md but the exact timing window (typically 1–5s) needs empirical validation in the target environment during Phase 1.

- **CI provider specifics:** The research did not inspect the CI pipeline configuration. Phase 4 should verify that the billing E2E job has network access to `checkout.stripe.com` (for URL capture in the browser), `api.stripe.com`, and the deployed Convex endpoint.

## Sources

### Primary (HIGH confidence)
- [Stripe Automated Testing Documentation](https://docs.stripe.com/automated-testing) — checkout anti-automation, simulation approach
- [Stripe Test Card Numbers](https://docs.stripe.com/testing) — 4242424242424242, tok_visa, tok_chargeCustomerFail
- [Stripe Rate Limits](https://docs.stripe.com/rate-limits) — 25 ops/sec sandbox limit, subscription-level limits
- [Stripe Test Clocks Documentation](https://docs.stripe.com/billing/testing/test-clocks) — 3 customers/clock, 3 subscriptions/customer limits
- [Stripe Test Clock API Advanced Usage](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage) — list API limitations for test clock objects
- [Clerk Testing with Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview) — clerkSetup(), clerk.signIn(), testing token
- [Clerk Playwright Test Helpers](https://clerk.com/docs/guides/development/testing/playwright/test-helpers) — signIn/signOut/loaded API reference
- [Clerk Backend SDK createUser](https://clerk.com/docs/reference/backend/user/create-user) — skipPasswordChecks flag
- [Clerk signIn() Timeout with Concurrent Workers — Issue #7891](https://github.com/clerk/javascript/issues/7891) — confirmed bug, workers: 1 required
- [Playwright Assertions — expect.poll](https://playwright.dev/docs/test-assertions) — polling pattern for async state
- [Playwright Best Practices](https://playwright.dev/docs/best-practices) — fixture pattern, locator strategy
- Codebase direct inspection: `package.json`, `playwright.config.ts`, `e2e/global.setup.ts`, `e2e/auth.spec.ts`, `tests/live-billing/support.ts`, `tests/live-billing/required.test.ts`, `convex/testing/billing.ts`, `components/Pricing.tsx`, `app/settings/billing/page.tsx`, `components/billing/upgrade-confirmation-dialog.tsx`, `components/billing/credit-topup-card.tsx`

### Secondary (MEDIUM confidence)
- [Playwright Issue #19709: Stripe Checkout submission](https://github.com/microsoft/playwright/issues/19709) — confirms Checkout automation is fragile in CI
- [stripe-node Retry on 429 Issue #1110](https://github.com/stripe/stripe-node/issues/1110) — auto-retry not enabled by default; must configure `maxNetworkRetries`
- [Convex Testing Patterns](https://stack.convex.dev/testing-patterns) — sequential execution and cleanup patterns for shared backends
- [Testing SaaS Billing with Playwright and Stripe Test Clocks (HackerNoon)](https://hackernoon.com/no-more-ship-and-pray-testing-saas-billing-systems-with-playwright-and-stripe-test-clocks) — three-layer architecture, webhook polling
- [Testing Stripe Billing Cycles in 5 Minutes (DEV Community)](https://dev.to/paultowers/how-we-test-stripe-billing-cycles-in-5-minutes-instead-of-waiting-40-days-30jd) — test clock patterns, polling with exponential backoff

### Tertiary (LOW confidence — needs validation in target environment)
- Stripe Checkout hosted page DOM selectors (`[name="cardNumber"]`, `[data-testid="hosted-payment-submit-button"]`) — community-reported, not officially documented; moot if checkout bypass is used consistently (which it should be)

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
