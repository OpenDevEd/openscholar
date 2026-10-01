import { v } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import { autumn } from "./autumn";
import { refreshAccount } from "./accounts";
import type { BillingCatalog } from "./validators";
import { TOPUP_PLAN } from "../../lib/billing/plans";
import { findPlan, topUpBundles } from "../../lib/billing/catalog";

async function requireUser(ctx: ActionCtx): Promise<Doc<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) throw createError("UNAUTHENTICATED", "Sign in to manage billing");
  return user;
}

async function requireCatalog(ctx: ActionCtx): Promise<BillingCatalog> {
  const catalog = await ctx.runQuery(api.billing.catalog.get, {});
  if (!catalog) throw createError("BILLING_UNAVAILABLE", "Plans aren't available yet");
  return catalog;
}

/**
 * The plans a customer can choose here: main plans other than the one Autumn
 * gives everyone. Moving back to that one is a cancellation, in the portal.
 */
async function requireChoosablePlan(ctx: ActionCtx, planId: string): Promise<void> {
  const plan = findPlan(await requireCatalog(ctx), planId);
  if (!plan || plan.addOn || plan.autoEnable) {
    throw createError("BILLING_PLAN_INVALID", `No plan "${planId}" to choose`);
  }
}

const billingUrl = () => `${requireAppUrl()}/settings/billing`;

/**
 * Autumn reuses an open Checkout session while the request is identical,
 * even after Stripe expires it. A unique return URL makes every request new,
 * so Autumn expires the old session and starts a fresh one, or charges a
 * card saved since.
 */
const returnUrl = (result: "checkout" | "topup") =>
  `${billingUrl()}?${result}=success&request=${crypto.randomUUID()}`;

const checkoutResult = v.object({ url: v.union(v.string(), v.null()) });

/**
 * Starts a paid plan or changes it. Cancelling back to the default plan goes
 * through the Stripe portal. Returns a Stripe Checkout URL when the user has
 * no saved card; otherwise Autumn charges the card (upgrades) or schedules
 * the change for the period end (downgrades), and `url` is null.
 */
export const choosePlan = action({
  args: { plan: v.string() },
  returns: checkoutResult,
  handler: async (ctx, { plan }): Promise<{ url: string | null }> => {
    const user = await requireUser(ctx);
    await requireChoosablePlan(ctx, plan);
    const result = await autumn.attach({
      customerId: user._id,
      planId: plan,
      successUrl: returnUrl("checkout"),
    });
    await refreshAccount(ctx, user._id, { card: true });
    return { url: result.payment_url };
  },
});

/** Undoes a scheduled cancellation or downgrade. */
export const keepPlan = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const user = await requireUser(ctx);
    const account = await refreshAccount(ctx, user._id, { card: true });
    if (account.plan && account.changesAt) {
      await autumn.update({ customerId: user._id, planId: account.plan, cancelAction: "uncancel" });
      await refreshAccount(ctx, user._id, { card: true });
    }
    return null;
  },
});

/**
 * What changing to `plan` charges now, in the currency's main unit, and the
 * saved card Autumn would charge. No card means the change goes to Checkout.
 * The card is read live, since the cached snapshot can lag the Stripe portal.
 */
export const previewPlan = action({
  args: { plan: v.string() },
  returns: v.object({
    dueNow: v.number(),
    currency: v.string(),
    lineItems: v.array(v.object({ description: v.string(), amount: v.number() })),
    card: v.optional(v.object({ brand: v.string(), last4: v.string() })),
  }),
  handler: async (ctx, { plan }): Promise<{
    dueNow: number;
    currency: string;
    lineItems: Array<{ description: string; amount: number }>;
    card?: { brand: string; last4: string };
  }> => {
    const user = await requireUser(ctx);
    await requireChoosablePlan(ctx, plan);
    const [preview, customer] = await Promise.all([
      autumn.previewAttach(user._id, plan),
      autumn.customer(user._id, { card: true }),
    ]);
    const card = customer.payment_method?.card;
    return {
      dueNow: preview.total,
      currency: preview.currency,
      lineItems: preview.line_items.map((item) => ({
        description: item.description,
        amount: item.total,
      })),
      ...(card ? { card: { brand: card.brand, last4: card.last4 } } : {}),
    };
  },
});

export const buyCredits = action({
  args: { credits: v.number() },
  returns: checkoutResult,
  handler: async (ctx, { credits }): Promise<{ url: string | null }> => {
    const user = await requireUser(ctx);
    const bundles = topUpBundles(await requireCatalog(ctx));
    if (!bundles.some((bundle) => bundle.credits === credits)) {
      throw createError("CREDITS_TOPUP_BUNDLE_INVALID", `No top-up of ${credits} credits`);
    }
    const result = await autumn.attach({
      customerId: user._id,
      planId: TOPUP_PLAN,
      credits,
      successUrl: returnUrl("topup"),
    });
    await refreshAccount(ctx, user._id, { card: true });
    return { url: result.payment_url };
  },
});

/** Stripe's portal for invoices and payment methods. */
export const openPortal = action({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    const user = await requireUser(ctx);
    return (await autumn.portal(user._id, billingUrl())).url;
  },
});
