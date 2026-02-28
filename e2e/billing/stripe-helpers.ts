import Stripe from "stripe";

/**
 * Create a Stripe client for E2E billing tests.
 * Uses STRIPE_SECRET_KEY from environment.
 */
export function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY for billing E2E tests");
  }
  return new Stripe(secretKey, {
    apiVersion: "2026-01-28.clover" as Stripe.LatestApiVersion,
  });
}

/**
 * Attach a test Visa payment method to a Stripe customer and set it as default.
 * Returns the payment method ID.
 */
export async function attachTestPaymentMethod(args: {
  stripe: Stripe;
  customerId: string;
}): Promise<string> {
  const pm = await args.stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await args.stripe.paymentMethods.attach(pm.id, {
    customer: args.customerId,
  });
  await args.stripe.customers.update(args.customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  return pm.id;
}

/**
 * Create a Stripe subscription via checkout-bypass pattern.
 * Creates a customer, attaches a test payment method, and creates a subscription.
 * This avoids automating the Stripe Checkout hosted page (which Stripe blocks).
 *
 * The `userId` metadata is critical -- Convex webhook handlers use it to link
 * the subscription to the correct Convex user.
 */
export async function createSubscriptionBypass(args: {
  stripe: Stripe;
  email: string;
  userId: string;
  priceId: string;
}): Promise<{
  customerId: string;
  subscriptionId: string;
  invoiceId: string;
  paymentMethodId: string;
}> {
  // 1. Create Stripe customer with userId metadata
  const customer = await args.stripe.customers.create({
    email: args.email,
    metadata: { userId: args.userId },
  });

  // 2. Attach test payment method
  const paymentMethodId = await attachTestPaymentMethod({
    stripe: args.stripe,
    customerId: customer.id,
  });

  // 3. Create subscription (triggers webhooks to Convex)
  const subscription = await args.stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: args.priceId }],
    payment_behavior: "error_if_incomplete",
    metadata: { userId: args.userId },
    default_payment_method: paymentMethodId,
    expand: ["latest_invoice"],
  });

  const invoiceId =
    typeof subscription.latest_invoice === "string"
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;

  if (!invoiceId) {
    throw new Error(
      `Subscription ${subscription.id} missing latest invoice ID`,
    );
  }

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    invoiceId,
    paymentMethodId,
  };
}

/**
 * Clean up all Stripe objects for a test customer.
 * Cancels active subscriptions and deletes the customer.
 */
export async function cleanupStripeCustomer(args: {
  stripe: Stripe;
  customerId: string;
}): Promise<void> {
  // Cancel all active subscriptions
  const subscriptions = await args.stripe.subscriptions.list({
    customer: args.customerId,
    status: "all",
    limit: 100,
  });

  for (const sub of subscriptions.data) {
    if (sub.status !== "canceled") {
      try {
        await args.stripe.subscriptions.cancel(sub.id);
      } catch {
        // Best-effort cleanup -- subscription may already be canceled
      }
    }
  }

  // Delete the customer
  try {
    await args.stripe.customers.del(args.customerId);
  } catch {
    // Best-effort cleanup -- customer may already be deleted
  }
}

/**
 * Purchase credits via checkout-bypass pattern (PaymentIntent direct).
 * Creates a confirmed PaymentIntent with credit_topup metadata,
 * bypassing Stripe Checkout (hosted page that cannot be automated).
 *
 * The `payment_intent.succeeded` webhook triggers `grantPurchasedCreditsFromPaymentIntent`
 * in Convex, which grants credits based on the metadata.
 */
export async function createTopupBypass(args: {
  stripe: Stripe;
  customerId: string;
  paymentMethodId: string;
  userId: string;
  credits?: number;
  amountCents?: number;
}): Promise<{ paymentIntentId: string }> {
  const credits = args.credits ?? 10_000;
  const amountCents = args.amountCents ?? 100;

  const pi = await args.stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: args.customerId,
    payment_method: args.paymentMethodId,
    metadata: {
      billingType: "credit_topup",
      userId: args.userId,
      credits: String(credits),
      bundleKey: `credits_${credits}`,
      amountCents: String(amountCents),
      creditsPerUsd: "10000",
    },
    confirm: true,
    off_session: true,
  });

  return { paymentIntentId: pi.id };
}
