import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";

test.describe("CRED-02: Monthly Credit Grants", () => {
  test("Go subscription grants 3,000 monthly credits (total 5,000)", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // 1. Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });

    // 2. Wait for subscription and credit grant webhooks
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5_000);

    // 3. Assert exact credit balance on billing page
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(5_000); // 2,000 free signup + 3,000 Go monthly grant

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test("Pro subscription grants 15,000 monthly credits (total 17,000)", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

    // 1. Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: proPriceId,
    });

    // 2. Wait for subscription and credit grant webhooks
    await webhookWaiter.waitForSubscriptionPlan("pro");
    await webhookWaiter.waitForCreditBalance((total) => total >= 17_000);

    // 3. Assert exact credit balance on billing page
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(17_000); // 2,000 free signup + 15,000 Pro monthly grant

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
