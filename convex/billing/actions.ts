import { v, type Infer } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import type { Actor } from "../workspaces/actor";
import { autumn, type AutumnCustomer, type AutumnPreview } from "./autumn";
import { refreshAccount } from "./accounts";
import { previewLineItemsValidator, type BillingCatalog } from "./validators";
import { MAX_PLAN_DETAILS } from "../lib/listCaps";
import { FREE_MEMBERS, ORGANIZATION_PLAN, ORGANIZATION_PLANS, SEAT_PLAN, TEAM_PLAN, TOPUP_PLAN } from "../../lib/billing/plans";
import { MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { setSeats, teamSeats, unlessDeclined } from "./seats";
import { purchasing, unlessPaymentOpen } from "./purchases";
import { costsMore, findPlan, topUpBundles } from "../../lib/billing/catalog";
import { refuseApps } from "../lib/auth";

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
async function requireChoosablePlan(ctx: ActionCtx, planId: string): Promise<BillingCatalog> {
  const catalog = await requireCatalog(ctx);
  const plan = findPlan(catalog, planId);
  if (!plan || plan.addOn || plan.autoEnable || plan.byRequest || ORGANIZATION_PLANS.includes(plan.id)) {
    throw createError("BILLING_PLAN_INVALID", `No plan "${planId}" to choose`);
  }
  return catalog;
}

/**
 * An upgrade from one paid plan to another starts a new month (#860), as Claude's Pro to Max does: the new
 * plan's full price less the old one's unused days, renewing a month on. Kept in the old month, a prorated
 * price bought a full month of the new plan's credits for cents. A first plan starts its month anyway, and
 * a downgrade waits for the renewal, where Autumn refuses a new month.
 */
function startsNewMonth(catalog: BillingCatalog, customer: AutumnCustomer, planId: string): boolean {
  // The price as subscribed, since a plan taken off the catalog still has subscribers.
  const price = customer.subscriptions.find((sub) => sub.status === "active" && !sub.add_on && !sub.auto_enable)?.plan?.price;
  const next = findPlan(catalog, planId);
  return Boolean(price && next && costsMore({ price }, next));
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
    await refuseApps(ctx);
    const user = await requireUser(ctx);
    const catalog = await requireChoosablePlan(ctx, plan);
    const workspaceId = await ownWorkspace(ctx, user);
    // A declined card changes nothing and says why; Autumn voids the invoice it left (#40).
    const result = await purchasing(ctx, workspaceId, user._id, { plans: true }, async (customer) => unlessDeclined(await autumn.attach({
      customerId: user._id,
      planId: plan,
      successUrl: returnUrl("checkout"),
      newMonth: startsNewMonth(catalog, customer, plan),
    })));
    await refreshAccount(ctx, workspaceId, { card: true });
    return { url: result.payment_url };
  },
});

/** Undoes a scheduled cancellation or downgrade: the person's own, or in `workspaceId` its organization's, which its admins keep (#862). */
export const keepPlan = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    await refuseApps(ctx);
    const user = await requireUser(ctx);
    if (workspaceId) await organizationAdminOf(ctx, workspaceId);
    const workspace = workspaceId ?? (await ownWorkspace(ctx, user));
    const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId: workspace });
    const account = await refreshAccount(ctx, workspace, { card: true });
    if (account.plan && account.changesAt) {
      await autumn.update({ customerId, planId: account.plan, cancelAction: "uncancel" });
      await refreshAccount(ctx, workspace, { card: true });
      // An organization kept on Team takes members up to its seats again.
      if (workspaceId) await ctx.runAction(internal.billing.seats.sync, { workspaceId });
    }
    return null;
  },
});

const previewResult = v.object({
  dueNow: v.number(),
  currency: v.string(),
  lineItems: previewLineItemsValidator,
  renewsAt: v.optional(v.number()),
  card: v.optional(v.object({ brand: v.string(), last4: v.string() })),
});
type PreviewResult = Infer<typeof previewResult>;

/**
 * What a change charges now in the currency's main unit (negative: a credit on the next bill), its
 * lines, when `planId` then renews, from its line (a change scheduled for the renewal has none), and
 * the saved card Autumn would charge. No card means the change goes to Checkout.
 */
function previewOf(preview: AutumnPreview, planId: string, customer: AutumnCustomer): PreviewResult {
  const card = customer.payment_method?.card;
  const renewsAt = preview.line_items.find((item) => item.plan_id === planId)?.period?.end;
  return {
    dueNow: preview.total,
    currency: preview.currency,
    // Autumn sends a line per charge and credit of the change, a handful; the cap is what the dialog lists.
    lineItems: preview.line_items.slice(0, MAX_PLAN_DETAILS).map((item) => ({ description: item.description, amount: item.total })),
    ...(renewsAt ? { renewsAt } : {}),
    ...(card ? { card: { brand: card.brand, last4: card.last4 } } : {}),
  };
}

