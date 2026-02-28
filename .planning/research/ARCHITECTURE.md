# Architecture Research: E2E Billing Test Integration

**Domain:** Playwright E2E billing tests for Stripe + Clerk + Convex + Next.js
**Researched:** 2026-02-28
**Confidence:** HIGH (direct codebase analysis + Stripe docs + Playwright docs + Clerk testing docs)

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         E2E TEST LAYER (new)                                  │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Playwright   │  │  Billing     │  │  Page Object │  │  Webhook     │    │
│  │  Fixtures     │  │  Test Utils  │  │  Models      │  │  Waiter      │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                  │                  │                  │            │
├─────────┴──────────────────┴──────────────────┴──────────────────┴────────────┤
│                                                                              │
│  EXISTING INFRASTRUCTURE (untouched)                                         │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ @clerk/test  │  │ Next.js App  │  │ Convex Dev   │  │ Stripe       │    │
│  │ (global      │  │ (webServer   │  │ Instance     │  │ Sandbox      │    │
│  │  setup)      │  │  auto-start) │  │ (deployed)   │  │ (test mode)  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                       │
│  │ convex/      │  │ Stripe       │  │ Convex CLI   │                       │
│  │ testing/     │  │ Webhook at   │  │ (convex run) │                       │
│  │ billing.ts   │  │ /webhooks/   │  │              │                       │
│  │ (existing)   │  │ stripe       │  │              │                       │
│  └──────────────┘  └──────────────┘  └──────────────┘                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Key Architectural Decision: Two-Layer Strategy

The central challenge: Stripe Checkout hosted pages (`checkout.stripe.com`) have **security measures that prevent automated card entry** (confirmed by Stripe official docs). This is not a bug -- it is an intentional anti-automation measure.

**Decision: Hybrid approach combining browser E2E with server-side Stripe API orchestration.**

| Flow Category | Browser Testing | Server-Side Orchestration |
|---|---|---|
| Subscription checkout (free -> Go/Pro) | Navigate to pricing, click subscribe, verify redirect URL | Pre-attach payment method via Stripe API, create subscription server-side, verify UI updates |
| Upgrade (Go -> Pro) | Full browser flow -- upgrade dialog is in-app, no Stripe redirect | N/A -- entire flow is in-app UI |
| Downgrade (Pro -> Go) | Full browser flow -- changePlan action, verify UI | N/A -- entire flow is in-app UI |
| Credit top-up | Click bundle, verify redirect URL format | Complete payment server-side, verify UI credit update |
| Customer portal | Click manage, verify redirect URL | N/A -- Stripe portal not automatable |
| Webhook effects | Verify UI state changes reactively | Trigger via Stripe API operations |
| Cancellation | Verify portal redirect | Cancel subscription via API, verify UI state |

**Rationale:** Attempting to fill card details on Stripe-hosted checkout pages is fragile, breaks in CI, and is explicitly unsupported by Stripe. Instead, we verify the *redirect intent* (correct URL generation) in the browser, and use server-side Stripe API calls to complete the actual payment, then verify the downstream UI effects (plan change, credit grants, toast messages).

## Component Boundaries

### New Components to Build

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `billingFixture` | `e2e/fixtures/billing.fixture.ts` | Extends Playwright test with Stripe client, Convex CLI runner, test user lifecycle, cleanup |
| `BillingPage` POM | `e2e/pages/billing.page.ts` | Page Object for `/settings/billing` -- plan display, credit balance, topup buttons, manage button |
| `PricingPage` POM | `e2e/pages/pricing.page.ts` | Page Object for `/pricing` -- plan cards, subscribe/upgrade/downgrade buttons, upgrade dialog |
| `webhookWaiter` | `e2e/support/webhook-waiter.ts` | Poll Convex via CLI to wait for webhook-driven state changes (subscription sync, credit grants) |
| `stripeTestHelpers` | `e2e/support/stripe-helpers.ts` | Attach payment methods, create subscriptions, advance test clocks -- reuses patterns from `tests/live-billing/support.ts` |
| `clerkTestUser` | `e2e/support/clerk-user.ts` | Create/delete fresh Clerk users via Backend API for test isolation |

### Existing Components (Reused, Not Modified)

