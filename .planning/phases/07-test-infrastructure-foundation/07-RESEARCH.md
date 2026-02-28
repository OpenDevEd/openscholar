# Phase 7: Test Infrastructure Foundation - Research

**Researched:** 2026-02-28
**Domain:** Playwright E2E test infrastructure for billing flows (fixtures, page objects, Clerk auth, Stripe API helpers, Convex webhook waiter)
**Confidence:** HIGH

## Summary

Phase 7 establishes the test infrastructure that Phases 8 and 9 consume to write billing E2E specs. The project already has a working Playwright setup (v1.58.2) with Clerk integration (`@clerk/testing` v1.14.1, `@clerk/backend` v2.32.1), a global setup that creates/manages disposable Clerk users, and an `e2e/auth.spec.ts` proving the pattern works. The existing `tests/live-billing/support.ts` provides a mature reference for Stripe API helpers, Convex CLI invocation, artifact logging, and `waitForCondition` polling -- much of this can be adapted for E2E use.

The core task is to: (1) add a `billing` project to `playwright.config.ts` with 180s timeout, `workers: 1`, and `locale: 'en-US'`; (2) build a billing fixture (`test.extend`) that creates a fresh Clerk user per test, signs in via `clerk.signIn()`, and cleans up on teardown; (3) create a `WebhookWaiter` that polls Convex queries (subscription state, credit balance) until convergence; (4) build page object models for the billing page (`/settings/billing`) and pricing page (`/pricing`) targeting `data-testid` attributes; (5) add those `data-testid` attributes to the production billing components.

**Primary recommendation:** Build the billing fixture as a Playwright custom fixture composing Clerk user lifecycle, Stripe cleanup, webhook waiter, and page objects -- this lets Phase 8/9 tests be ~10-15 lines each.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | E2E test framework configured with Playwright billing project, 180s timeout, `workers: 1`, `locale: 'en-US'` | Playwright projects API supports per-project timeout, workers, and `use.locale` overrides. Current config has no projects array -- add one with a `billing` project pointing to `e2e/billing/` testDir. |
| INFRA-02 | Fresh Clerk test user created and deleted per test scenario via `@clerk/backend` API | Existing `global.setup.ts` already uses `createClerkClient()` from `@clerk/backend` for user lifecycle. Pattern: generate unique email per test, `createUser()` in fixture setup, `deleteUser()` in fixture teardown. `clerk.signIn()` from `@clerk/testing/playwright` handles browser auth. |
| INFRA-03 | Webhook waiter utility polls Convex backend for state convergence before UI assertions | Existing `waitForCondition()` in `tests/live-billing/support.ts` is the proven pattern. For E2E, poll via `page.evaluate()` calling Convex queries (subscription plan, credit balance) or use `convex run` CLI. Convex reactivity makes polling fast (~2-5s convergence). |
| INFRA-04 | Stripe helpers create subscriptions, attach payment methods, and clean up test objects via API | Existing `tests/live-billing/support.ts` has `createGoSubscription()`, `attachDefaultVisaPaymentMethod()`, `cleanupStripeForTestUser()`, `createCreditTopupPaymentIntent()`. These are server-side Stripe SDK calls that can be wrapped in the fixture. |
| INFRA-05 | Page Object Models for billing page and pricing page with `data-testid` selectors | Build `BillingPage` POM with methods like `getPlanName()`, `getCreditBalance()`, `getSubscriptionStatus()` and `PricingPage` POM with `clickSubscribe(plan)`, `getPlanPrice(plan)`. All target `data-testid` attributes. |
| INFRA-06 | `data-testid` attributes added to billing UI components for stable test targeting | Zero `data-testid` attributes exist today. Must add to: billing page plan name, status badge, credit balance, renews/expires date, pending-change banner, credit-cap banner, upgrade button; pricing page plan cards, subscribe buttons, current-plan badge, scheduled badge. |
| INFRA-07 | Billing fixture composes user lifecycle, Stripe client, webhook waiter, and auto-cleanup into single test extension | Use `test.extend<BillingFixtures>()` to create a `billingTest` that provides `{ clerkUser, stripeSdk, webhookWaiter, billingPage, pricingPage }`. Fixture teardown deletes Clerk user, cleans up Stripe objects, resets Convex billing state. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | 1.58.2 | E2E test runner | Already installed; projects API supports billing-specific config |
| `@clerk/testing` | 1.14.1 | Clerk auth helpers for Playwright | Already installed; provides `clerkSetup()`, `clerk.signIn()`, `clerk.signOut()`, `clerk.loaded()` |
| `@clerk/backend` | 2.32.1 | Clerk Backend API for user CRUD | Already installed; used in existing `global.setup.ts` for user creation/deletion |
| `stripe` | 20.3.0 | Stripe API client | Already a project dependency; used for checkout-bypass subscription creation and cleanup |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex` (CLI) | 1.31.7 | Invoke Convex internal functions | For webhook waiter polling via `convex run` and billing state reset |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling Convex via CLI | Polling via `page.evaluate()` with Convex client | CLI is simpler, doesn't require injecting Convex client into browser; `page.evaluate()` is faster but couples to client-side Convex setup |
| Per-test Clerk user creation | Shared test user with state reset | Per-test user provides better isolation; shared user risks cross-test contamination |
| `data-testid` attributes | CSS selectors / text selectors | `data-testid` is the Playwright-recommended approach for stable selectors that survive refactoring |

**Installation:**
No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure

```
e2e/
  auth.spec.ts           # Existing auth tests
  global.setup.ts        # Existing global setup (clerkSetup + user management)
  billing/
    fixtures.ts          # Billing test fixture (test.extend)
    webhook-waiter.ts    # WebhookWaiter utility
    stripe-helpers.ts    # Stripe API helpers (checkout-bypass, cleanup)
    pages/
      billing-page.ts    # BillingPage POM
      pricing-page.ts    # PricingPage POM
