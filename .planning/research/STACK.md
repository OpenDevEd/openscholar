# Technology Stack: v1.2 E2E Billing Tests

**Project:** OpenAlex Count -- E2E Billing Test Suite
**Researched:** 2026-02-28
**Scope:** Stack additions/changes for Playwright E2E billing tests with Clerk test mode, Stripe sandbox, and Convex dev backend

## Executive Decision

**No new npm dependencies required.** The existing stack (`@playwright/test ^1.58.2`, `@clerk/testing ^1.14.1`, `@clerk/backend ^2.32.1`, `stripe ^20.3.0`) already contains everything needed. The work is about writing test infrastructure code (fixtures, helpers, utilities), not adding packages.

---

## Existing Stack (Already Installed -- DO NOT Re-add)

### Core Test Framework

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| `@playwright/test` | ^1.58.2 | E2E test runner, browser automation, assertions | Installed, configured |
| `vitest` | ^3.2.4 | Unit tests and live-billing integration tests | Installed, configured |

### Auth Testing

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| `@clerk/testing` | ^1.14.1 | `clerkSetup()`, `clerk.signIn()`, `clerk.signOut()`, `clerk.loaded()`, `setupClerkTestingToken()` | Installed, used in `e2e/global.setup.ts` and `e2e/auth.spec.ts` |
| `@clerk/backend` | ^2.32.1 | `createClerkClient()` for server-side user CRUD (`createUser`, `deleteUser`, `updateUser`, `getUserList`) | Installed, used in `e2e/global.setup.ts` |

### Billing Integration

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| `stripe` | ^20.3.0 | Stripe API client for test cleanup, state verification, test card tokens | Installed, used in `tests/live-billing/support.ts` |
| `convex` | ^1.31.7 | Convex CLI (`npx convex run`) for backend function invocation | Installed, used in live-billing tests |

### Confidence: HIGH
Sources: Direct inspection of `package.json`, `playwright.config.ts`, `e2e/global.setup.ts`, `e2e/auth.spec.ts`, `tests/live-billing/support.ts`.

---

## What To Build (Not Install)

The E2E billing tests need custom infrastructure built from existing packages. Here is what each capability requires.

### 1. Per-Test Clerk User Isolation

**What:** Each billing test needs a fresh Clerk user to prevent cross-test state contamination (subscriptions, credits, Stripe customer records).

**How:** Use `@clerk/backend` (already installed) `createClerkClient()` to create and delete users programmatically. The existing `e2e/global.setup.ts` already demonstrates this pattern with `ensureDisposableClerkUser()`.

**Pattern:**
```typescript
// e2e/fixtures/billing.ts -- Playwright fixture
import { test as base, type Page } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";

type BillingFixtures = {
  testUser: { email: string; password: string; clerkUserId: string };
  authenticatedPage: Page;
};

export const test = base.extend<BillingFixtures>({
  testUser: async ({}, use, testInfo) => {
    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    const email = `e2e-billing-${testInfo.testId}@test.example.com`;
    const password = "TestPassword123!";

    const user = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      firstName: "E2E",
      lastName: `Billing-${testInfo.testId.slice(0, 8)}`,
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    });

    await use({ email, password, clerkUserId: user.id });

    // Teardown: delete user (cascades Clerk-side cleanup)
    await clerkClient.users.deleteUser(user.id);
  },

  authenticatedPage: async ({ page, testUser }, use) => {
    await page.goto("/");
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: testUser.email });
    await use(page);
    await clerk.signOut({ page });
  },
});
```

**Why this approach:**
- `@clerk/backend` `createUser` supports `skipPasswordChecks: true` for test users -- avoids password policy interference
- Clerk `deleteUser` cascades cleanup
- Each test gets a unique email via `testInfo.testId`, guaranteeing isolation
- The existing `ensureDisposableClerkUser` in `global.setup.ts` proves this pattern works

**Constraint -- single worker:** Clerk testing with Playwright has a known issue where `clerk.signIn()` times out with concurrent workers (`github.com/clerk/javascript#7891`). The existing `playwright.config.ts` already sets `fullyParallel: false` and `workers: 1` in CI. Billing tests MUST run with `workers: 1`.

**Confidence: HIGH** -- pattern already proven in `e2e/global.setup.ts`, Clerk docs confirm the API.

### 2. Stripe Hosted Checkout Page Interaction