| Component | Location | Role in E2E |
|-----------|----------|-------------|
| `convex/testing/billing.ts` | Backend | `getBillingSnapshotForUser`, `resetBillingStateForUser` -- already exist |
| `tests/live-billing/support.ts` | Test infra | Reference for patterns: `waitForCondition`, `runConvexFunction`, Stripe helpers |
| `e2e/global.setup.ts` | E2E infra | `clerkSetup()` + disposable user creation -- already exists |
| `playwright.config.ts` | Config | 120s timeout, webServer auto-start, Clerk global setup -- already configured |

## Recommended Project Structure

```
e2e/
├── global.setup.ts              # EXISTING -- Clerk setup, disposable user
├── auth.spec.ts                 # EXISTING -- Clerk auth tests
├── fixtures/
│   └── billing.fixture.ts       # NEW -- extended test object with Stripe/Convex/Clerk
├── pages/
│   ├── billing.page.ts          # NEW -- POM for /settings/billing
│   └── pricing.page.ts          # NEW -- POM for /pricing (with upgrade dialog)
├── support/
│   ├── webhook-waiter.ts        # NEW -- poll Convex for state convergence
│   ├── stripe-helpers.ts        # NEW -- Stripe API helpers for E2E context
│   └── clerk-user.ts            # NEW -- fresh Clerk user creation/cleanup
└── billing/
    ├── subscribe.spec.ts        # NEW -- free -> Go, free -> Pro
    ├── upgrade.spec.ts          # NEW -- Go -> Pro via upgrade dialog
    ├── downgrade.spec.ts        # NEW -- Pro -> Go scheduled
    ├── cancellation.spec.ts     # NEW -- cancel via portal redirect
    ├── credit-grant.spec.ts     # NEW -- on-subscribe, on-upgrade pro-rata
    ├── credit-topup.spec.ts     # NEW -- purchase credits via checkout
    └── free-credit-cap.spec.ts  # NEW -- cap enforcement on free plan
```

### Structure Rationale

- **`fixtures/`:** Single billing fixture file that composes all test infrastructure. Keeps spec files clean -- they only describe user-visible behavior.
- **`pages/`:** Page Object Model isolates DOM selectors from test logic. When UI changes, only the POM updates.
- **`support/`:** Low-level utilities shared across specs. Mirrors the `tests/live-billing/support.ts` pattern but adapted for Playwright context (no Vitest dependency).
- **`billing/`:** One spec file per billing flow. Tests are grouped by user intent, not by technical mechanism.

## Architectural Patterns

### Pattern 1: Billing Test Fixture (core pattern)

**What:** A custom Playwright fixture that provides `stripeClient`, `convexRunner`, `testUser`, and `cleanup` to every billing test, with automatic teardown.

**When to use:** Every billing E2E test.

**Trade-offs:** Slight overhead per test (~3-5s for user creation + payment method attachment), but guarantees complete isolation.

```typescript
// e2e/fixtures/billing.fixture.ts
import { test as base, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import Stripe from "stripe";

type BillingFixtures = {
  stripeClient: Stripe;
  testUser: {
    clerkUserId: string;
    email: string;
    password: string;
    convexUserId: string;
    stripeCustomerId: string;
  };
  billingPage: BillingPage;
  pricingPage: PricingPage;
  signInAsTestUser: () => Promise<void>;
  waitForWebhook: WebhookWaiter;
};

export const test = base.extend<BillingFixtures>({
  stripeClient: async ({}, use) => {
    const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
    await use(client);
  },

  testUser: async ({ stripeClient }, use) => {
    // 1. Create fresh Clerk user via Backend API
    // 2. Sign in via Clerk to trigger Convex user sync
    // 3. Create Stripe customer with test payment method
    // 4. Link customer to Convex user
    const user = await createFreshBillingTestUser(stripeClient);
    await use(user);
    // Teardown: delete Clerk user, clean Stripe, reset Convex
    await cleanupBillingTestUser(stripeClient, user);
  },

  signInAsTestUser: async ({ page, testUser }, use) => {
    await use(async () => {
      await page.goto("/");
      await clerk.loaded({ page });
      await clerk.signIn({
        page,
        signInParams: {
          strategy: "password",
          identifier: testUser.email,
          password: testUser.password,
        },
      });
    });
  },

  waitForWebhook: async ({ testUser }, use) => {
    const waiter = new WebhookWaiter(testUser.convexUserId);
    await use(waiter);
  },
});
```

