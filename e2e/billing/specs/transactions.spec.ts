import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  createTopupBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";
import { FREE_SIGNUP_CREDIT_GRANT, PLAN_CONFIG } from "../../../convex/lib/constants";

test.describe("Transactions panel — plan-06 polish", () => {
  test("URL state roundtrip: ?view=purchases activates the purchases tab", async ({
    page,
    clerkUser: _clerkUser,
    billingPage,
  }) => {
    void _clerkUser;
    await billingPage.goto();
    await page.goto("/settings/billing?view=purchases");
    await page.waitForSelector("[data-transactions-panel]");
    const activeTab = page.locator('[data-transactions-tab="purchases"][data-state="active"]');
    await expect(activeTab).toBeVisible();
  });

  test("row click opens the detail drawer; Escape closes it and restores focus", async ({
    page,
    clerkUser: _clerkUser,
    billingPage,
  }) => {
    void _clerkUser;
    await billingPage.goto();
    const firstRow = page.locator("[data-txn-row]").first();
    await expect(firstRow).toBeVisible();
    const rowId = await firstRow.getAttribute("data-txn-id");
    await firstRow.click();

    const drawer = page.locator("[data-transaction-drawer]");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-drawer-section="amount"]')).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Focus returns to the originating row (programmatic via queueMicrotask).
    await expect(page.locator(`#txn-row-${rowId}`)).toBeFocused();
  });

  test("CSV export — current view triggers a download with the documented headers", async ({
    page,
    clerkUser: _clerkUser,
    billingPage,
  }) => {
    void _clerkUser;
    await billingPage.goto();
    await page.waitForSelector("[data-txn-row]");

    const downloadPromise = page.waitForEvent("download");
    await page.locator("[data-transactions-export-trigger]").click();
    await page.locator('[data-export-mode="current"]').click();
    const download = await downloadPromise;

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(path!, "utf-8");
    const header = content.split("\n", 1)[0]!;
    // First-line CSV header must include the canonical column order
    // declared in lib/billing/transactions/export-csv.ts (CSV_COLUMNS).
    expect(header.split(",")).toEqual([
      "id",
      "createdAt",
      "type",
      "direction",
      "creditType",
      "billingType",
      "description",
      "signedAmount",
      "balanceAfter",
      "stripeInvoiceId",
      "stripePaymentIntentId",
      "stripeChargeId",
      "stripeCheckoutSessionId",
      "jobId",
      "paperId",
      "resultId",
    ]);
  });

  test("keyboard navigation: '/' focuses search; ArrowDown + Enter opens the drawer for the active row", async ({
    page,
    clerkUser: _clerkUser,
    billingPage,
  }) => {
    void _clerkUser;
    await billingPage.goto();
    const list = page.locator("[data-transactions-list]");
    await expect(list).toBeVisible();

    await page.keyboard.press("/");
    await expect(page.locator("[data-transactions-search]")).toBeFocused();

    await list.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("ArrowDown");
    await expect(list).toHaveAttribute("aria-activedescendant", /^txn-row-/);
    await expect(page.locator('[data-txn-active="true"]')).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-transaction-drawer]")).toBeVisible();
  });

  test("filter then Clear all: row count drops, then is restored and URL params are stripped", async ({
    page,
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    // Seed extra rows so a filter actually changes the row count.
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;
    const { customerId, paymentMethodId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance(
      (total) => total >= FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth,
    );
    await createTopupBypass({
      stripe: stripeClient,
      customerId,
      paymentMethodId,
      userId: webhookWaiter.userId,
      credits: 100,
      amountCents: 50,
    });
    await webhookWaiter.waitForCreditBalance(
      (total) =>
        total >= FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth + 100,
    );

    await billingPage.goto();
    const allRows = page.locator("[data-txn-row]");
    const before = await allRows.count();
    expect(before).toBeGreaterThanOrEqual(3);

    // Switch to Purchases tab → only purchase + topup rows remain.
    await page.locator('[data-transactions-tab="purchases"]').click();
    await expect(page).toHaveURL(/[?&]view=purchases/);
    const filtered = await page.locator("[data-txn-row]").count();
    expect(filtered).toBeLessThan(before);

    await page.locator("[data-transactions-clear-all]").click();
    await expect(page).toHaveURL(/\/settings\/billing(\?[^v]*)?$|\/settings\/billing\?(?!.*view=)/);
    await expect.poll(() => page.locator("[data-txn-row]").count()).toBe(before);

    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test("prefers-reduced-motion disables the progress bar transition", async ({
    page,
    clerkUser: _clerkUser,
    billingPage,
  }) => {
    void _clerkUser;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await billingPage.goto();
    await page.waitForSelector("[data-transactions-progress]");
    const transition = await page
      .locator("[data-transactions-progress] > div")
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition).toMatch(/^0s|^0ms$/);
  });
});