```

### Pattern 1: Billing Test Fixture

**What:** A custom Playwright fixture that composes Clerk user lifecycle, Stripe client, webhook waiter, and page objects into a single `test.extend()`.

**When to use:** Every billing E2E test in Phases 8 and 9.

**Example:**
```typescript
// Source: Playwright official docs (test.extend pattern)
import { test as base, expect } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import Stripe from "stripe";

type BillingFixtures = {
  clerkUser: { id: string; email: string; password: string };
  stripeClient: Stripe;
  webhookWaiter: WebhookWaiter;
  billingPage: BillingPage;
  pricingPage: PricingPage;
};

export const test = base.extend<BillingFixtures>({
  clerkUser: async ({ page }, use) => {
    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    const email = `billing-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.example.com`;
    const password = `TestPass${Date.now()}!`;
    const user = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
      firstName: "E2E",
      lastName: "Billing",
    });

    // Sign in to the browser
    await page.goto("/");
    await clerk.loaded({ page });
    await clerk.signIn({ page, signInParams: { strategy: "password", identifier: email, password } });

    await use({ id: user.id, email, password });

    // Teardown: sign out and delete user
    try { await clerk.signOut({ page }); } catch {}
    await clerkClient.users.deleteUser(user.id);
  },

  stripeClient: async ({}, use) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-01-28.clover",
    });
    await use(stripe);
  },

  webhookWaiter: async ({ page }, use) => {
    const waiter = new WebhookWaiter(page);
    await use(waiter);
  },

  billingPage: async ({ page }, use) => {
    await use(new BillingPage(page));
  },

  pricingPage: async ({ page }, use) => {
    await use(new PricingPage(page));
  },
});
```

### Pattern 2: Webhook Waiter (Convex State Polling)

**What:** A utility that polls Convex for billing state convergence before UI assertions. Uses the same `waitForCondition` pattern proven in `tests/live-billing/support.ts`.

**When to use:** After any Stripe API call that triggers webhooks (subscription creation, payment, plan change).

**Example:**
```typescript
// Adapted from tests/live-billing/support.ts waitForCondition pattern
class WebhookWaiter {
  constructor(private page: Page) {}

  async waitForSubscriptionPlan(
    expectedPlan: string,
    timeoutMs = 30_000,
  ): Promise<void> {
    await this.page.waitForFunction(
      (plan) => {
        const el = document.querySelector('[data-testid="plan-name"]');
        return el?.textContent?.toLowerCase().includes(plan.toLowerCase());
      },
      expectedPlan,
      { timeout: timeoutMs },
    );
  }