### Pattern 2: Server-Side Checkout Bypass

**What:** Instead of automating Stripe's hosted checkout page, pre-create the subscription via Stripe API (with `tok_visa` payment method), then verify the UI reflects the change.

**When to use:** Any flow that redirects to `checkout.stripe.com` (initial subscription, credit top-up).

**Trade-offs:** Does not test the actual Stripe Checkout UI form-fill. Does test: checkout URL generation, redirect behavior, webhook processing, UI state convergence. This is the correct trade-off because Stripe's hosted page is Stripe's responsibility to test, not ours.

```typescript
// Pattern: Verify redirect intent, then complete server-side
test("subscribe to Go plan", async ({
  page, testUser, stripeClient, signInAsTestUser, waitForWebhook
}) => {
  await signInAsTestUser();

  // Navigate to pricing
  const pricingPage = new PricingPage(page);
  await pricingPage.goto();

  // Click subscribe -- verify redirect URL is generated
  const [redirectUrl] = await Promise.all([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 15_000 })
      .then(() => page.url())
      .catch(() => null),
    pricingPage.clickSubscribe("go"),
  ]);

  // Checkpoint: checkout URL was generated correctly
  // (Stripe hosted page is not automatable -- complete server-side)

  // Server-side: create subscription directly
  const paymentMethodId = await attachTestPaymentMethod(
    stripeClient, testUser.stripeCustomerId
  );
  const subscription = await stripeClient.subscriptions.create({
    customer: testUser.stripeCustomerId,
    items: [{ price: process.env.STRIPE_GO_PRICE_ID! }],
    default_payment_method: paymentMethodId,
    payment_behavior: "error_if_incomplete",
    metadata: { userId: testUser.convexUserId },
  });

  // Wait for webhook to process and sync to Convex
  await waitForWebhook.subscriptionSynced(subscription.id);

  // Navigate to billing page and verify UI
  await page.goto("/settings/billing");
  const billingPage = new BillingPage(page);
  await billingPage.expectPlan("go");
  await billingPage.expectStatus("active");
});
```

### Pattern 3: In-App Flow Full Browser Testing

**What:** Flows that stay entirely within the app (upgrade dialog, downgrade) are tested fully in the browser with no server-side bypass.

**When to use:** Upgrade (Go -> Pro), downgrade (Pro -> Go), keep current plan.

**Trade-offs:** These are the highest-value E2E tests because they exercise the full stack: UI -> Convex action -> Stripe API -> webhook -> Convex mutation -> reactive UI update.

```typescript
test("upgrade Go to Pro via confirmation dialog", async ({
  page, testUser, stripeClient, signInAsTestUser, waitForWebhook
}) => {
  // Pre-condition: user on Go plan (set up via fixture)
  await signInAsTestUser();

  const pricingPage = new PricingPage(page);
  await pricingPage.goto();

  // Click "Upgrade to Pro" -- opens in-app dialog, no redirect
  await pricingPage.clickUpgrade("pro");

  // Verify upgrade confirmation dialog appears
  await pricingPage.upgradeDialog.expectVisible();
  await pricingPage.upgradeDialog.expectCurrentPlan("go");
  await pricingPage.upgradeDialog.expectTargetPlan("pro");
  await pricingPage.upgradeDialog.expectChargeAmount(); // non-zero

  // Confirm upgrade
  await pricingPage.upgradeDialog.confirm();

  // Wait for success toast
  await expect(page.getByText(/upgraded/i)).toBeVisible({ timeout: 30_000 });

  // Verify billing page reflects new plan
  await page.goto("/settings/billing");
  const billingPage = new BillingPage(page);
  await billingPage.expectPlan("pro");
});
```

### Pattern 4: Webhook Waiting via Convex CLI Polling

**What:** After a Stripe API operation, poll Convex via `convex run` CLI to verify the webhook has been processed and state has converged.

**When to use:** Every test that triggers Stripe events (subscription creation, upgrade, payment).

