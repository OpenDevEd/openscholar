import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";
import { FREE_SIGNUP_CREDIT_GRANT, PLAN_CONFIG } from "../../../convex/lib/constants";

test.describe("CRED-02: Monthly Credit Grants", () => {
  test(`Go subscription grants ${PLAN_CONFIG.go.creditsPerMonth} monthly credits (total ${FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth})`, async ({
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
    await webhookWaiter.waitForCreditBalance((total) => total >= FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth);

    // 3. Assert exact credit balance on billing page
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.go.creditsPerMonth); // FREE_SIGNUP_CREDIT_GRANT free signup + PLAN_CONFIG.go.creditsPerMonth Go monthly grant

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test(`Pro subscription grants ${PLAN_CONFIG.pro.creditsPerMonth} monthly credits (total ${FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.pro.creditsPerMonth})`, async ({
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
    await webhookWaiter.waitForCreditBalance((total) => total >= FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.pro.creditsPerMonth);

    // 3. Assert exact credit balance on billing page
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(FREE_SIGNUP_CREDIT_GRANT + PLAN_CONFIG.pro.creditsPerMonth); // FREE_SIGNUP_CREDIT_GRANT free signup + PLAN_CONFIG.pro.creditsPerMonth Pro monthly grant

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