  async waitForCreditBalance(
    predicate: (balance: number) => boolean,
    timeoutMs = 30_000,
  ): Promise<void> {
    await this.page.waitForFunction(
      (pred) => {
        const el = document.querySelector('[data-testid="credit-balance"]');
        if (!el?.textContent) return false;
        const balance = parseInt(el.textContent.replace(/[^0-9-]/g, ""), 10);
        return !isNaN(balance) && pred(balance);
      },
      predicate.toString(), // Note: actual implementation needs serializable predicate
      { timeout: timeoutMs },
    );
  }
}
```

**Alternative approach:** Use `convex run` CLI to poll the `testing/billing:getBillingSnapshotForUser` internal query directly, which provides richer data than DOM scraping. This is the approach used by the live-billing tests and is more reliable for checking exact subscription state, credit amounts, and transaction records. The tradeoff is it requires knowing the Convex user ID, which the fixture can provide.

### Pattern 3: Checkout-Bypass for Subscription Creation

**What:** Create Stripe subscriptions and payment methods via the Stripe API directly (server-side) instead of automating the Stripe Checkout hosted page, which Stripe actively blocks.

**When to use:** Every test that needs a user with an active subscription.

**Example:**
```typescript
// Adapted from tests/live-billing/support.ts
async function checkoutBypass(args: {
  stripe: Stripe;
  clerkUserId: string;
  priceId: string;
}): Promise<{ customerId: string; subscriptionId: string }> {
  // 1. Create Stripe customer
  const customer = await args.stripe.customers.create({
    email: `e2e-${Date.now()}@test.example.com`,
    metadata: { userId: args.clerkUserId },
  });

  // 2. Attach test payment method
  const pm = await args.stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
  await args.stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await args.stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  // 3. Create subscription (triggers webhooks)
  const sub = await args.stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: args.priceId }],
    payment_behavior: "error_if_incomplete",
    metadata: { userId: args.clerkUserId },
  });

  return { customerId: customer.id, subscriptionId: sub.id };
}
```

### Pattern 4: Page Object Model with data-testid

**What:** Encapsulate DOM interactions behind typed methods. All selectors use `data-testid` for stability.

**When to use:** Every UI assertion in billing tests.

**Example:**
```typescript
class BillingPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/settings/billing");
    await this.page.waitForSelector('[data-testid="billing-plan-name"]');
  }

  async getPlanName(): Promise<string> {
    return await this.page.locator('[data-testid="billing-plan-name"]').textContent() ?? "";
  }

  async getSubscriptionStatus(): Promise<string> {
    return await this.page.locator('[data-testid="billing-status-badge"]').textContent() ?? "";
  }

  async getCreditBalance(): Promise<number> {
    const text = await this.page.locator('[data-testid="billing-credit-balance"]').textContent() ?? "0";
    return parseInt(text.replace(/[^0-9-]/g, ""), 10);
  }

  async getRenewalText(): Promise<string> {
    return await this.page.locator('[data-testid="billing-renewal-date"]').textContent() ?? "";
  }

  hasPendingChangeBanner(): Locator {
    return this.page.locator('[data-testid="billing-pending-change-banner"]');
  }

  hasCreditCapBanner(): Locator {
    return this.page.locator('[data-testid="billing-credit-cap-banner"]');
  }
}
```

### Anti-Patterns to Avoid

- **Automating Stripe Checkout iframe:** Stripe actively blocks automated interaction with hosted checkout. Always use the checkout-bypass pattern (server-side Stripe API subscription creation).
- **Sharing Clerk users across tests:** Each test must get a fresh user. Shared users cause cross-contamination (subscription state leaks between tests).
- **Asserting on UI without waiting for webhook convergence:** Stripe webhooks are asynchronous. Always use the webhook waiter to poll for expected state before asserting on the DOM.
- **Using CSS class selectors in page objects:** Classes change with styling; `data-testid` attributes are stable contracts between tests and production code.
- **Running billing tests in parallel:** The Clerk concurrent auth bug (#7891) causes `clerk.signIn()` timeouts with `workers > 1`. Must use `workers: 1`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Clerk user lifecycle in tests | Custom HTTP calls to Clerk API | `@clerk/backend` `createClerkClient().users.createUser/deleteUser` | Handles auth tokens, rate limits, API versioning |
| Browser sign-in flow | Automate Clerk UI components | `clerk.signIn()` from `@clerk/testing/playwright` | Handles testing token injection, bot detection bypass |
| Stripe test payment methods | Custom card token generation | `tok_visa` / `tok_chargeCustomerFail` test tokens | Stripe's pre-built test tokens handle all edge cases |
| Polling for async state | Custom `setTimeout` loops | `page.waitForFunction()` or adapted `waitForCondition()` | Built-in retry, timeout, and error reporting |
| Convex billing state reset | Manual table-by-table deletion | `testing/billing:resetBillingStateForUser` internal mutation | Already handles all billing tables with correct ordering and dedup |

**Key insight:** The project already has ~80% of the server-side test infrastructure in `tests/live-billing/support.ts` and `convex/testing/billing.ts`. Phase 7 is primarily about wrapping these in Playwright fixtures and adding the browser-facing layer (page objects + data-testid).

## Common Pitfalls

### Pitfall 1: Clerk signIn() Timeout with Multiple Workers
**What goes wrong:** `clerk.signIn()` throws `TimeoutError: page.waitForFunction: Timeout 15000ms exceeded` when running with `workers > 1`.
**Why it happens:** Clerk's testing token mechanism doesn't support concurrent browser sessions from the same publishable key (GitHub issue #7891).
**How to avoid:** Set `workers: 1` in the billing project config. This is a hard constraint until Clerk resolves the issue.
**Warning signs:** Intermittent auth failures that pass when re-run serially.

### Pitfall 2: Webhook Race Conditions
**What goes wrong:** UI assertions fail because the billing page still shows the old state (e.g., "Free" plan after subscribing).
**Why it happens:** Stripe webhook processing is asynchronous. The subscription is created in Stripe, but Convex hasn't processed the webhook yet.
**How to avoid:** Always use the webhook waiter to poll for expected state before making UI assertions. Poll the DOM element (`data-testid`) or use `convex run` to check the backend directly.
**Warning signs:** Flaky tests that pass on retry but fail on first run.

### Pitfall 3: Stripe Test Object Leaks
**What goes wrong:** Stripe sandbox accumulates test customers, subscriptions, and payment methods across test runs.
**Why it happens:** Test teardown doesn't clean up Stripe objects, or teardown fails silently.
**How to avoid:** Fixture teardown must: (1) cancel all subscriptions for the test customer, (2) delete the Stripe customer, (3) reset Convex billing state. Use the existing `cleanupStripeForTestUser()` pattern.
**Warning signs:** Stripe dashboard shows hundreds of test customers; tests start failing due to customer limits.

### Pitfall 4: Convex User Not Yet Synced from Clerk Webhook
**What goes wrong:** Clerk user is created via API, but Convex `users` table doesn't have a row yet. Subscription creation fails because there's no Convex user.
**Why it happens:** Clerk sends a `user.created` webhook to Convex, but there's latency. The E2E test proceeds before the webhook is processed.
**How to avoid:** After creating the Clerk user and signing in, navigate to a page that triggers `ensureUser` (most authenticated pages do this). Wait for the billing page to finish loading (subscription state settles) before making Stripe API calls.
**Warning signs:** "User not found" errors in Convex action logs during test setup.

### Pitfall 5: Locale-Sensitive Number Formatting
**What goes wrong:** Credit balance assertion expects "3,000" but gets "3.000" or "3000".
**Why it happens:** The app uses `next-intl` `useFormatter()` for number formatting. Different locales produce different separators.
**How to avoid:** Force `locale: 'en-US'` in the billing project config. Parse numbers from the DOM by stripping non-digit characters rather than matching exact formatted strings.
**Warning signs:** Tests pass locally (en-US) but fail in CI with a different default locale.

### Pitfall 6: data-testid Attribute Placement
**What goes wrong:** Page object can't find the element because the `data-testid` is on a wrapper div, not the element containing the text.
**Why it happens:** Adding `data-testid` to the wrong element in the component tree.
**How to avoid:** Place `data-testid` on the innermost element that contains the assertable text/value. For composite displays (e.g., "Renews on Mar 15, 2026"), place it on the container that holds the complete text.
**Warning signs:** `locator.textContent()` returns empty string or includes unrelated text.

## Code Examples

### Playwright Billing Project Configuration

```typescript
// playwright.config.ts -- add billing project alongside existing config
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  // ... existing config ...
  projects: [
    {
      name: "default",
      testIgnore: "**/billing/**",
    },
    {
      name: "billing",
      testDir: "./e2e/billing",
      timeout: 180_000,
      workers: 1,
      fullyParallel: false,
      use: {
        locale: "en-US",
      },
    },
  ],
});
```

### data-testid Attribute Placement in Billing Components

Components that need `data-testid` attributes:

**`app/settings/billing/page.tsx` (BillingPage):**
- Plan name display: `data-testid="billing-plan-name"` on the `<span>` with `t("planLabel", { plan: displayPlan })`
- Status badge: `data-testid="billing-status-badge"` on the status `<span>`
- Renewal/expiry date line: `data-testid="billing-renewal-date"` on the container div
- Pending change banner: `data-testid="billing-pending-change-banner"` on the blue banner div
- Credit cap banner: `data-testid="billing-credit-cap-banner"` on the amber banner div
- Manage/Upgrade button: `data-testid="billing-manage-button"` on the header Button
- Keep current plan button: `data-testid="billing-keep-plan-button"` on the keep-plan Button

**`components/billing/credit-balance-card.tsx` (CreditBalanceCard):**
- Total balance number: `data-testid="billing-credit-balance"` on the total balance `<span>`
- Free credits display: `data-testid="billing-free-credits"` on the free balance `<span>`
- Paid credits display: `data-testid="billing-paid-credits"` on the paid balance `<span>`

**`components/Pricing.tsx` (PricingPage):**
- Plan card container: `data-testid="pricing-plan-{planId}"` on each plan's `<motion.div>`
- Plan subscribe/action button: `data-testid="pricing-button-{planId}"` on each plan's Button
- Current plan badge: `data-testid="pricing-current-badge"` on the "Current Plan" badge span
- Scheduled badge: `data-testid="pricing-scheduled-badge"` on the "Scheduled" badge span

**`components/billing/upgrade-confirmation-dialog.tsx` (UpgradeDialog):**
- Confirm upgrade button: `data-testid="upgrade-confirm-button"` on the confirm Button
- Cancel button: `data-testid="upgrade-cancel-button"` on the cancel Button
- Proration charge display: `data-testid="upgrade-total-charge"` on the total charge span

### WebhookWaiter Implementation (CLI-Based)

```typescript
// Adapted from tests/live-billing/support.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class WebhookWaiter {
  constructor(
    private convexUserId: string,
    private timeoutMs: number = 30_000,
    private intervalMs: number = 2_500,
  ) {}

  async waitForSubscriptionPlan(expectedPlan: string): Promise<void> {
    await this.waitForCondition(
      `subscription plan = ${expectedPlan}`,
      async () => {
        const snapshot = await this.getBillingSnapshot();
        const sub = snapshot.subscriptions[0];
        return sub?.plan === expectedPlan && sub?.status === "active" ? sub : null;
      },
    );
  }

  async waitForCreditBalance(predicate: (total: number) => boolean): Promise<void> {
    await this.waitForCondition(
      "credit balance matches predicate",
      async () => {
        const snapshot = await this.getBillingSnapshot();
        const credits = snapshot.credits[0];
        if (!credits) return null;
        const total = credits.freeBalance + credits.paidBalance;
        return predicate(total) ? total : null;
      },
    );
  }

  private async getBillingSnapshot(): Promise<any> {
    // Uses convex run CLI to query internal function
    const { stdout } = await execFileAsync("npx", [
      "convex", "run", "testing/billing:getBillingSnapshotForUser",
      JSON.stringify({ userId: this.convexUserId }),
      "--typecheck", "disable",
      "--codegen", "disable",
    ], { timeout: 15_000 });
    return JSON.parse(stdout.trim());
  }

  private async waitForCondition<T>(
    description: string,
    check: () => Promise<T | null>,
  ): Promise<T> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= this.timeoutMs) {
      const value = await check();
      if (value !== null && value !== undefined) return value;
      await new Promise((r) => setTimeout(r, this.intervalMs));
    }
    throw new Error(`Timed out waiting for ${description} after ${this.timeoutMs}ms`);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `clerk.signIn({ page, emailAddress })` only | `clerk.signIn({ page, signInParams: { strategy, identifier, password } })` | @clerk/testing 1.x | Must use `signInParams` for password strategy |
