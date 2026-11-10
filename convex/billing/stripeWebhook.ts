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
import { refreshAccount, workspaceOfCustomer } from "./accounts";
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

/** The workspace a Stripe customer pays for (#650), by its cached account, or else by the Autumn customer Stripe names. */
export const workspaceForStripeCustomer = internalQuery({
  args: { stripeCustomerId: v.string(), autumnId: v.optional(v.string()) },
  returns: v.union(v.id("workspaces"), v.null()),
  handler: async (ctx, { stripeCustomerId, autumnId }) => {
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", stripeCustomerId))
      .first();
    return account?.workspaceId ?? (autumnId ? await workspaceOfCustomer(ctx, autumnId) : null);
  },
});

/** The person whose own workspace this is; null for an organization's. */
export const personOfWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    return workspace?.kind === "personal" ? workspace.userId : null;
  },
});

export const handleEvent = internalAction({
  args: { stripeCustomerId: v.string(), refundedChargeId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { stripeCustomerId, refundedChargeId }) => {
    const stripe = stripeClient();
    let workspaceId = await ctx.runQuery(internal.billing.stripeWebhook.workspaceForStripeCustomer, { stripeCustomerId });
    if (!workspaceId) {
      const customer = await stripe.customers.retrieve(stripeCustomerId);
      const autumnId = customer.deleted ? undefined : customer.metadata.autumn_id;
      workspaceId = autumnId ? await ctx.runQuery(internal.billing.stripeWebhook.workspaceForStripeCustomer, { stripeCustomerId, autumnId }) : null;
      if (!workspaceId) {
        console.warn(`[stripe webhook] no Openscholar workspace for ${stripeCustomerId}`);
        return null;
      }
    }
    if (refundedChargeId) {
      // Top-ups are bought on a person's own billing page until organizations have one (#652).
      const userId = await ctx.runQuery(internal.billing.stripeWebhook.personOfWorkspace, { workspaceId });
      if (userId) await reverseRefundedTopUp(ctx, stripe, userId, refundedChargeId);
      else console.error(`[stripe webhook] refund ${refundedChargeId} is for an organization's customer; not reversed`);
    }
    await refreshAccount(ctx, workspaceId, { card: true });
    // A report's activation the bank asked to confirm goes live once it's paid (#1261).
    await ctx.scheduler.runAfter(0, internal.reports.activation.settleFor, { workspaceId });
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
  if (typeof invoiceId !== "string") {
    console.warn(`[stripe webhook] refund ${chargeId} has no invoice; not reversed`);
    return;
  }
  // Which plan an invoice bought is Autumn's to say: its lines on Stripe don't name it.
  const billed = (await autumn.customer(userId, { invoices: true })).invoices?.find((invoice) => invoice.stripe_id === invoiceId);
  if (!billed?.plan_ids?.includes(TOPUP_PLAN)) {
    console.log(`[stripe webhook] refund ${chargeId} isn't of a top-up (invoice ${invoiceId}, plans ${billed?.plan_ids?.join(", ") ?? "unknown"})`);
    return;
  }
  if (billed.plan_ids.length > 1) {
    console.error(`[stripe webhook] refund ${chargeId} is of an invoice with more than a top-up (${billed.plan_ids.join(", ")}); not reversed`);
    return;
  }
  const lines = await stripe.invoices.listLineItems(invoiceId);
  // Autumn bills a bundle as one line of its full price, quantity 1.
  const topUpCents = lines.data.reduce((sum, line) => sum + line.amount, 0);
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