/** What changing to `plan` charges now. The card is read live, since the cached snapshot can lag the Stripe portal. */
export const previewPlan = action({
  args: { plan: v.string() },
  returns: previewResult,
  handler: async (ctx, { plan }): Promise<PreviewResult> => {
    await refuseApps(ctx);
    const user = await requireUser(ctx);
    const catalog = await requireChoosablePlan(ctx, plan);
    const customer = await autumn.customer(user._id, { card: true, plans: true });
    const preview = await autumn.previewAttach(user._id, plan, startsNewMonth(catalog, customer, plan));
    // Read after the quote: a charge declined meanwhile in another tab, which leaves Autumn quoting nothing, is caught (#858).
    unlessPaymentOpen(await autumn.customer(user._id, { invoices: true }));
    return previewOf(preview, plan, customer);
  },
});

export const buyCredits = action({
  args: { credits: v.number(), workspaceId: v.optional(v.id("workspaces")) },
  returns: checkoutResult,
  handler: async (ctx, { credits, workspaceId }): Promise<{ url: string | null }> => {
    await refuseApps(ctx);
    const user = await requireUser(ctx);
    const payer = await payerIn(ctx, user, workspaceId);
    const bundles = topUpBundles(await requireCatalog(ctx));
    if (!bundles.some((bundle) => bundle.credits === credits)) {
      throw createError("CREDITS_TOPUP_BUNDLE_INVALID", `No top-up of ${credits} credits`);
    }
    const result = await purchasing(ctx, payer.workspaceId, payer.customerId, {}, async () => unlessDeclined(await autumn.attach({
      customerId: payer.customerId,
      planId: TOPUP_PLAN,
      credits,
      successUrl: returnUrl("topup", payer.page),
    })));
    await refreshAccount(ctx, payer.workspaceId, { card: true });
    return { url: result.payment_url };
  },
});

