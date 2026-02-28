# Domain Pitfalls: v1.2 E2E Billing Tests

**Domain:** Playwright E2E billing tests for Next.js + Convex + Stripe + Clerk stack
**Researched:** 2026-02-28
**Confidence:** HIGH (verified against Stripe docs, Clerk docs, Playwright docs, codebase analysis, and existing live-billing test patterns)

---

## Critical Pitfalls

Mistakes that cause persistent test failures, false positives, or blocked CI pipelines.

### Pitfall 1: Webhook Delivery Delays Cause Timing-Dependent Flakiness

**What goes wrong:** E2E tests trigger a Stripe action through the UI (e.g., completing a Checkout session), then immediately assert on Convex database state (e.g., subscription exists, credits granted). The Stripe webhook carrying the `invoice.paid` or `customer.subscription.created` event has not arrived yet. The assertion fails. On retry, it sometimes passes (webhook arrived), sometimes does not.

**Why it happens:** Stripe webhooks are delivered asynchronously, typically within 1-5 seconds of the triggering API call, but can take longer under Stripe's internal load. The E2E test has no direct signal that the webhook has been processed -- it can only observe the resulting database state. The existing live-billing tests handle this with `waitForCondition()` polling (2.5s interval, 180s timeout), but E2E tests running through the UI face an additional layer: the UI must also react to the Convex real-time subscription update.

**Consequences:**
- Flaky CI: tests pass locally but fail in CI where Stripe webhook delivery to a deployed Convex endpoint may be slower
- Over-aggressive timeouts mask real bugs (a 180s timeout hides that a webhook handler silently crashed)
- Under-aggressive timeouts cause spurious failures

**Prevention:**
- Reuse the `waitForCondition` polling pattern from `tests/live-billing/support.ts` but adapt it for Playwright. Instead of calling `getBillingSnapshotForUser` via Convex CLI, use `page.waitForFunction()` to poll the UI's reactive state (e.g., wait for the subscription plan badge to show "Pro") or use a Playwright-accessible API endpoint that exposes billing snapshot data.
- Set tier-appropriate timeouts: 30s for UI state changes that depend on webhooks, 60s for multi-step flows (subscription + credit grant), 120s for test-clock-based flows.
- NEVER use `page.waitForTimeout(5000)` as a substitute for proper condition polling. This is the number one source of flakiness.
- Add diagnostic logging: on test failure, capture the Convex billing snapshot and Stripe event list as test artifacts.

**Detection:** A test that passes on retry but fails on first attempt is a timing issue. Track retry rate per test.

**Phase to address:** Phase 1 (Test infrastructure) -- build Playwright-adapted polling utilities before writing any billing test.

---

### Pitfall 2: Shared Convex Dev Backend Creates Cross-Test State Pollution

**What goes wrong:** All E2E tests run against the same Convex dev deployment. Test A creates a subscription for a user. Test A's cleanup runs (deleting Convex records). But a webhook from Test A's Stripe actions arrives AFTER cleanup and DURING Test B, re-creating billing state that Test B does not expect. Test B's assertions fail because there are extra `creditTransactions` or `subscriptions` rows from Test A's late webhooks.

**Why it happens:** Convex has no test-scoped transactions or database snapshots. The `resetBillingStateForUser` mutation deletes rows, but incoming webhooks can recreate them. The existing live-billing tests handle this with `beforeEach` cleanup + `afterAll` cleanup, but they still operate on a shared backend. In E2E tests, the problem is worse because:
1. Browser-initiated actions are less controlled than direct API calls
2. Stripe Checkout sessions may fire multiple webhook events (`checkout.session.completed`, `customer.subscription.created`, `invoice.paid`) over several seconds
3. A `describe.sequential` block prevents parallel execution but does NOT prevent late webhooks from leaking across tests