**What:** The app uses Stripe's hosted checkout (redirect to `checkout.stripe.com`). Tests must fill card details on the Stripe-hosted page and submit payment.

**How the app works:**
- `createCheckoutSession` action creates a Stripe Checkout session, returns a URL
- UI does `window.location.href = url` (full redirect to `checkout.stripe.com`)
- Success redirects back to `/settings/billing?success=true`
- For topups: `createTopupCheckoutSession` follows the same redirect pattern

**Testing approach -- fill Stripe Checkout directly:**

Stripe's hosted checkout page CAN be automated with Playwright in test mode. The page uses standard HTML form inputs (not iframes like Stripe Elements). Known selectors for Stripe's hosted checkout in test mode:

```typescript
// e2e/helpers/stripe-checkout.ts
async function fillStripeCheckout(page: Page, options?: {
  cardNumber?: string;
  expiry?: string;
  cvc?: string;
  email?: string;
}) {
  const card = options?.cardNumber ?? "4242424242424242";
  const expiry = options?.expiry ?? "12/34";
  const cvc = options?.cvc ?? "123";

  // Wait for Stripe checkout to load
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  // Email field (if present -- depends on whether customer email was pre-filled)
  if (options?.email) {
    const emailField = page.locator("#email");
    if (await emailField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await emailField.fill(options.email);
    }
  }

  // Card number
  await page.locator('[name="cardNumber"]').fill(card);

  // Expiry
  await page.locator('[name="cardExpiry"]').fill(expiry);

  // CVC
  await page.locator('[name="cardCvc"]').fill(cvc);

  // Submit
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();

  // Wait for redirect back to app
  await page.waitForURL(/\/settings\/billing/, { timeout: 60_000 });
}
```

**Important caveats:**
- Stripe hosted checkout DOM selectors are NOT officially documented for automation and can change without notice -- keep selectors in a single helper file for easy maintenance
- Test mode checkout may show additional fields (billing address, country) depending on Stripe Dashboard settings -- disable "Collect billing address" in Stripe test mode dashboard for simpler tests
- CI environments may need extra timeout (Stripe checkout loads third-party scripts)

**Fallback approach if Stripe checkout automation proves flaky:** Use the Stripe API directly (same as live-billing tests) to create a subscription with `tok_visa` and skip the checkout UI entirely. This hybrid approach tests the UI up to the "redirect to checkout" point, then completes payment server-side and verifies the return callback. The existing `tests/live-billing/support.ts` has `attachDefaultVisaPaymentMethod()` and `createGoSubscription()` that prove this works. If the hybrid path is chosen, the test would:

1. Intercept the `window.location.href = url` assignment via `page.route()` or `page.waitForURL`
2. Extract the checkout session ID from the URL
3. Complete the session via Stripe API
4. Navigate back to the success URL manually

**Confidence: MEDIUM** -- Stripe checkout selectors are not officially documented for automation. Community examples and Playwright GitHub issues confirm it works, but selectors may drift. The hybrid API fallback is HIGH confidence.

### 3. Webhook Waiting / Backend State Verification

**What:** After checkout completes, the app depends on Stripe webhooks to update Convex state. Tests must wait for webhook processing to complete before asserting.

**Three complementary patterns:**

#### Pattern A: Convex Real-Time Reactivity (UI-level) -- PREFERRED
Since the app uses Convex subscriptions (real-time), the UI updates automatically when backend state changes. Tests can wait for UI elements to reflect the new state:

```typescript
// Wait for UI to reflect subscription change (Convex reactivity handles propagation)
await expect(page.getByText(/Go Plan/i)).toBeVisible({ timeout: 60_000 });

// Wait for credit balance to update
await expect(page.getByText(/credits/i)).not.toContainText("0", { timeout: 60_000 });
```

This is the **preferred approach** because:
- It tests what the user actually sees
- Convex's real-time subscription mechanism means the UI updates within seconds of webhook processing
- No need for separate API polling -- the reactive query mechanism handles it
- Failure in UI means failure for users -- exactly what E2E should catch

#### Pattern B: `expect.poll` for Backend State (API-level verification)
For assertions that require checking backend state not visible in UI, use Playwright's `expect.poll`:

