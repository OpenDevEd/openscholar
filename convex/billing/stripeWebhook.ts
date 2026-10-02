/**
 * Stripe webhook. Autumn owns subscriptions and invoices and reports their
 * changes through its own webhook. This endpoint refreshes the user's cached
 * snapshot for what Autumn doesn't report, such as a changed card, and reverses
 * credits for refunded top-ups.
 */
import Stripe from "stripe";
import { v } from "convex/values";
import { httpAction, internalAction, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { autumn } from "./autumn";
import { refreshAccount } from "./accounts";
import { TOPUP_PLAN } from "../../lib/billing/plans";
import { findPlan } from "../../lib/billing/catalog";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY must be set");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

type CustomerRef = string | { id: string } | null | undefined;
const idOf = (ref: CustomerRef) => (typeof ref === "string" ? ref : ref?.id);

/** The Stripe customer an event is about. A detached card only names it in `previous_attributes`. */
function customerOf(event: Stripe.Event): string | undefined {
  const object = event.data.object as { object: string; id: string; customer?: CustomerRef };
  if (object.object === "customer") return object.id;
  const previous = event.data.previous_attributes as { customer?: CustomerRef } | undefined;
  return idOf(object.customer) ?? idOf(previous?.customer);
}

export const stripeWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return new Response("Missing Stripe signature or secret", { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      await request.text(),
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("[stripe webhook] signature check failed", error);
    return new Response("Invalid signature", { status: 400 });
  }

  const stripeCustomerId = customerOf(event);
  const object = event.data.object as { id: string };
  if (stripeCustomerId) {
    await ctx.scheduler.runAfter(0, internal.billing.stripeWebhook.handleEvent, {
      stripeCustomerId,
      refundedChargeId: event.type === "charge.refunded" ? object.id : undefined,
    });
  }
  return new Response(null, { status: 200 });
});

export const userForStripeCustomer = internalQuery({
  args: { stripeCustomerId: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, { stripeCustomerId }) => {
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", stripeCustomerId))
      .first();
    return account?.userId ?? null;
  },
});

export const handleEvent = internalAction({
  args: { stripeCustomerId: v.string(), refundedChargeId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { stripeCustomerId, refundedChargeId }) => {
    const stripe = stripeClient();
    let userId = await ctx.runQuery(internal.billing.stripeWebhook.userForStripeCustomer, {
      stripeCustomerId,
    });
    if (!userId) {
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      const autumnId = customer.deleted ? undefined : customer.metadata.autumn_id;
      if (!autumnId) {
        console.warn(`[stripe webhook] no OpenScholar user for ${stripeCustomerId}`);
        return null;
      }
      userId = autumnId as Id<"users">;
    }
    if (refundedChargeId) {
      await reverseRefundedTopUp(ctx, stripe, userId, refundedChargeId);
    }
    await refreshAccount(ctx, userId, { card: true });
    return null;
  },
});

/**
 * Removes the refunded share of a top-up's credits from what's left of it,
 * never below zero, and logs what was removed. Stripe reports the refund
 * total on a charge cumulatively; each total is claimed once, and only the
 * share above the previous claim is removed.
 */
async function reverseRefundedTopUp(
  ctx: Parameters<typeof refreshAccount>[0],
  stripe: Stripe,
  userId: Id<"users">,
  chargeId: string,
) {
  const charge = await stripe.charges.retrieve(chargeId);
  const paymentIntent =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent || charge.amount <= 0) return;
  const payments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntent },
  });
  const invoiceId = payments.data[0]?.invoice;
  if (typeof invoiceId !== "string") return;
  const lines = await stripe.invoices.listLineItems(invoiceId);
  // Autumn bills a bundle as one line of its full price, quantity 1.
  const topUpCents = lines.data
    .filter((line) => line.metadata?.autumn_product_id === TOPUP_PLAN)
    .reduce((sum, line) => sum + line.amount, 0);
  if (topUpCents <= 0) return;
  const catalog = await ctx.runQuery(api.billing.catalog.get, {});
  const unitPrice = catalog && findPlan(catalog, TOPUP_PLAN)?.credits?.unitPrice;
  if (!unitPrice?.amount) {
    console.error(`[stripe webhook] no top-up price in the catalog; refund ${chargeId} not reversed`);
    return;
  }

  // ponytail: converts at today's top-up price, so a refund after a price
  // change is off by that change; record credits per purchase if prices move.
  const purchased = Math.round((topUpCents / (unitPrice.amount * 100)) * unitPrice.billingUnits);
  const share = (refundedCents: number) =>
    Math.floor((purchased * refundedCents) / charge.amount);
  const previousCents = await ctx.runMutation(internal.billing.usage.claimRefund, {
    userId,
    stripeChargeId: chargeId,
    refundedCents: charge.amount_refunded,
    description: `Refund of ${charge.amount_refunded / 100} ${charge.currency.toUpperCase()}`,
  });
  if (previousCents === null) return;
  const owed = share(charge.amount_refunded) - share(previousCents);

  const customer = await autumn.customer(userId);
  const topUps = (customer.balances.credits?.breakdown ?? [])
    .filter((balance) => balance.plan_id === TOPUP_PLAN && balance.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  // ponytail: removal stops at zero, so credits spent after the read above
  // make the logged amount slightly high; Autumn's balance is still right.
  let removed = 0;
  for (const balance of topUps) {
    const take = Math.min(balance.remaining, owed - removed);
    if (take <= 0) break;
    await autumn.removeFromBalance({ customerId: userId, balanceId: balance.id, credits: take });
    removed += take;
  }
  await ctx.runMutation(internal.billing.usage.setRefundCredits, {
    chargeId: `refund:${chargeId}:${charge.amount_refunded}`,
    credits: removed,
  });
}
