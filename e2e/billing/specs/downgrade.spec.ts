import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";

test.describe("Downgrade: Pro to Go", () => {
  test("downgrade shows pending-change banner and scheduled badge", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

    // 1. Subscribe to Pro via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: proPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("pro");

    // 2. Navigate to pricing and verify Pro is current
    await pricingPage.goto();
    const proCard = pricingPage.planCard("pro");
    await expect(
      proCard.locator('[data-testid="pricing-current-badge"]'),
    ).toBeVisible();

    // 3. Click Go plan button to trigger downgrade (no dialog, calls changePlan directly)
    await pricingPage.clickSubscribe("go");

    // 4. Re-navigate to pricing page to see scheduled badge on Go card
    await pricingPage.goto();
    await expect(pricingPage.scheduledBadge).toBeVisible();

    // 5. Navigate to billing page and assert pending-change banner
    await billingPage.goto();
    await expect(billingPage.pendingChangeBanner).toBeVisible();

    // 6. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test("cancel scheduled downgrade restores Pro as active plan", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

    // 1. Subscribe to Pro via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: proPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("pro");

    // 2. Trigger downgrade to Go via pricing page
    await pricingPage.goto();
    await pricingPage.clickSubscribe("go");

    // 3. Navigate to billing page and verify pending-change banner appears
    await billingPage.goto();
    await expect(billingPage.pendingChangeBanner).toBeVisible();

    // 4. Click "Keep current plan" to cancel the scheduled downgrade
    await billingPage.clickKeepPlan();

    // 5. Re-navigate to billing page to verify banner is gone and Pro is active
    await billingPage.goto();
    await expect(billingPage.pendingChangeBanner).not.toBeVisible();
    await expect(billingPage.planName).toContainText(/pro/i);

    // 6. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