```typescript
// Poll Convex via CLI to verify credit transactions
await expect.poll(async () => {
  const snapshot = await getBillingSnapshot(convexUserId);
  return snapshot.creditTransactions.filter(t => t.type === "grant").length;
}, {
  message: "Expected exactly 1 grant transaction",
  timeout: 60_000,
  intervals: [2_000, 3_000, 5_000, 5_000],
}).toBe(1);
```

#### Pattern C: Stripe API Direct Verification
For confirming Stripe-side state when needed:

```typescript
await expect.poll(async () => {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return sub.status;
}, {
  message: "Subscription should become active",
  timeout: 30_000,
}).toBe("active");
```

**Key insight:** The existing `tests/live-billing/support.ts` already has `waitForCondition()` that implements polling. The E2E tests should use Playwright's native `expect.poll` (which provides better error messages and integrates with test reporting) while reusing the same backend query functions.

**Confidence: HIGH** -- `expect.poll` is documented Playwright API. Convex reactivity is proven by the live app. `waitForCondition` pattern is battle-tested in live-billing tests.

### 4. Convex Backend Test Utilities

**What:** E2E tests need to read and reset Convex state for test isolation.

**Already built:**
- `convex/testing/billing.ts` exposes `getBillingSnapshotForUser` and `resetBillingStateForUser` as internal functions
- `tests/live-billing/support.ts` has `runConvexFunction()` that calls these via `npx convex run`

**Reuse strategy:** Import `runConvexFunction` and type definitions from `tests/live-billing/support.ts`. Create thin wrappers for E2E context:

```typescript
// e2e/helpers/convex.ts
import {
  runConvexFunction,
  type BillingSnapshot,
  type BillingIdentity,
  cleanupStripeForTestUser,
  resetBillingStateForUser,
} from "../../tests/live-billing/support";

export { runConvexFunction, cleanupStripeForTestUser };
export type { BillingSnapshot, BillingIdentity };

export async function getBillingSnapshot(userId: string): Promise<BillingSnapshot> {
  return runConvexFunction<BillingSnapshot>({
    functionPath: "testing/billing:getBillingSnapshotForUser",
    payload: { userId },
  });
}

export async function resetBillingState(userId: string) {
  return runConvexFunction({
    functionPath: "testing/billing:resetBillingStateForUser",
    payload: { userId },
  });
}

export async function ensureConvexUser(identity: BillingIdentity): Promise<string> {
  return runConvexFunction<string>({
    functionPath: "users/mutations:ensureUser",
    payload: {},
    identity,
  });
}
```

**Convex user ID resolution:** E2E tests sign in via Clerk, but Convex functions need a Convex `userId` (Id<"users">). The resolution path:

1. Sign in via Clerk in browser (creates Clerk session)
2. Navigate to any authenticated page (triggers Convex user sync via `ensureUser`)
3. Call `npx convex run users/mutations:ensureUser` with the Clerk identity to get the Convex user ID

This is the same approach used in live-billing tests (`ensureBillingTestUser` in `support.ts`).

**Confidence: HIGH** -- all building blocks exist and are proven.

### 5. Stripe Test Cleanup

**What:** Each test must clean up Stripe objects (customers, subscriptions) to prevent test pollution.

**Already built:** `tests/live-billing/support.ts` has `cleanupStripeForTestUser()` that handles:
- Finding customers by email
- Canceling all subscriptions for each customer
- Deleting customers
- Deleting test clocks (if any)

**Reuse strategy:** Import and use directly in E2E test fixture teardown. No modifications needed.

**Confidence: HIGH** -- proven in live-billing test suite.

---

## Recommended File Structure

```
e2e/
  global.setup.ts              # Existing -- clerkSetup(), disposable user
  auth.spec.ts                 # Existing -- auth flow tests
  billing/
    subscription.spec.ts       # Subscribe (free -> Go, free -> Pro)
    upgrade.spec.ts            # Upgrade (Go -> Pro) with proration preview
    downgrade.spec.ts          # Downgrade (Pro -> Go)
    cancellation.spec.ts       # Cancel subscription
    credits.spec.ts            # Credit grants, topup purchase, free cap
  fixtures/
    billing.ts                 # Playwright fixtures (testUser, authenticatedPage, stripe)
  helpers/
    stripe-checkout.ts         # fillStripeCheckout() helper for hosted checkout
    convex.ts                  # Wrappers around runConvexFunction for E2E
    assertions.ts              # Reusable billing assertion helpers
    cleanup.ts                 # Stripe + Convex cleanup (re-exports from live-billing)
```

