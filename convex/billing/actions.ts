import { v } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import type { Actor } from "../workspaces/actor";
import { autumn } from "./autumn";
import { refreshAccount } from "./accounts";
import { previewLineItemsValidator, type BillingCatalog } from "./validators";
import { MAX_PLAN_DETAILS } from "../lib/listCaps";
import { FREE_MEMBERS, ORGANIZATION_PLAN, ORGANIZATION_PLANS, TEAM_PLAN, TOPUP_PLAN } from "../../lib/billing/plans";
import { findPlan, topUpBundles } from "../../lib/billing/catalog";

async function requireUser(ctx: ActionCtx): Promise<Doc<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) throw createError("UNAUTHENTICATED", "Sign in to manage billing");
  return user;
}

/** The workspace the billing page manages: the person's own, whose customer is them, until organizations have billing pages (#651, #652). */
const ownWorkspace = (ctx: ActionCtx, user: Doc<"users">): Promise<Id<"workspaces">> => ctx.runQuery(internal.workspaces.actor.personalOf, { userId: user._id });

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
  if (!plan || plan.addOn || plan.autoEnable || ORGANIZATION_PLANS.includes(plan.id)) {
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
const returnUrl = (result: "checkout" | "topup" | "team", page = "/settings/billing") =>
  `${requireAppUrl()}${page}?${result}=success&request=${crypto.randomUUID()}`;

/**
 * Who pays for credits bought in `workspaceId`: the person, in their own workspace, or the
 * organization, which only its admins buy for (#651). With none, the person's own workspace.
 */
async function payerIn(ctx: ActionCtx, user: Doc<"users">, workspaceId: Id<"workspaces"> | undefined) {
  const paying = workspaceId ?? (await ownWorkspace(ctx, user));
  const actor: Actor = await ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId: paying });
  const organization: { name: string; slug: string } | null = await ctx.runQuery(internal.billing.accounts.organizationOf, { workspaceId: paying });
  if (organization && actor.role !== "admin") throw createError("FORBIDDEN", `Only an admin of ${organization.name} adds credits to it.`);
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId: paying });
  return { customerId, page: organization ? `/o/${organization.slug}/settings/billing` : "/settings/billing", workspaceId: paying };
}

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
    await refreshAccount(ctx, await ownWorkspace(ctx, user), { card: true });
    return { url: result.payment_url };
  },
});

/** Undoes a scheduled cancellation or downgrade. */
export const keepPlan = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const user = await requireUser(ctx);
    const account = await refreshAccount(ctx, await ownWorkspace(ctx, user), { card: true });
    if (account.plan && account.changesAt) {
      await autumn.update({ customerId: user._id, planId: account.plan, cancelAction: "uncancel" });
      await refreshAccount(ctx, await ownWorkspace(ctx, user), { card: true });
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
    lineItems: previewLineItemsValidator,
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
      // Autumn sends a line per charge and credit of the change, a handful; the cap is what the dialog lists.
      lineItems: preview.line_items.slice(0, MAX_PLAN_DETAILS).map((item) => ({
        description: item.description,
        amount: item.total,
      })),
      ...(card ? { card: { brand: card.brand, last4: card.last4 } } : {}),
    };
  },
});

export const buyCredits = action({
  args: { credits: v.number(), workspaceId: v.optional(v.id("workspaces")) },
  returns: checkoutResult,
  handler: async (ctx, { credits, workspaceId }): Promise<{ url: string | null }> => {
    const user = await requireUser(ctx);
    const payer = await payerIn(ctx, user, workspaceId);
    const bundles = topUpBundles(await requireCatalog(ctx));
    if (!bundles.some((bundle) => bundle.credits === credits)) {
      throw createError("CREDITS_TOPUP_BUNDLE_INVALID", `No top-up of ${credits} credits`);
    }
    const result = await autumn.attach({
      customerId: payer.customerId,
      planId: TOPUP_PLAN,
      credits,
      successUrl: returnUrl("topup", payer.page),
    });
    await refreshAccount(ctx, payer.workspaceId, { card: true });
    return { url: result.payment_url };
  },
});

/** Stripe's portal for invoices and payment methods: the person's own, or in `workspaceId` its organization's, which its admins manage. */
export const openPortal = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.string(),
  handler: async (ctx, { workspaceId }): Promise<string> => {
    const user = await requireUser(ctx);
    if (!workspaceId) return (await autumn.portal(user._id, billingUrl())).url;
    const organization = await organizationAdminOf(ctx, workspaceId);
    return (await autumn.portal(workspaceId, `${requireAppUrl()}/o/${organization.slug}/settings/billing`)).url;
  },
});

/** The organization a workspace is, which the person is an admin of: only its admins change its plan (#652). */
async function organizationAdminOf(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const actor: Actor = await ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId });
  const organization: { name: string; slug: string } | null = await ctx.runQuery(internal.billing.accounts.organizationOf, { workspaceId });
  if (!organization) throw createError("VALIDATION_ERROR", "Only an organization changes to Team or back.");
  if (actor.role !== "admin") throw createError("FORBIDDEN", `Only an admin of ${organization.name} changes its plan.`);
  return organization;
}

/**
 * Moves an organization to Team (#652): its limits and features from the Team plan, and a seat
 * for each member, charged to its saved card now, each adding its credits to the pool. Without a
 * saved card it returns a checkout that saves one, after which Autumn moves it, and its webhook
 * seats the members (autumnWebhook.ts).
 */
export const moveToTeam = action({
  args: { workspaceId: v.id("workspaces") },
  returns: checkoutResult,
  handler: async (ctx, { workspaceId }): Promise<{ url: string | null }> => {
    await requireUser(ctx);
    const organization = await organizationAdminOf(ctx, workspaceId);
    const customer = await autumn.customer(workspaceId, { card: true });
    if (!customer.payment_method?.card) return { url: (await autumn.setupPayment(workspaceId, TEAM_PLAN, returnUrl("team", `/o/${organization.slug}/pricing`))).url };
    await autumn.attach({ customerId: workspaceId, planId: TEAM_PLAN, idempotencyKey: `team-${workspaceId}-${crypto.randomUUID()}` });
    // Its seats now, so the page it comes back to shows them; the same sync runs on each change after.
    // A card that asks to confirm a seat's payment sends the admin to do that; the sync after it seats the rest.
    const paymentUrl: string | null = await ctx.runAction(internal.billing.seats.sync, { workspaceId });
    await refreshAccount(ctx, workspaceId, { card: true });
    return { url: paymentUrl };
  },
});

/** Moves an organization back to the free plan (#652), which has up to FREE_MEMBERS members: its seats end at once. */
export const moveToFree = action({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    await requireUser(ctx);
    await organizationAdminOf(ctx, workspaceId);
    const members: Array<{ clerkUserId: string }> | null = await ctx.runQuery(internal.billing.seats.membersOf, { workspaceId });
    if (members === null || members.length > FREE_MEMBERS) throw createError("VALIDATION_ERROR", `Free has up to ${FREE_MEMBERS} members: remove members down to ${FREE_MEMBERS} first.`);
    await autumn.attach({ customerId: workspaceId, planId: ORGANIZATION_PLAN, idempotencyKey: `free-${workspaceId}-${crypto.randomUUID()}` });
    await ctx.runAction(internal.billing.seats.sync, { workspaceId });
    await refreshAccount(ctx, workspaceId, { card: true });
    return null;
  },
});