| `stripe.invoices.retrieveUpcoming()` | `stripe.invoices.createPreview()` | Stripe API 2022-11 | Project already uses `createPreview` -- no action needed |
| Global test user shared across suite | Per-test user isolation | Industry best practice | Prevents state leakage between billing tests |

**Deprecated/outdated:**
- `stripe.invoices.retrieveUpcoming()` replaced by `stripe.invoices.createPreview()` -- project already migrated.

## Open Questions

1. **Convex User ID Discovery in E2E Context**
   - What we know: The billing fixture creates a Clerk user and signs in. Convex creates a `users` row via the Clerk webhook. The webhook waiter needs the Convex `userId` to call `testing/billing:getBillingSnapshotForUser`.
   - What's unclear: The Clerk `user.id` is not the Convex `userId`. How does the fixture discover the Convex userId?
   - Recommendation: After sign-in and page navigation, use `convex run` with the Clerk user's identity to query `users/internal:getCurrentUser` (or a similar query that returns the Convex user by clerkId). Alternatively, add a public query that returns the current user's `_id`. The existing `users` table has a `by_clerk_id` index, so a dedicated internal query `getUserByClerkId` would work cleanly.

2. **DOM-Based vs CLI-Based Webhook Waiter**
   - What we know: Two approaches are viable: (a) `page.waitForFunction()` polling DOM elements with `data-testid`, (b) CLI-based polling via `convex run`.
   - What's unclear: Which is more reliable in practice. DOM polling depends on the page being on the billing page. CLI polling works regardless of page location but has ~1s overhead per call.
   - Recommendation: Implement both. Use DOM-based polling as the primary approach (simpler, faster when already on the right page). Fall back to CLI-based polling for cross-page scenarios or when asserting backend state that isn't visible in the UI. The fixture should expose both methods.