**Trade-offs:** Polling adds 2-10s per wait. But it is reliable, deterministic, and decoupled from UI rendering timing. Using `expect.poll` on the UI is the alternative, but is more fragile because it couples to rendering timing and animation states.

```typescript
// e2e/support/webhook-waiter.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export class WebhookWaiter {
  constructor(
    private convexUserId: string,
    private timeoutMs: number = 60_000,
    private intervalMs: number = 2_000,
  ) {}

  async subscriptionSynced(stripeSubscriptionId: string): Promise<void> {
    await this.pollUntil(
      `subscription ${stripeSubscriptionId} synced`,
      async () => {
        const snapshot = await this.getSnapshot();
        return snapshot.subscriptions.some(
          (s: any) => s.stripeSubscriptionId === stripeSubscriptionId
        );
      },
    );
  }

  async creditGrantForInvoice(invoiceId: string): Promise<void> {
    await this.pollUntil(
      `credit grant for invoice ${invoiceId}`,
      async () => {
        const snapshot = await this.getSnapshot();
        return snapshot.creditTransactions.some(
          (t: any) => t.type === "grant" && t.stripeInvoiceId === invoiceId
        );
      },
    );
  }

  async planEquals(plan: string): Promise<void> {
    await this.pollUntil(
      `plan equals ${plan}`,
      async () => {
        const snapshot = await this.getSnapshot();
        return snapshot.subscriptions.some((s: any) => s.plan === plan);
      },
    );
  }

  private async getSnapshot(): Promise<any> {
    const { stdout } = await execFileAsync("npx", [
      "convex", "run", "testing/billing:getBillingSnapshotForUser",
      JSON.stringify({ userId: this.convexUserId }),
      "--typecheck", "disable",
      "--codegen", "disable",
    ], { env: process.env, timeout: 30_000 });
    return JSON.parse(stdout.trim());
  }

  private async pollUntil(
    description: string,
    check: () => Promise<boolean>,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < this.timeoutMs) {
      if (await check()) return;
      await new Promise(r => setTimeout(r, this.intervalMs));
    }
    throw new Error(`Timed out waiting for: ${description}`);
  }
}
```

## Data Flow

### Subscription E2E Flow (Checkout Bypass)

```
Test Setup:
  Clerk Backend API ──create user──> Clerk
  Stripe API ──create customer + attach tok_visa──> Stripe

Test Execution:
  Browser ──navigate /pricing──> Next.js App
  Browser ──click Subscribe──> Convex action (createCheckoutSession)
  Convex ──return checkout URL──> Browser
  Test ──intercept redirect, verify URL──> Assertion

  (Bypass: create subscription server-side)
  Stripe API ──create subscription──> Stripe
  Stripe ──webhook──> Convex HTTP endpoint
  Convex ──syncSubscription mutation──> Convex DB
  Convex ──grantMonthlyCredits mutation──> Convex DB

  Test ──poll via Convex CLI──> Convex (getBillingSnapshotForUser)
  Browser ──navigate /settings/billing──> Next.js App
  Browser ──assert plan, credits, status──> Assertions

Test Teardown:
  Stripe API ──cancel subscription, delete customer──> Stripe
  Convex CLI ──resetBillingStateForUser──> Convex DB
  Clerk Backend API ──delete user──> Clerk
```

### Upgrade E2E Flow (Full Browser)

```
Pre-condition:
  Fixture ──server-side setup Go subscription──> Stripe + Convex

Test Execution:
  Browser ──navigate /pricing──> Next.js App
  Browser ──click "Upgrade to Pro"──> triggers getUpgradePreview action
  Convex action ──Stripe API invoice preview──> Stripe
  Convex ──return preview data──> Browser
  Browser ──UpgradeConfirmationDialog renders──> DOM

  Browser ──click "Confirm Upgrade"──> triggers changePlan action
  Convex action ──update subscription (always_invoice)──> Stripe
  Convex action ──grantUpgradeProRataCredits mutation──> Convex DB
  Stripe ──webhooks (sub.updated, invoice.paid)──> Convex HTTP endpoint

  Browser ──sonner toast appears──> DOM
  Browser ──navigate /settings/billing──> Next.js App
  Browser ──assert plan=pro, credits updated──> Assertions
```

### Credit Top-Up E2E Flow (Checkout Bypass)

