import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
  createTopupBypass,
} from "../stripe-helpers";

test.describe("Credits", () => {
  test("free user sees 2,000 signup credits on billing page", async ({
    billingPage,
  }) => {
    // A fresh user created by the billing fixture has 2,000 free signup credits
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(2_000);
  });

  test("upgrade Go to Pro grants pro-rata credits", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // 1. Subscribe to Go via checkout-bypass
    const { customerId, subscriptionId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5_000);

    // 2. Read subscription timestamps for pro-rata calculation
    //    In Stripe API 2026-01-28 (clover), period fields moved to subscription items
    const subscription =
      await stripeClient.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`Subscription ${subscriptionId} has no items`);
    }
    const periodStart = item.current_period_start * 1000; // Convert to ms
    const periodEnd = item.current_period_end * 1000;

    // 3. Upgrade to Pro via pricing page confirmation dialog
    await pricingPage.goto();
    await pricingPage.clickSubscribe("pro");
    await expect(pricingPage.upgradeConfirmButton).toBeVisible({
      timeout: 15_000,
    });
    await pricingPage.upgradeConfirmButton.click();

    // 4. Wait for Pro subscription in Convex
    await webhookWaiter.waitForSubscriptionPlan("pro");

    // 5. Calculate expected pro-rata credits
    //    The server calculates: floor(remainingRatio * creditDelta)
    //    where remainingRatio = (periodEnd - now) / (periodEnd - periodStart)
    //    and creditDelta = 15,000 - 3,000 = 12,000
    const now = Date.now();
    const remainingRatio = (periodEnd - now) / (periodEnd - periodStart);
    const expectedProRata = Math.floor(remainingRatio * 12_000);
    const expectedTotal = 2_000 + 3_000 + expectedProRata; // free + Go + proRata

    // 6. Wait for credits to be updated (pro-rata grant may arrive after plan change)
    await webhookWaiter.waitForCreditBalance(
      (total) => total >= expectedTotal - 2,
    );

    // 7. Assert billing page shows correct balance within +-2 tolerance
    //    (tolerance accounts for timing difference between test and server calculation)
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThanOrEqual(expectedTotal - 2);
    expect(credits).toBeLessThanOrEqual(expectedTotal + 2);

    // 8. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test("credit topup increases balance", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // 1. Subscribe to Go (required to have a Stripe customer with payment method)
    const { customerId, paymentMethodId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5_000);

    // 2. Record current balance
    const balanceBefore = await webhookWaiter.waitForCreditBalance(
      (total) => total >= 5_000,
    );

    // 3. Purchase 10,000 credits via topup checkout-bypass
    await createTopupBypass({
      stripe: stripeClient,
      customerId,
      paymentMethodId,
      userId: webhookWaiter.userId,
      credits: 10_000,
      amountCents: 100,
    });

    // 4. Wait for credit balance to increase
    await webhookWaiter.waitForCreditBalance(
      (total) => total >= balanceBefore + 10_000,
    );

    // 5. Assert billing page shows increased balance
    await billingPage.goto();
    const creditsAfter = await billingPage.getCreditBalance();
    expect(creditsAfter).toBeGreaterThanOrEqual(balanceBefore + 10_000);

    // 6. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test("free user at credit cap sees cap banner", async ({ billingPage }) => {
    // A fresh free user has freeBalance = 2,000 and freeCreditCap = 2,000
    // The condition isFreeCapReached = freeBalance >= freeCreditCap is immediately true
    // No setup needed -- the cap banner should be visible for a new free user
    await billingPage.goto();
    await expect(billingPage.creditCapBanner).toBeVisible();
  });
});
