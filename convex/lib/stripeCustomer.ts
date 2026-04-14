import type { ActionCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { stripeClient } from "../stripe";
import Stripe from "stripe";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Stripe operations are unavailable.",
      );
    }
    _stripe = new Stripe(key, { apiVersion: "2026-02-25.clover" });
  }
  return _stripe;
}

/**
 * Get or create a valid Stripe customer for a user.
 *
 * Wraps the @convex-dev/stripe component's getOrCreateCustomer with validation:
 * if the returned customer was deleted in Stripe, creates a fresh one and updates
 * the component's record.
 */
export async function getOrCreateValidCustomer(
  ctx: ActionCtx,
  args: { userId: string; email?: string; name?: string },
): Promise<{ customerId: string }> {
  const result = await stripeClient.getOrCreateCustomer(ctx, args);

  // Validate the customer still exists in Stripe
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(result.customerId);

  if ("deleted" in customer && customer.deleted) {
    // Customer was deleted from Stripe — create a fresh one
    const newCustomer = await stripe.customers.create({
      email: args.email ?? undefined,
      name: args.name ?? undefined,
      metadata: { userId: args.userId },
    });

    // Update the component's record so future lookups return the new ID
    await ctx.runMutation(components.stripe.public.createOrUpdateCustomer, {
      stripeCustomerId: newCustomer.id,
      email: args.email,
      name: args.name,
      metadata: { userId: args.userId },
    });

    return { customerId: newCustomer.id };
  }

  return { customerId: result.customerId };
}
