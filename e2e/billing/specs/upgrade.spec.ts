import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";

test.describe("Upgrade: Go to Pro", () => {
  test("upgrade from Go to Pro via confirmation dialog", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // Step 1: Subscribe to Go via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5_000);

    // Step 2: Navigate to pricing page and verify Go is current
    await pricingPage.goto();
    const goCard = pricingPage.planCard("go");
    await expect(
      goCard.locator('[data-testid="pricing-current-badge"]'),
    ).toBeVisible();

    // Step 3: Click upgrade to Pro
    await pricingPage.clickSubscribe("pro");

    // Step 4: Verify upgrade confirmation dialog
    await expect(pricingPage.upgradeConfirmButton).toBeVisible({
      timeout: 15_000,
    });
    // Dialog shows plan names (not dollar amounts per locked decision)
    const dialogContent = pricingPage.page.locator('[role="dialog"]');
    await expect(dialogContent).toContainText(/go/i);
    await expect(dialogContent).toContainText(/pro/i);

    // Step 5: Confirm upgrade
    await pricingPage.upgradeConfirmButton.click();

    // Step 6: Wait for Convex to process the upgrade
    await webhookWaiter.waitForSubscriptionPlan("pro");

    // Step 7: Verify billing page shows Pro
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/pro/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);

    // Step 8: Verify credits increased beyond Go level
    // Pro-rata credits are variable (depends on timing), so assert > Go level
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThan(5_000);

    // Step 9: Verify pricing page shows Pro as current
    await pricingPage.goto();
    const proCard = pricingPage.planCard("pro");
    await expect(
      proCard.locator('[data-testid="pricing-current-badge"]'),
    ).toBeVisible();

    // Step 10: Cleanup Stripe objects
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