```
Pre-condition:
  Fixture ──setup user with Go plan──> Stripe + Convex

Test Execution:
  Browser ──navigate /settings/billing──> Next.js App
  Browser ──click top-up bundle──> triggers createTopupCheckoutSession action
  Convex action ──create checkout.sessions──> Stripe
  Browser ──redirect to checkout.stripe.com──> Test intercepts URL

  (Bypass: create payment intent server-side)
  Stripe API ──create + confirm PaymentIntent with tok_visa──> Stripe
  Stripe ──webhook (payment_intent.succeeded)──> Convex HTTP endpoint
  Convex ──grantPurchasedCreditsFromPaymentIntent──> Convex DB

  Browser ──navigate /settings/billing──> Next.js App
  Browser ──assert credit balance increased──> Assertions
```

## Fresh User Lifecycle (Critical Isolation Pattern)

Each billing test gets a completely fresh user to avoid state contamination:

```
1. CREATE CLERK USER
   - Clerk Backend API: createUser({ email: unique, password, ... })
   - Email format: e2e-billing-{uuid}@test.openalex.org
   - skipPasswordChecks: true (test-only)

2. SIGN IN VIA BROWSER
   - page.goto("/")
   - clerk.signIn({ page, signInParams: { ... } })
   - This triggers Convex user sync (webhook: user.created)

3. WAIT FOR CONVEX USER
   - Poll Convex CLI: users/queries:getCurrentUser with identity
   - Or: check via getBillingSnapshotForUser returning non-null user

4. CREATE STRIPE CUSTOMER
   - Stripe API: customers.create({ email, metadata: { userId } })
   - Stripe API: paymentMethods.create({ type: "card", card: { token: "tok_visa" } })
   - Stripe API: paymentMethods.attach + set as default
   - Convex CLI: upsertBillingCustomerLink (link Stripe customer to Convex user)

5. RUN TEST
   - All billing operations use this user's Stripe customer

6. TEARDOWN (automatic via fixture)
   - Stripe: cancel all subscriptions, delete customer
   - Convex: resetBillingStateForUser
   - Clerk: deleteUser
```

**Why not reuse users across tests:**
- Billing state is stateful and cumulative (credit transactions, event logs)
- Subscription status depends on prior operations
- The existing `tests/live-billing` pattern uses `beforeEach` cleanup but shares a user -- this works for API-only tests but is fragile for browser tests where Clerk session state persists

## Page Object Models

### BillingPage POM (`/settings/billing`)

```typescript
// e2e/pages/billing.page.ts
import { type Page, type Locator, expect } from "@playwright/test";

export class BillingPage {
  readonly page: Page;
  readonly planLabel: Locator;
  readonly statusBadge: Locator;
  readonly manageButton: Locator;
  readonly creditBalanceFree: Locator;
  readonly creditBalancePaid: Locator;
  readonly creditBalanceTotal: Locator;
  readonly topupSection: Locator;
  readonly processingBanner: Locator;
  readonly creditCapBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    // Selectors based on actual component structure in billing/page.tsx
    this.planLabel = page.locator("[class*='text-2xl font-bold capitalize']");
    this.statusBadge = page.locator("[class*='rounded-full'][class*='text-xs']");
    this.manageButton = page.getByRole("button", { name: /manage|upgrade/i });
    this.topupSection = page.locator("#topup-section");
    this.processingBanner = page.getByText(/processing/i);
    this.creditCapBanner = page.getByText(/credit.*cap/i);
    // CreditBalanceCard selectors -- to be refined with data-testid
    this.creditBalanceFree = page.getByTestId("credit-balance-free");
    this.creditBalancePaid = page.getByTestId("credit-balance-paid");
    this.creditBalanceTotal = page.getByTestId("credit-balance-total");
  }

  async goto() {
    await this.page.goto("/settings/billing");
    await this.page.waitForLoadState("networkidle");
  }

  async expectPlan(plan: "free" | "go" | "pro") {
    await expect(this.planLabel).toContainText(new RegExp(plan, "i"));
  }

  async expectStatus(status: "active" | "inactive" | "past_due" | "canceled") {
    await expect(this.statusBadge).toContainText(new RegExp(status.replace("_", " "), "i"));
  }

  async expectCreditBalanceAtLeast(amount: number) {
    // Use expect.poll for reactive Convex data
    await expect.poll(async () => {
      const text = await this.creditBalanceTotal.textContent();
      return parseInt(text?.replace(/[^0-9]/g, "") ?? "0", 10);
    }, { timeout: 30_000 }).toBeGreaterThanOrEqual(amount);
  }

  async clickTopupBundle(index: number) {
    const bundles = this.topupSection.getByRole("button");
    await bundles.nth(index).click();
  }
}
```