3. **Stripe Customer Linking to Convex User**
   - What we know: The checkout-bypass creates a Stripe customer directly via API. Convex needs to link this customer to the user via `billingCustomers` table. The normal flow does this through `createCheckoutSession` which calls `stripeClient.getOrCreateCustomer()`.
   - What's unclear: When using checkout-bypass, does the Stripe webhook handler automatically create the `billingCustomers` link, or does the test need to do this manually?
   - Recommendation: The `customer.subscription.created` webhook handler calls `handleSubscriptionWebhook` which calls `syncLocalSubscriptionFromStripe`. This syncs the subscription but may not create the `billingCustomers` link. The test may need to explicitly call a Convex mutation to link the customer. Investigate during implementation and add a `upsertBillingCustomerLink` call if needed.

## Sources

### Primary (HIGH confidence)
- **Playwright fixtures API** -- https://playwright.dev/docs/test-fixtures (verified: test.extend, scope, auto, box patterns)
- **Playwright TestProject API** -- https://playwright.dev/docs/api/class-testproject (verified: per-project timeout, workers, use.locale)
- **Clerk testing helpers** -- https://clerk.com/docs/guides/development/testing/playwright/test-helpers (verified: clerk.signIn, signOut, loaded, clerkSetup)
- **Clerk concurrent auth bug** -- https://github.com/clerk/javascript/issues/7891 (verified: workers:1 workaround required, issue open as of Feb 2026)
- **Codebase: `playwright.config.ts`** -- existing Playwright config (verified: v1.58.2, global setup, web server config)
- **Codebase: `e2e/global.setup.ts`** -- existing Clerk setup (verified: createClerkClient, clerkSetup, user management)
- **Codebase: `e2e/auth.spec.ts`** -- existing auth E2E tests (verified: clerk.signIn/signOut pattern works)
- **Codebase: `tests/live-billing/support.ts`** -- existing billing test utilities (verified: Stripe helpers, waitForCondition, Convex CLI invocation, cleanup)
- **Codebase: `convex/testing/billing.ts`** -- existing billing state management (verified: getBillingSnapshotForUser, resetBillingStateForUser)

### Secondary (MEDIUM confidence)
- **Clerk authenticated flows guide** -- https://clerk.com/docs/guides/development/testing/playwright/test-authenticated-flows (verified concept; storage state approach is alternative to per-test user)

### Tertiary (LOW confidence)
- None. All findings verified against codebase and official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and proven in codebase
- Architecture: HIGH -- patterns adapted from existing test infrastructure (`tests/live-billing/support.ts`, `e2e/auth.spec.ts`)
- Pitfalls: HIGH -- Clerk #7891 verified, webhook timing patterns proven in live-billing tests

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- all dependencies are pinned, no breaking changes expected)