---

## Configuration Changes

### playwright.config.ts Adjustments

```typescript
export default defineConfig({
  // ... existing config ...
  timeout: 180_000,        // Increase from 120s: billing flows involve Stripe roundtrips + webhooks
  expect: {
    timeout: 30_000,       // Increase from 15s: webhook processing can take 10-20s
  },
  // Keep these -- REQUIRED for Clerk testing:
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
});
```

**Rationale for timeout increases:**
- Stripe checkout redirect + page load: 3-8s
- Payment processing: 1-3s
- Webhook delivery to Convex: 2-10s (Stripe retries if initial delivery fails)
- Convex webhook handler execution: 1-5s
- UI reactivity propagation: 1-3s
- Total typical: 15-60s, worst case: ~120s

### Environment Variables (Already Configured)

No new env vars needed. All required variables already exist:

| Variable | Purpose | Already Exists? |
|----------|---------|-----------------|
| `CLERK_PUBLISHABLE_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk testing token generation | Yes |
| `CLERK_SECRET_KEY` | Backend user CRUD, `clerkSetup()` | Yes |
| `E2E_CLERK_USER_EMAIL` | Base test user email | Yes |
| `E2E_CLERK_USER_PASSWORD` | Test user password | Yes |
| `STRIPE_SECRET_KEY` | Stripe API calls for cleanup/verification | Yes |
| `STRIPE_GO_PRICE_ID` | Go plan price for test assertions | Yes |
| `STRIPE_PRO_PRICE_ID` | Pro plan price for test assertions | Yes |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL for CLI | Yes |

---

## Stripe Test Card Reference

These are Stripe's standard test cards. No package needed -- just string constants in the helper.

| Card Number | Scenario | Use In Test |
|-------------|----------|-------------|
| `4242424242424242` | Payment succeeds immediately | Subscription checkout, topup, upgrade proration |
| `4000000000000002` | Card declined | Checkout error handling test |
| `4000000000000341` | Attach succeeds, charge fails | Past-due / grace period tests (if in scope) |

Expiry: any future date (e.g., `12/34`). CVC: any 3 digits (e.g., `123`).

**Confidence: HIGH** -- Official Stripe documentation.

---

## What NOT To Add

| Rejected Addition | Why Not |
|-------------------|---------|
| `@stripe/stripe-js` or Stripe.js test utilities | App uses hosted checkout (full-page redirect), not embedded Stripe Elements. No iframes to interact with on the app's pages. |
| `playwright-stripe` or similar third-party plugins | No mature, maintained Playwright plugin for Stripe exists. Roll simple helpers. |
| `msw` (Mock Service Worker) | These are E2E tests against real services (Stripe sandbox, Convex dev, Clerk test mode). Mocking defeats the purpose. |
| `stripe-mock` (Stripe's local mock server) | Tests target real Stripe sandbox for webhook flow verification. Mock server does not handle webhook delivery. |
| `convex-test` | For unit testing Convex functions in isolation. E2E tests interact through the browser and use `npx convex run` for backend assertions. |
| `dotenv` | Node 22's `process.loadEnvFile()` is already used (see `playwright.config.ts` and `global.setup.ts`). |
| Additional browser packages (firefox/webkit) | Chromium-only is sufficient for billing E2E. Cross-browser testing adds no value for API/payment flows. |
| `uuid` or `nanoid` for test IDs | Playwright's `testInfo.testId` provides unique identifiers. |
| Separate test database | Convex dev deployment serves as the test backend. Live-billing tests prove this works. |
| `@clerk/testing/cypress` | Wrong framework. |

---

## Integration Flow: Clerk + Stripe + Convex in E2E

```
Test Setup:
  1. createUser (Clerk Backend SDK) -> fresh Clerk user with unique email
  2. clerk.signIn (browser) -> authenticated session
  3. Navigate to trigger Convex user sync -> ensureUser mutation runs

Subscription Flow (example):
  4. Navigate to /pricing -> UI loads plan cards
  5. Click "Subscribe to Go" -> createCheckoutSession action -> Stripe session created
  6. Redirect to checkout.stripe.com -> fillStripeCheckout helper fills card 4242
  7. Submit payment -> Stripe processes -> redirect back to /settings/billing?success=true
  8. Stripe sends webhooks to Convex HTTP endpoint:
     - checkout.session.completed
     - customer.subscription.created
     - invoice.paid
  9. Convex webhook handlers process events:
     - syncSubscription mutation updates local DB
     - grantMonthlyCredits grants initial credits
  10. Convex reactivity -> UI updates plan display + credit balance