/** Stripe's portal for invoices and payment methods: the person's own, or in `workspaceId` its organization's, which its admins manage. */
export const openPortal = action({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.string(),
  handler: async (ctx, { workspaceId }): Promise<string> => {
    await refuseApps(ctx);
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

/** Refuses a move to Team while it isn't on sale. */
async function requireSeatBilling(ctx: ActionCtx) {
  if (!(await ctx.runQuery(internal.billing.seats.seatBilling, {}))) throw createError("BILLING_PLAN_INVALID", "The Team plan isn't on sale during the public alpha.");
}

/** What moving an organization to Team with `seats` seats charges now (#862), as Autumn previews it: one charge for them all. */
export const previewTeam = action({
  args: { workspaceId: v.id("workspaces"), seats: v.number() },
  returns: previewResult,
  handler: async (ctx, { workspaceId, seats }): Promise<PreviewResult> => {
    await refuseApps(ctx);
    await requireUser(ctx);
    await organizationAdminOf(ctx, workspaceId);
    await requireSeatBilling(ctx);
    const preview = await autumn.previewAttach(workspaceId, TEAM_PLAN, false, teamSeats(seats));
    // Read after the quote, as previewPlan's is.
    const customer = await autumn.customer(workspaceId, { card: true, invoices: true });
    unlessPaymentOpen(customer);
    return previewOf(preview, SEAT_PLAN, customer);
  },
});

/**
 * Moves an organization to Team with `seats` seats (#862), charged together to its saved card,
 * each seat adding its credits to the pool; there must be one for each member and pending
 * invitation. Without a saved card, or when the card asks to confirm the charge, it returns
 * Stripe's page for that, after which Autumn moves it and its webhook gives the members their seats
 * (autumnWebhook.ts). A declined card changes nothing.
 */
export const moveToTeam = action({
  args: { workspaceId: v.id("workspaces"), seats: v.number() },
  returns: checkoutResult,
  handler: async (ctx, { workspaceId, seats }): Promise<{ url: string | null }> => {
    await refuseApps(ctx);
    await requireUser(ctx);
    const organization = await organizationAdminOf(ctx, workspaceId);
    await requireSeatBilling(ctx);
    const counted: { members: number; invitations: number } | null = await ctx.runQuery(internal.billing.seats.countsFor, { workspaceId });
    const inUse = (counted?.members ?? 0) + (counted?.invitations ?? 0);
    if (!Number.isInteger(seats) || seats < inUse || seats > MAX_ORGANIZATION_MEMBERS)
      throw createError("CONFLICT", `${organization.name} has ${inUse} members and invitations now, each taking a seat. Choose ${inUse} to ${MAX_ORGANIZATION_MEMBERS.toLocaleString("en")} seats and confirm again.`);
    const moved = await purchasing(ctx, workspaceId, workspaceId, {}, async () => unlessDeclined(await autumn.attach({ customerId: workspaceId, planId: TEAM_PLAN, seats: teamSeats(seats), successUrl: returnUrl("team", `/o/${organization.slug}/pricing`) })));
    if (!moved.payment_url) await ctx.runAction(internal.billing.seats.sync, { workspaceId });
    await refreshAccount(ctx, workspaceId, { card: true });
    return { url: moved.payment_url };
  },
});

/** What changing an organization's Team to `seats` seats charges now (#862): an added seat its days left to the renewal, a removed one a credit on the next bill. */
export const previewSeats = action({
  args: { workspaceId: v.id("workspaces"), seats: v.number() },
  returns: previewResult,
  handler: async (ctx, { workspaceId, seats }): Promise<PreviewResult> => {
    await refuseApps(ctx);
    await requireUser(ctx);
    await organizationAdminOf(ctx, workspaceId);
    await requireSeatBilling(ctx);
    const preview = await autumn.previewUpdate(workspaceId, TEAM_PLAN, teamSeats(seats));
    // Read after the quote, as previewPlan's is.
    const customer = await autumn.customer(workspaceId, { card: true, invoices: true });
    unlessPaymentOpen(customer);
    return previewOf(preview, SEAT_PLAN, customer);
  },
});

/** Sets how many seats an organization on Team holds (#862), down to those in use; see `setSeats`. */
export const changeSeats = action({
  args: { workspaceId: v.id("workspaces"), seats: v.number() },
  returns: checkoutResult,
  handler: async (ctx, { workspaceId, seats }): Promise<{ url: string | null }> => {
    await refuseApps(ctx);
    await requireUser(ctx);
    await organizationAdminOf(ctx, workspaceId);
    const url = await setSeats(ctx, workspaceId, seats);
    await refreshAccount(ctx, workspaceId, { card: true });
    return { url };
  },
});

/**
 * Moves an organization back to the free plan (#652) at its Team's renewal, as a person's plan moves
 * down; until then it keeps Team and its seats, and `keepPlan` takes the move back. Free has up to
 * FREE_MEMBERS members, invitations included: Clerk holds it there from now.
 */
export const moveToFree = action({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    await refuseApps(ctx);
    const user = await requireUser(ctx);
    await organizationAdminOf(ctx, workspaceId);
    // Free has no Evidence Libraries: one left behind couldn't be opened to delete, nor its organization deleted while it's there.
    const refuseWithLibrary = async () => {
      const library: string | null = await ctx.runQuery(internal.evidenceLibraries.teardown.heldBy, { workspaceId });
      if (library) throw createError("VALIDATION_ERROR", `${library} is an Evidence Community of this organization, and Free has none. Move or delete its Evidence Communities first.`);
    };
    await refuseWithLibrary();
    // A plan change like any other: alone among the organization's purchases, and not while a payment is open (#858).
    const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
    await purchasing(ctx, workspaceId, customerId, {}, async () => {
      // Clerk holds it to Free's members before they're counted, so nobody joins past them while it moves.
      await ctx.runAction(internal.billing.seats.limitToFree, { workspaceId });
      try {
        const counted: { members: number; invitations: number } | null = await ctx.runQuery(internal.billing.seats.countsFor, { workspaceId });
        if (!counted || counted.members + counted.invitations > FREE_MEMBERS) throw createError("VALIDATION_ERROR", `Free has up to ${FREE_MEMBERS} members, invitations included: remove members or cancel invitations down to ${FREE_MEMBERS} first.`);
        // Again, now that Clerk has answered: another admin may have made a library meanwhile.
        // ponytail: one made while Autumn ends the plan still lands on Free; its owners delete it from the organization's settings. Hold new libraries during a move if that ever matters.
        await refuseWithLibrary();
        await autumn.attach({ customerId, planId: ORGANIZATION_PLAN });
      } catch (error) {
        // It may still be on Team: a sync gives its members the limit of the plan it's on.
        await ctx.scheduler.runAfter(0, internal.billing.seats.sync, { workspaceId });
        throw error;
      }
    });
    await refreshAccount(ctx, workspaceId, { card: true });
    // An invitation sent while it moved passed Free's limit: it's taken back.
    await ctx.runAction(internal.organizations.manage.trimInvitations, { workspaceId, userId: user._id });
    return null;
  },
});
