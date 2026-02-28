import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";

test.describe("Cancel Subscription", () => {
  test("cancel subscription shows 'Expires on' instead of 'Renews on'", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
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

    // 2. Cancel subscription via Stripe API (bypasses Customer Portal -- a hosted page we cannot automate)
    await stripeClient.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // 3. Navigate to billing page -- getSubscriptionDetails fetches live from Stripe
    //    so the page will show "Expires on" even before webhook finishes processing
    await billingPage.goto();
    await expect(billingPage.renewalDate).toContainText(/expires on/i);

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