**Consequences:**
- Tests that work in isolation fail when run in sequence
- "Ghost" credit grants appear in Test B from Test A's webhook
- Cleanup between tests becomes unreliable because you cannot cancel already-in-flight webhooks

**Prevention:**
- Use a FRESH Clerk test user per test scenario (not per `it` block -- per logical scenario group). Different users mean different `userId` values, so webhooks from User A cannot pollute User B's state.
- Implement a "drain period" between tests: after cleanup, wait 5-10 seconds for any in-flight webhooks to arrive and be processed (they will hit "user not found" or "already cleaned up" paths and be harmlessly discarded).
- Mark each test's Stripe objects with unique metadata (e.g., `testRunId: crypto.randomUUID()`) so cleanup can target only objects from the current test run.
- Run billing E2E tests with `workers: 1` and `fullyParallel: false` (already configured in `playwright.config.ts`).

**Detection:** If `resetBillingStateForUser` reports deleting rows that the current test did not create, a cross-test leak has occurred. Log the deleted row metadata.

**Phase to address:** Phase 1 (Test infrastructure) -- implement per-user isolation strategy.

---

### Pitfall 3: Stripe Checkout Page Automation Brittleness

**What goes wrong:** The subscription flow redirects the user to Stripe's hosted Checkout page (`checkout.stripe.com`). The E2E test must fill in card details (number, expiry, CVC) and submit. Stripe's Checkout page is a third-party domain with its own rendering pipeline, iframes, bot detection, and frequent UI changes. Selectors that work today break next month when Stripe updates their Checkout page layout.

**Why it happens:** Stripe's Checkout page is not designed for automated testing. It uses:
- Nested iframes for card input fields (PCI compliance)
- Dynamic element IDs and class names
- Bot detection that may flag Playwright as suspicious
- Different layouts between test mode and live mode
- Loading spinners with variable timing

**Consequences:**
- Tests break when Stripe updates their Checkout page (which happens without notice)
- Tests are slow because of iframe loading and Stripe's client-side validation
- Tests may be blocked by Stripe's bot detection in CI environments with shared IP addresses

**Prevention:**
- **Bypass Checkout for most tests**: Instead of driving the browser through Stripe's Checkout page, use the Stripe API directly to create subscriptions (the same pattern as the existing live-billing tests). Only ONE E2E test should exercise the full Checkout page flow -- the rest should create subscriptions via API and verify the UI state afterward.
- For the one Checkout test: use `page.frameLocator('iframe[name*="stripe"]')` to access card input frames. Use Stripe's test card `4242424242424242` with any future expiry and any CVC.
- Add generous timeouts for Stripe page loads (15-20s).
- If Stripe Checkout proves too brittle, consider using Stripe's `PaymentElement` or `EmbeddedCheckout` in test mode which keeps the user on your domain.
- Use `test.fixme()` annotation if the Checkout test is known-flaky, so it does not block CI.

**Detection:** Screenshot-on-failure captures exactly where the Checkout flow broke. The Playwright trace will show iframe loading status.

**Phase to address:** Phase 2 (Subscription E2E tests) -- build the Checkout page helper, but minimize its usage.

---

### Pitfall 4: Clerk Concurrent Worker Authentication Timeout

**What goes wrong:** When Playwright runs with `workers > 1`, `clerk.signIn()` times out with `TimeoutError: page.waitForFunction: Timeout 15000ms exceeded` waiting for `window.Clerk?.loaded === true`. With `workers: 1`, it works reliably.