### PricingPage POM (`/pricing`)

```typescript
// e2e/pages/pricing.page.ts
import { type Page, type Locator, expect } from "@playwright/test";

export class PricingPage {
  readonly page: Page;
  readonly upgradeDialog: UpgradeDialogFragment;

  constructor(page: Page) {
    this.page = page;
    this.upgradeDialog = new UpgradeDialogFragment(page);
  }

  async goto() {
    await this.page.goto("/pricing");
    await this.page.waitForLoadState("networkidle");
  }

  planCard(plan: "free" | "go" | "pro" | "enterprise"): Locator {
    // Each plan card has its name as text content
    return this.page.locator(`[class*="rounded-xl"]`)
      .filter({ hasText: new RegExp(`^${plan}$`, "i") });
  }

  async clickSubscribe(plan: "go" | "pro") {
    const card = this.planCard(plan);
    await card.getByRole("button").click();
  }

  async clickUpgrade(plan: "pro") {
    await this.clickSubscribe(plan);
    // For upgrades, this opens the dialog instead of redirecting
  }

  async expectCurrentPlanBadge(plan: string) {
    await expect(
      this.page.getByText("Current plan", { exact: false })
    ).toBeVisible();
  }
}

class UpgradeDialogFragment {
  readonly dialog: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(private page: Page) {
    this.dialog = page.getByRole("dialog");
    this.confirmButton = this.dialog.getByRole("button", {
      name: /confirm upgrade/i,
    });
    this.cancelButton = this.dialog.getByRole("button", {
      name: /cancel/i,
    });
  }

  async expectVisible() {
    await expect(this.dialog).toBeVisible({ timeout: 15_000 });
  }

  async expectCurrentPlan(plan: string) {
    await expect(this.dialog.getByText(new RegExp(plan, "i"))).toBeVisible();
  }

  async expectTargetPlan(plan: string) {
    await expect(this.dialog.getByText(new RegExp(plan, "i"))).toBeVisible();
  }

  async expectChargeAmount() {
    // Proration amount should be non-zero for an upgrade
    await expect(this.dialog.locator("[class*='font-semibold']").last()).not.toHaveText("$0.00");
  }

  async confirm() {
    await this.confirmButton.click();
  }
}
```

## Webhook Waiting Strategy: Poll Convex vs Poll UI

**Decision: Poll Convex via CLI for state convergence, then assert UI separately.**

| Approach | Pros | Cons |
|----------|------|------|
| **Poll Convex CLI** (chosen) | Deterministic, decoupled from render timing, can check exact DB state | Adds ~2-10s, requires CLI access |
| Poll UI with `expect.poll` | Tests full reactive pipeline | Fragile: skeleton states, loading spinners, animation delays |
| Listen for Stripe events | Real-time, event-driven | Complex setup, not available from browser context |
| Fixed `sleep()` | Simple | Unreliable, slow, flaky |

The Convex CLI approach mirrors what `tests/live-billing/support.ts` already does with `waitForCondition + getBillingSnapshotForUser`. In E2E context, we add a thin wrapper that:

1. Polls Convex CLI every 2s
2. Checks the billing snapshot for expected state
3. Times out after 60s (webhook processing typically takes 3-15s)
4. Once Convex state is confirmed, we navigate the browser and assert the UI reflects it

This two-phase approach (backend convergence then UI assertion) eliminates the most common E2E flake source: asserting UI before webhook processing completes.

## Test Data Cleanup Strategy

