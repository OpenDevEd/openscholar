import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";
import { FREE_SIGNUP_CREDIT_GRANT, PLAN_CONFIG } from "../../../convex/lib/constants";

test.describe("Subscription: Free to Paid", () => {
  test(`subscribe to Go plan shows Go plan with ${FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth} credits`, async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // 1. Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });

    // 2. Wait for Convex webhook processing
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth);

    // 3. Assert billing page
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/go/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThanOrEqual(FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth); // FREE_SIGNUP_CREDIT_GRANT free + PLAN_CONFIG.go.creditsPerMonth Go

    // 4. Assert pricing page shows Current Plan badge on Go card
    await pricingPage.goto();
    const goCard = pricingPage.planCard("go");
    await expect(
      goCard.locator('[data-testid="pricing-current-badge"]'),
    ).toBeVisible();

    // 5. Cleanup Stripe objects
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test(`subscribe to Pro plan shows Pro plan with ${FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.pro.creditsPerMonth} credits`, async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

    // 1. Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: proPriceId,
    });

    // 2. Wait for Convex webhook processing
    await webhookWaiter.waitForSubscriptionPlan("pro");
    await webhookWaiter.waitForCreditBalance((total) => total >= FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.pro.creditsPerMonth);

    // 3. Assert billing page
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/pro/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThanOrEqual(FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.pro.creditsPerMonth); // FREE_SIGNUP_CREDIT_GRANT free + PLAN_CONFIG.pro.creditsPerMonth Pro

    // 4. Assert pricing page shows Current Plan badge on Pro card
    await pricingPage.goto();
    const proCard = pricingPage.planCard("pro");
    await expect(
      proCard.locator('[data-testid="pricing-current-badge"]'),
    ).toBeVisible();

    // 5. Cleanup Stripe objects
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