**Why it happens:** This is a [known issue](https://github.com/clerk/javascript/issues/7891) with `@clerk/testing`. The root causes are:
1. Clerk's Backend API may throttle concurrent token validations from the same publishable key
2. ClerkJS hydration conflicts between parallel browser instances
3. Dev-browser tokens may not support multiple simultaneous sessions

The current `playwright.config.ts` already sets `workers: 1` in CI, but local development may use multiple workers.

**Consequences:**
- All tests fail in parallel mode, creating a confusing debugging experience
- Developers running `npx playwright test` locally without `--workers=1` see auth failures unrelated to their changes

**Prevention:**
- Explicitly set `workers: 1` in `playwright.config.ts` for ALL environments (not just CI). Billing E2E tests are inherently sequential due to shared Stripe state.
- Document the single-worker requirement in a test README or comment in the config.
- If test suite execution time becomes a concern, explore Clerk's session state caching: save auth state after first sign-in and load it for subsequent tests, eliminating repeated `clerk.signIn()` calls.

**Phase to address:** Phase 1 (Test infrastructure) -- enforce `workers: 1`, document the constraint.

---

### Pitfall 5: Over-Testing (Duplicating Existing Live-Billing Integration Coverage)

**What goes wrong:** The team writes E2E tests that duplicate the exact same assertions as the existing live-billing integration tests in `tests/live-billing/required.test.ts`. Both test suites now verify "subscription creation grants credits exactly once" and "invoice replay remains idempotent" through Convex API calls. The E2E tests add no value beyond what the integration tests already prove, but take 10x longer to run (browser startup, page navigation, webhook waiting).

**Why it happens:** The E2E test author does not review the existing live-billing test coverage and writes tests that verify backend behavior (idempotency, credit calculations, webhook processing) through the browser, which is the wrong layer for those assertions.

**Consequences:**
- CI runs take 15+ minutes for billing tests instead of 3 minutes
- Two test suites must be maintained for the same logical assertions
- When a billing bug is found, both suites fail with different error messages, creating confusion about where the bug actually is
- False sense of security: "we have 30 billing tests" when 15 are duplicate coverage

**Prevention:**
- Define a clear boundary: **Live-billing integration tests verify backend correctness** (webhook idempotency, credit grant logic, subscription sync, refund handling). **E2E tests verify user-visible flows** (UI shows correct plan after subscribe, upgrade dialog displays correct proration amount, credit balance updates in the UI after purchase, error toast appears on payment failure).
- The E2E tests should answer: "Does the USER see the right thing?" not "Does the BACKEND do the right thing?"
- Use a coverage matrix showing which scenarios are covered by which test tier:

  | Scenario | Unit test | Live-billing | E2E |
  |----------|-----------|--------------|-----|
  | Invoice grant idempotency | N/A | YES (required.test.ts) | NO |
  | Subscription creation grants credits | N/A | YES (required.test.ts) | YES (verify UI shows credits) |
  | Upgrade shows correct proration | N/A | NO | YES |
  | Checkout redirects and returns | N/A | NO | YES |
  | Billing page shows current plan | N/A | NO | YES |
  | Credit topup appears in balance | N/A | YES (required.test.ts) | YES (verify UI balance) |

**Detection:** If an E2E test's assertions only call Convex internal functions (via `runConvexFunction`) and never check `page.locator()`, it belongs in the integration test suite, not E2E.

**Phase to address:** Phase 1 (Test planning) -- create the coverage matrix before writing tests.

---

## Moderate Pitfalls

### Pitfall 6: Under-Testing (Not Verifying UI State After Backend Operations)

**What goes wrong:** E2E tests trigger a billing action, then only verify backend state (e.g., "subscription row exists in Convex"). They never check that the UI actually reflects the change: the plan badge did not update, the credit counter still shows the old balance, the success toast did not appear, or the billing page still shows "Subscribe" instead of "Manage Subscription."

**Why it happens:** It is easier to poll Convex for database state than to write Playwright assertions against DOM elements. The test author takes the shortcut of verifying the backend and assumes the UI "will just work."

**Consequences:**
- Regressions in reactive data binding, locale-specific rendering, or toast display go undetected
- The 6-locale internationalization (next-intl) can cause billing-specific translation keys to break silently -- e.g., `paymentMethod` key not consumed correctly (which was already fixed in v1.1)
- UI bugs that only manifest on specific plans or states are never caught

**Prevention:**
- Every E2E test must have at least ONE `expect(page.locator(...))` assertion that verifies something the user can see
- Key UI assertions to include for each flow:
  - After subscribe: plan name visible on billing page, credit balance shown
  - After upgrade: new plan name visible, proration confirmation dialog showed correct amounts, success toast appeared
  - After cancel: plan shows "Canceled" or "Free" status
  - After credit purchase: credit balance increased, success URL parameter present
- Use `page.screenshot()` on key assertion points for visual debugging

**Phase to address:** Phase 2-3 (Each billing flow test) -- mandate UI assertions in test review.

---

### Pitfall 7: Test Cleanup Leaves Orphaned Stripe Objects

**What goes wrong:** A test creates a Stripe customer, subscription, and test clock via API. The test fails mid-execution (assertion error, timeout). The `afterAll` / `afterEach` cleanup does not run (Playwright kills the test process on hard timeout). The Stripe test account accumulates orphaned customers, subscriptions, and test clocks. Over weeks, the account fills with debris, and API calls slow down due to large object lists.

**Why it happens:** The existing `cleanupStripeForTestUser` function in `tests/live-billing/support.ts` is thorough (cancels subscriptions, deletes customers, deletes test clocks) but is called in `afterAll` hooks. If the test process crashes or Playwright's global teardown does not run, cleanup is skipped. Additionally:
- Products and prices are NOT cleaned up by test clock deletion (known Stripe limitation)
- Deleted product/price IDs remain reserved in Stripe's audit log
- Test clocks have a limit of 3 customers each, so orphaned clocks waste this capacity

**Consequences:**
- Stripe sandbox accumulates hundreds of test customers over time
- API list operations become slower
- Rate limiting kicks in more easily when cleanup runs against many objects
- "There is no Stripe API to start with a fresh Test Mode" -- you cannot bulk-reset

**Prevention:**
- Implement a "global cleanup sweep" that runs at the START of each test suite (not just at the end). Query Stripe for all customers matching the test email pattern and clean them up BEFORE creating new ones. The existing `cleanupStripeForTestUser` does this -- ensure it is called in a `globalSetup` or `beforeAll` at the suite level.
- Add a CI scheduled job (weekly cron) that runs cleanup against the Stripe sandbox account independently of test execution.
- Use a `test.afterEach` hook in Playwright that captures created Stripe object IDs and writes them to an artifact file. A post-suite script can clean up any orphans.
- Set unique metadata on all test-created objects: `{ testSuiteRun: process.env.CI_RUN_ID || "local" }` for targeted cleanup.

**Detection:** A monitoring dashboard or periodic script that counts Stripe test-mode customers, subscriptions, and test clocks. Alert when counts exceed a threshold.

**Phase to address:** Phase 1 (Test infrastructure) -- global cleanup sweep in `globalSetup`.

---

### Pitfall 8: Stripe Sandbox Rate Limits Cause Spurious Failures

**What goes wrong:** The Stripe sandbox allows only 25 API operations per second (vs. 100 in live mode). A test suite that creates customers, payment methods, subscriptions, and then polls for invoice status can easily exceed this limit. Stripe returns `429 Too Many Requests`, causing the test to fail with an opaque "Stripe API error" rather than a clear rate-limit message.

**Why it happens:** Each billing E2E test scenario involves 5-15 Stripe API calls (create customer, attach payment method, create subscription, list invoices, retrieve subscription, etc.). The cleanup phase between tests adds another 5-10 API calls (list customers, cancel subscriptions, delete customers, delete test clocks). Running 5+ tests sequentially with cleanup between each easily generates 50-100 API calls in a burst.

Additionally, the Subscriptions API has its own limits:
- 10 new invoices per subscription per minute
- 20 new invoices per subscription per day
- 200 quantity updates per subscription per hour

**Consequences:**
- Intermittent test failures that are hard to reproduce locally (lower traffic)
- CI runs fail on the 4th or 5th test in a suite
- Developers add `sleep()` calls between API calls, slowing the entire suite

**Prevention:**
- Add retry-with-backoff for all Stripe API calls in test utilities. The `stripe-node` SDK does not auto-retry on 429 by default (see [stripe-node issue #1110](https://github.com/stripe/stripe-node/issues/1110)). Configure the Stripe client with `maxNetworkRetries: 3`.
- Space out test-to-test transitions: add a 2-second settling pause in `beforeEach` after cleanup (not as a timing hack, but as a rate-limit buffer).
- Minimize redundant API calls: cache the Stripe customer and payment method across tests within a `describe` block instead of recreating them for every test.
- For E2E tests that use the Stripe API directly (not through UI), batch API-level setup: create one customer + payment method in `beforeAll`, reuse across related tests, clean up in `afterAll`.

**Detection:** Log all Stripe API responses with status codes. Alert on any `429` in test runs.

**Phase to address:** Phase 1 (Test infrastructure) -- configure Stripe client retry, add rate-limit-aware test helpers.

---

### Pitfall 9: Test Clock Constraints Limit E2E Test Design

**What goes wrong:** A test creates a Stripe test clock to simulate subscription renewal (advance time by one month). The test clock has hard constraints: max 3 customers, max 3 subscriptions per customer, time can only advance 2 intervals at a time, and test-clock objects do NOT appear in generic list API calls. A test that needs to verify both a subscription renewal AND a subsequent upgrade on the same clock runs into the subscription limit.

**Why it happens:** Stripe test clocks are designed for focused billing scenario testing, not for broad integration testing. The constraints are documented but easy to forget:
- 3 customers max per clock
- 3 subscriptions (including scheduled) per customer per clock
- Time advancement limited to 2 billing intervals from frozen time
- Bank debit payments not supported during clock advancement
- Must query objects within the parent context (customer/subscription), not generic list endpoints

**Consequences:**
- Tests that need >3 subscriptions per customer (e.g., upgrade + downgrade + re-subscribe) cannot use a single test clock
- Test clock advancement can take 5-30 seconds for Stripe to process (the clock goes into "advancing" state and you must poll for "ready")
- Complex multi-step scenarios require multiple test clocks, compounding API call counts

**Prevention:**
- Reserve test clocks for scenarios that REQUIRE time advancement: subscription renewal and billing-cycle credit grants. Most E2E tests (subscribe, upgrade, cancel, credit purchase) do not need time advancement.
- One test clock per test scenario. Do not share clocks across scenarios.
- After advancing a clock, use `waitForTestClockReady` (already in `support.ts`) before making any further API calls.
- For the E2E test suite, consider whether subscription renewal even needs an E2E test. The existing live-billing integration test (`required.test.ts` scenario 1b) already covers renewal + credit grants with test clocks. The E2E test should focus on whether the UI correctly reflects the renewed state, not re-testing the renewal logic.

**Detection:** `InvalidRequestError: You can add up to 3 customers` or `You can create up to 3 subscriptions` errors in test output.

**Phase to address:** Phase 2 (Subscription tests) -- design test scenarios to minimize clock usage.

---

### Pitfall 10: Clerk Test User Lifecycle Creates Convex State Entanglement

**What goes wrong:** E2E tests create a Clerk test user in `globalSetup`. This user triggers a Clerk `user.created` webhook to Convex, which creates a `users` row. The billing test then creates subscriptions and credits for this user. Between test runs (or on test failure), cleanup deletes billing rows but leaves the `users` row intact. On the next run, `ensureDisposableClerkUser` in `global.setup.ts` finds the existing Clerk user, updates their password, and signals `signOutOfOtherSessions`. But the Convex `users` row already exists, and may have stale `state` or `metadata` from the previous run.

**Why it happens:** The Clerk user lifecycle (create/update/delete) is decoupled from the Convex user lifecycle. Clerk webhooks create/update the Convex user, but test cleanup only targets billing tables, not the users table. Additionally:
- Creating a new Clerk user for every test run would hit Clerk's rate limits
- Deleting and recreating the Clerk user triggers `user.deleted` + `user.created` webhooks, which may arrive out of order
- The `users` table has a `state` field that affects billing entitlements

**Consequences:**
- A user in `state: "deleted"` from a failed cleanup prevents new subscriptions
- Multiple `users` rows for the same `clerkId` (if the dedup webhook handler encounters a race)
- Billing tests depend on the user existing in Convex before they start, but the Clerk webhook creating the user may not have been processed yet

**Prevention:**
- In `globalSetup`, after creating/updating the Clerk user, explicitly wait for the Convex `users` row to appear (poll via `runConvexFunction` to query by clerkId). Do not assume the Clerk webhook fires synchronously.
- Create a dedicated `ensureBillingE2EUser` function that both ensures the Clerk user AND verifies the Convex user row exists with `state: "active"`.
- For fresh-user-per-scenario isolation, create the Clerk user per `describe` block, not per `it` block (to reduce API calls while maintaining isolation).
- Consider creating Clerk users with a unique email prefix per scenario: `e2e-subscribe-{uuid}@test.com`, `e2e-upgrade-{uuid}@test.com`. This provides true isolation without sharing any state.

**Detection:** If `getBillingSnapshotForUser` returns `user: null` at the start of a billing test, the Clerk-to-Convex user sync has not completed.

**Phase to address:** Phase 1 (Test infrastructure) -- build user provisioning with Convex verification.

---

## Minor Pitfalls

### Pitfall 11: Stripe Checkout Success URL Query Parameter Conflicts

**What goes wrong:** After successful Checkout, Stripe redirects to `${DOMAIN}/settings/billing?success=true`. The test asserts on this URL. But if the billing page uses `nuqs` (URL search param state management, which this project uses), other query params may be added or the `success` param may be consumed and removed by the page's `useEffect` before the assertion runs.

**Prevention:** Assert on `page.url()` containing `success=true` using a regex or URL parse, not an exact match. Alternatively, assert on the success toast or UI state change rather than the URL parameter.

**Phase to address:** Phase 2 (Subscription E2E test) -- use flexible URL assertions.

---

### Pitfall 12: Locale-Dependent Currency and Number Formatting Breaks Assertions

**What goes wrong:** The proration preview dialog shows amounts like "$14.25" in en-US but "14,25 $" in fr-FR. An E2E test that asserts `expect(page.locator('.amount')).toHaveText('$14.25')` fails when the test environment uses a non-English locale. The project supports 6 locales via next-intl.

**Prevention:**
- Run E2E tests with a fixed locale (e.g., `en-US`) via Playwright's `locale` setting in `use` config.
- Assert on numeric values by extracting and parsing, not string matching: `expect(parseFloat(amountText.replace(/[^0-9.]/g, ''))).toBeCloseTo(14.25)`.
- If locale-specific rendering needs testing, create a dedicated locale test suite separate from billing tests.

**Phase to address:** Phase 1 (Test infrastructure) -- set fixed locale in Playwright config.

---

### Pitfall 13: `convex dev` Hot Reload During Test Execution

**What goes wrong:** A developer runs `npx playwright test` while `convex dev` is watching for file changes. A teammate pushes a schema change, or the developer saves a file. `convex dev` pushes a new deployment. Mid-test, the Convex backend restarts. In-flight mutations fail, reactive queries disconnect and reconnect, and webhooks may be rejected during the brief downtime.

**Prevention:**
- E2E billing tests should run against a STABLE Convex deployment, not a `convex dev` watcher. Use `npx convex deploy` to push a specific version before running E2E tests.
- In `playwright.config.ts`, the `webServer` config already builds and serves Next.js. Ensure the Convex deployment is also pinned (not running `convex dev` concurrently).
- In CI, this is not an issue (CI deploys a specific version). For local development, add a pre-test script that runs `npx convex deploy` and stops any running `convex dev` process.

**Phase to address:** Phase 1 (Test infrastructure) -- document the deployment requirement.

---

### Pitfall 14: Stripe Portal Redirect Handling for Downgrade/Cancel Tests

**What goes wrong:** Downgrade and cancellation flows may redirect to Stripe's Customer Portal (`billing.stripe.com`). Similar to Checkout, this is a third-party page that changes without notice. The test must navigate the portal UI, find the correct subscription, click "Cancel" or change plan, and handle the redirect back.

**Prevention:**
- For cancellation E2E tests, use the Stripe API to cancel the subscription directly, then verify the UI updates. Only ONE test should exercise the actual Customer Portal flow.
- For downgrade, the project uses subscription schedules -- these can be created via API without portal interaction.
- If portal interaction is required, use `page.waitForURL()` with a pattern matching the portal domain, then interact with the portal form elements.

**Phase to address:** Phase 3 (Downgrade/cancel E2E tests).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Test infrastructure setup | Shared state pollution between tests (Pitfall 2) | Fresh user per scenario, drain period between tests |
| Test infrastructure setup | Clerk auth timeout with parallel workers (Pitfall 4) | Enforce `workers: 1`, document constraint |
| Test infrastructure setup | Orphaned Stripe objects from failed tests (Pitfall 7) | Global cleanup sweep in `globalSetup` |
| Test infrastructure setup | Stripe rate limits (Pitfall 8) | Configure `maxNetworkRetries: 3`, space out API calls |
| Subscription E2E tests | Checkout page automation brittleness (Pitfall 3) | Minimize Checkout page tests, use API for most tests |
| Subscription E2E tests | Webhook timing flakiness (Pitfall 1) | Polling utilities with tier-appropriate timeouts |
| Upgrade E2E tests | Over-testing backend logic already covered (Pitfall 5) | Coverage matrix, focus on UI assertions |
| Upgrade E2E tests | Under-testing UI state after operations (Pitfall 6) | Mandate at least one `page.locator()` assertion per test |
| Downgrade/cancel E2E tests | Stripe Portal redirect handling (Pitfall 14) | API-driven cancellation for most tests |
| Renewal/cycle tests | Test clock constraints (Pitfall 9) | Reserve clocks for renewal-only scenarios |
| All test phases | Clerk user state entanglement (Pitfall 10) | User provisioning with Convex verification |
| All test phases | Locale-dependent assertions (Pitfall 12) | Fixed locale in Playwright config |

## "Looks Done But Isn't" Checklist for v1.2

- [ ] **Polling utilities adapted for Playwright:** `waitForCondition`-equivalent that works with `page.waitForFunction()` or a Playwright-native polling pattern -- not just Convex CLI calls
- [ ] **Coverage matrix:** Each E2E test is justified as covering something the live-billing tests do NOT cover (UI state, user flow, redirect behavior)
- [ ] **Global cleanup sweep:** `globalSetup` cleans up orphaned Stripe objects from previous failed runs BEFORE creating new test state
- [ ] **Per-user isolation:** Each test scenario uses a unique Clerk user (or unique user identifier) to prevent cross-test webhook leakage
- [ ] **Stripe client retry:** Test helper Stripe client configured with `maxNetworkRetries: 3` to handle sandbox rate limits
- [ ] **Fixed locale:** Playwright config specifies `locale: 'en-US'` to prevent formatting-dependent assertion failures
- [ ] **Workers: 1 enforced:** Playwright config sets `workers: 1` for all environments, with a code comment explaining why
- [ ] **UI assertions per test:** Every E2E test includes at least one DOM-based assertion (not just backend polling)
- [ ] **Artifact capture:** On test failure, billing snapshot + Stripe event list are saved as test artifacts
- [ ] **Stable deployment:** Documentation specifies running E2E tests against a deployed (not `convex dev`) backend

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Webhook timing flakiness (Pitfall 1) | LOW | Increase timeout, add polling. If persistent, verify webhook endpoint is registered and receiving events. |
| Cross-test state pollution (Pitfall 2) | MEDIUM | Identify which test's webhook leaked. Add unique user per scenario. Reset ALL billing state (not just target user). |
| Stripe Checkout breakage (Pitfall 3) | LOW | Update selectors in Checkout helper. If persistent, bypass Checkout in most tests. |
| Orphaned Stripe objects (Pitfall 7) | LOW | Run `cleanupStripeForTestUser` manually or via a cleanup script. For accumulated debris, use Stripe dashboard to bulk-delete test customers. |
| Rate limit failures (Pitfall 8) | LOW | Add `maxNetworkRetries: 3` to Stripe client. If persistent, reduce test parallelism or batch API setup. |
| Test clock limit exceeded (Pitfall 9) | LOW | Restructure test to use fewer subscriptions per clock. Or create a new clock for the additional scenario. |
| Clerk user state entanglement (Pitfall 10) | MEDIUM | Delete the Clerk user entirely, wait for `user.deleted` webhook, recreate from scratch. Reset Convex `users` table for the affected `clerkId`. |

## Sources

- [Stripe Test Clocks Documentation](https://docs.stripe.com/billing/testing/test-clocks) -- 3 customers per clock, 3 subscriptions per customer, 2-interval advancement limit
- [Stripe Test Clock API Advanced Usage](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage) -- rate limits on subscriptions API, list API limitations for test clock objects
- [Stripe Rate Limits](https://docs.stripe.com/rate-limits) -- sandbox: 25 ops/sec vs live: 100 ops/sec; endpoint-specific limits
- [Stripe Webhook Troubleshooting](https://support.stripe.com/questions/troubleshooting-webhook-delivery-issues) -- test mode: 3 retry attempts over a few hours; delivery typically within milliseconds to seconds
- [5 Things About Stripe Test Mode](https://dev.to/tier/5-things-you-need-to-know-about-stripes-test-mode-2gcb) -- products/prices not cleaned up by test clock deletion; no bulk reset API; ID/key collisions from deleted objects
- [Clerk + Playwright Testing Docs](https://clerk.com/docs/guides/development/testing/playwright/overview) -- serial setup required, testing token injection
- [Clerk signIn() Timeout with Concurrent Workers](https://github.com/clerk/javascript/issues/7891) -- `@clerk/testing` fails with `workers >= 2`, workaround is `workers: 1`
- [stripe-node Retry on 429 Issue](https://github.com/stripe/stripe-node/issues/1110) -- auto-retry not default, must configure `maxNetworkRetries`
- [Convex Testing Patterns](https://stack.convex.dev/testing-patterns) -- sequential execution with cleanup between tests for shared backend isolation
- [Convex Testing Documentation](https://docs.convex.dev/testing) -- local backend testing requires `maxWorkers: 1` and data cleanup between tests
- [Playwright iframe Handling](https://playwright.dev/docs/api/class-frame) -- `page.frameLocator()` for nested Stripe iframes
- [Playwright Best Practices](https://playwright.dev/) -- avoid manual timeouts, use auto-waiting, retry on assertion failure
- Codebase analysis: `tests/live-billing/support.ts` (existing cleanup/polling patterns), `tests/live-billing/required.test.ts` (existing coverage to avoid duplicating), `e2e/global.setup.ts` (Clerk user provisioning), `playwright.config.ts` (current config), `convex/testing/billing.ts` (snapshot/reset utilities)

---
*Pitfalls research for: v1.2 E2E Billing Tests -- OpenAlex Count*
*Researched: 2026-02-28*