```
CLEANUP ORDER (reverse of creation):
1. Stripe: cancel subscriptions, delete customer, delete test clocks
2. Convex: resetBillingStateForUser (deletes: credits, creditTransactions,
   subscriptions, billingCustomers, stripeEventLogs)
3. Clerk: deleteUser (removes session, triggers user.deleted webhook)

WHEN:
- afterEach via fixture teardown (automatic)
- Also in beforeAll as safety net (handles leftover from crashed previous run)

STRIPE CLEANUP MARKERS:
- Customer metadata: { e2eBillingTest: "true", testRunId: "<uuid>" }
- Enables targeted cleanup without affecting non-test data
- Pattern reused from existing cleanupStripeForTestUser in live-billing/support.ts
```

## Integration Points: New vs Modified

### New Components (to build from scratch)

| File | Type | Dependencies |
|------|------|-------------|
| `e2e/fixtures/billing.fixture.ts` | Test fixture | `@clerk/testing/playwright`, `stripe`, `e2e/support/*` |
| `e2e/pages/billing.page.ts` | Page Object | `@playwright/test` |
| `e2e/pages/pricing.page.ts` | Page Object | `@playwright/test` |
| `e2e/support/webhook-waiter.ts` | Utility | `node:child_process` (Convex CLI) |
| `e2e/support/stripe-helpers.ts` | Utility | `stripe` |
| `e2e/support/clerk-user.ts` | Utility | `@clerk/backend` |
| `e2e/billing/*.spec.ts` | Test specs (7 files) | `billing.fixture`, `pages/*` |

### Existing Components Modified

| File | Modification | Reason |
|------|-------------|--------|
| `components/billing/credit-balance-card.tsx` | Add `data-testid` attributes | POM selectors need stable hooks |
| `components/billing/credit-topup-card.tsx` | Add `data-testid` attributes | POM selectors need stable hooks |
| `components/billing/upgrade-confirmation-dialog.tsx` | Add `data-testid` attributes | POM selectors need stable hooks |
| `components/Pricing.tsx` | Add `data-testid` on plan cards and buttons | POM selectors need stable hooks |
| `app/settings/billing/page.tsx` | Add `data-testid` on key elements | POM selectors need stable hooks |
| `playwright.config.ts` | Add billing test project with `testDir: ./e2e/billing` | Separate billing tests from auth tests |
| `package.json` | Add `test:e2e:billing` script | Entry point for running billing E2E |

### Existing Components Reused (no modification)

| File | How Used |
|------|----------|
| `convex/testing/billing.ts` | `getBillingSnapshotForUser`, `resetBillingStateForUser` via Convex CLI |
| `e2e/global.setup.ts` | `clerkSetup()` still handles Clerk testing token injection |
| `convex/http.ts` | Stripe webhook handler processes events as normal |

## Suggested Build Order

Build order is driven by dependency chains:

```
Phase 1: Test Infrastructure Foundation
├── e2e/support/clerk-user.ts          (no deps)
├── e2e/support/stripe-helpers.ts      (no deps)
├── e2e/support/webhook-waiter.ts      (depends on Convex CLI, testing/billing.ts)
└── Add data-testid to billing UI      (no test deps)

Phase 2: Fixture + Page Objects
├── e2e/fixtures/billing.fixture.ts    (depends on Phase 1)
├── e2e/pages/billing.page.ts          (depends on data-testid additions)
└── e2e/pages/pricing.page.ts          (depends on data-testid additions)

Phase 3: Core Specs (highest value)
├── e2e/billing/subscribe.spec.ts      (depends on Phase 2)
├── e2e/billing/upgrade.spec.ts        (depends on Phase 2)
└── e2e/billing/credit-grant.spec.ts   (depends on Phase 2)

Phase 4: Extended Specs
├── e2e/billing/downgrade.spec.ts      (depends on Phase 2)
├── e2e/billing/cancellation.spec.ts   (depends on Phase 2)
├── e2e/billing/credit-topup.spec.ts   (depends on Phase 2)
└── e2e/billing/free-credit-cap.spec.ts (depends on Phase 2)

Phase 5: Config + CI
├── playwright.config.ts updates       (depends on Phase 3 working)
├── package.json script additions      (depends on Phase 3 working)
└── CI pipeline configuration          (depends on all phases)
```

## Anti-Patterns

### Anti-Pattern 1: Automating Stripe Hosted Checkout