Verification:
  11. Assert UI shows "Go" plan label, "Active" status badge
  12. Assert credit balance is > 0 in the UI
  13. expect.poll Convex snapshot -> exactly 1 grant transaction
  14. Optional: stripe.subscriptions.retrieve confirms active status

Cleanup:
  15. cleanupStripeForTestUser -> cancel subs, delete customer
  16. resetBillingStateForUser -> clear Convex tables
  17. clerkClient.users.deleteUser -> remove test user
```

### Timeout Budget Per Test

| Step | Expected Duration | Timeout |
|------|-------------------|---------|
| Clerk user creation | 1-2s | 10s |
| Clerk sign-in via browser | 2-5s | 15s |
| Page navigation | 1-3s | 10s |
| Stripe checkout load | 3-8s | 30s |
| Stripe payment processing + redirect | 2-5s | 30s |
| Webhook delivery + Convex processing | 5-30s | 60s |
| Convex reactivity (UI update) | 1-5s after webhook | 30s |
| Cleanup (Stripe + Convex + Clerk) | 3-10s | 30s |
| **Total per test** | ~20-70s typical | **180s max** |

---

## Alternatives Considered

| Decision | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Checkout interaction | Fill Stripe hosted checkout directly | Skip checkout, use API-only (like live-billing tests) | E2E should test the actual user flow. API fallback is available if selectors break. |
| User isolation | Fresh Clerk user per test via `createUser`/`deleteUser` | Reuse single user, reset state between tests | State leaks are the #1 cause of flaky billing tests. Fresh user eliminates cross-test contamination. |
| Backend assertions | `npx convex run` via `runConvexFunction` | HTTP API to Convex site URL | CLI approach is proven, does not require separate auth token management. |
| Webhook waiting | UI reactivity (Convex subscription auto-updates) | Poll backend API directly | UI-level waiting tests what users see. Backend polling is complementary for non-visible state. |
| Test execution | Sequential (`workers: 1`) | Parallel with worker-scoped users | Clerk `signIn()` has confirmed timeout issues with concurrent workers (issue #7891). Sequential is the only reliable option. |
| Shared test code | Import from `tests/live-billing/support.ts` | Duplicate helpers in `e2e/` | DRY principle. The support utilities are generic enough for both test suites. |

---

## Sources

- [Stripe Automated Testing Documentation](https://docs.stripe.com/automated-testing) -- HIGH confidence
- [Stripe Test Card Numbers](https://docs.stripe.com/testing) -- HIGH confidence
- [Clerk Testing with Playwright Overview](https://clerk.com/docs/guides/development/testing/playwright/overview) -- HIGH confidence
- [Clerk Test Helpers for Playwright](https://clerk.com/docs/guides/development/testing/playwright/test-helpers) -- HIGH confidence
- [Clerk Backend SDK createUser](https://clerk.com/docs/reference/backend/user/create-user) -- HIGH confidence
- [Clerk signIn() timeout with concurrent workers -- Issue #7891](https://github.com/clerk/javascript/issues/7891) -- HIGH confidence (confirmed bug)
- [Playwright Assertions -- expect.poll](https://playwright.dev/docs/test-assertions) -- HIGH confidence
- [Playwright API Testing -- page.request](https://playwright.dev/docs/api-testing) -- HIGH confidence
- [Stripe Checkout Playwright Issue #19709](https://github.com/microsoft/playwright/issues/19709) -- MEDIUM confidence (community reports)
- [Playwright Stripe Payment Element example](https://github.com/matthewling-stripe/playwright-payment-element) -- MEDIUM confidence
- [Convex Testing Patterns](https://stack.convex.dev/testing-patterns) -- MEDIUM confidence
- Direct codebase inspection: `package.json`, `playwright.config.ts`, `e2e/global.setup.ts`, `e2e/auth.spec.ts`, `tests/live-billing/support.ts`, `convex/testing/billing.ts`, `convex/subscriptions/actions.ts`, `app/settings/billing/page.tsx`, `components/Pricing.tsx` -- HIGH confidence

---
*Stack research for: v1.2 E2E Billing Tests*
*Researched: 2026-02-28*