**What people do:** Use Playwright to fill card numbers on `checkout.stripe.com` pages.
**Why it's wrong:** Stripe explicitly blocks automated testing of their hosted checkout. It works locally sometimes but fails in CI due to bot detection, timezone issues, and iframe security restrictions. This creates the most common E2E flake in billing test suites.
**Do this instead:** Verify the redirect URL is correct, then complete the payment server-side via Stripe API with `tok_visa`. Test your code, not Stripe's checkout form.

### Anti-Pattern 2: Shared User Across Billing Tests

**What people do:** Create one test user in `beforeAll` and share it across all billing tests.
**Why it's wrong:** Billing state is cumulative. Test A subscribes, Test B upgrades, Test C checks credits -- but if Test B fails, Test C has wrong preconditions. The `beforeEach` cleanup helps but does not reset Clerk session state or handle webhook race conditions from previous tests.
**Do this instead:** Fresh Clerk user per test (or per describe block for tightly coupled sequential flows). The 3-5s overhead is worth the isolation guarantee.

### Anti-Pattern 3: Fixed sleep() for Webhook Waiting

**What people do:** `await page.waitForTimeout(10_000)` after creating a subscription.
**Why it's wrong:** Webhooks take 1-30s depending on Stripe load. Fixed sleep is either too short (flaky) or too long (slow). In CI, Stripe webhook delivery can be delayed by 20+ seconds.
**Do this instead:** Poll Convex state with exponential backoff and a generous timeout (60s). Return as soon as the condition is met.

### Anti-Pattern 4: Asserting UI Before Backend Convergence

**What people do:** After clicking "Confirm Upgrade", immediately check `await expect(page.getByText("Pro")).toBeVisible()`.
**Why it's wrong:** The UI depends on Convex reactive queries, which depend on webhook processing. The UI may still show "Go" while the webhook is in flight. Auto-retry via `expect` helps but adds unpredictable timing.
**Do this instead:** First confirm backend state via Convex CLI poll, then navigate to the page fresh and assert. This separates "did the backend process correctly?" from "does the UI render correctly?"

### Anti-Pattern 5: Testing Stripe Customer Portal UI

**What people do:** Navigate into the Stripe Customer Portal and click buttons.
**Why it's wrong:** Like Checkout, the Customer Portal is a Stripe-hosted page with bot detection. It is Stripe's UI, not yours.
**Do this instead:** Verify the portal URL is generated (test your `createPortalSession` action), then perform the desired action (cancel, update payment method) via Stripe API. Verify your app's response to the resulting webhooks.

## Stripe Test Mode Limitations (Reference)

| Limitation | Impact on E2E | Mitigation |
|---|---|---|
| Hosted Checkout not automatable | Cannot fill card details | Server-side bypass pattern |
| Customer Portal not automatable | Cannot click cancel/update | API-driven cancellation |
| Test clocks required for time-advance | Cannot test renewal in real-time | Use Stripe test clocks (already in live-billing tests) |
| Webhook delivery 1-30s latency | Tests must wait for webhook processing | Poll Convex CLI with timeout |
| No real card validation | Card decline scenarios limited | Use Stripe test tokens (`tok_chargeCustomerFail`) |
| Test mode rate limits | 25 API calls/second in test mode | Sequential test execution |

## Sources

- [Stripe Automated Testing Documentation](https://docs.stripe.com/automated-testing) -- official recommendation to simulate rather than automate checkout UI
- [Stripe Test Card Numbers](https://docs.stripe.com/testing) -- test tokens for various payment scenarios
- [Playwright Best Practices](https://playwright.dev/docs/best-practices) -- fixture pattern, locator strategy
- [Playwright Fixtures](https://playwright.dev/docs/test-fixtures) -- custom fixture extension pattern
- [Clerk Testing with Playwright](https://clerk.com/docs/guides/development/testing/playwright/test-authenticated-flows) -- `clerkSetup()`, `clerk.signIn()`, testing token
- [Playwright Issue #19709](https://github.com/microsoft/playwright/issues/19709) -- Stripe checkout submission failures in CI
- [Playwright Assertions](https://playwright.dev/docs/test-assertions) -- `expect.poll` for async state verification

---
*Architecture research for: E2E Billing Test Integration (v1.2 milestone)*
*Researched: 2026-02-28*
