import { v } from "convex/values";
import { pick } from "convex-helpers";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { autumn, type AutumnCustomer } from "./autumn";
import {
  billingAccountFields,
  billingAccountSnapshotValidator,
  type BillingAccountSnapshot,
} from "./validators";
import { ORGANIZATION_PLAN, PLAN_LIMITS, SIGNUP_PLAN, TOPUP_PLAN, type PlanLimit } from "../../lib/billing/plans";
import { readCatalog } from "./catalog";

/** A person's own workspace, if they still have one: what their billing rows were paid by before workspaces paid (#650). */
export const ownWorkspaceOf = async (ctx: Pick<QueryCtx, "db">, userId: Id<"users">) =>
  (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())?._id;

/**
 * The Autumn customer a workspace's plan and credits are on (#650): a person's own workspace
 * keeps theirs, the user's ID, so no customer moved; an organization's is its workspace's ID.
 */
export async function customerOf(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">): Promise<string> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace.kind === "personal" ? workspace.userId : workspace._id;
}

/** The workspace an Autumn customer is, for what Autumn and Stripe tell us about it; null for one that isn't ours. */
export async function workspaceOfCustomer(ctx: Pick<QueryCtx, "db">, customerId: string): Promise<Id<"workspaces"> | null> {
  const userId = ctx.db.normalizeId("users", customerId);
  if (userId) return (await ownWorkspaceOf(ctx, userId)) ?? null;
  const workspaceId = ctx.db.normalizeId("workspaces", customerId);
  return workspaceId && (await ctx.db.get("workspaces", workspaceId)) ? workspaceId : null;
}

/** The workspace's Autumn customer, for an action. */
export const customerFor = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.string(),
  handler: (ctx, { workspaceId }) => customerOf(ctx, workspaceId),
});

/** Reads what OpenScholar needs from an Autumn customer. */
export function snapshotFromCustomer(customer: AutumnCustomer): BillingAccountSnapshot {
  const main = customer.subscriptions.filter((s) => !s.add_on);
  const current = main.find((s) => s.status === "active" || s.status === "trialing");
  const scheduled = main.find((s) => s.status === "scheduled");
  // The plan Autumn gives every customer (Free) is auto-enabled; any other
  // main plan was chosen and is paid for.
  const onPaidPlan = Boolean(current && !current.auto_enable);
  const periodEnd = current?.current_period_end ?? undefined;
  return {
    ...(current ? { plan: current.plan_id } : {}),
    pastDue: current?.past_due ?? false,
    periodStart: onPaidPlan ? (current?.current_period_start ?? undefined) : undefined,
    renewsAt: onPaidPlan && !current?.canceled_at ? periodEnd : undefined,
    changesAt: current?.canceled_at ? periodEnd : undefined,
    nextPlan: scheduled?.plan_id,
    features: Object.keys(customer.flags ?? {}),
    balance: customer.balances.credits?.remaining ?? 0,
    // A limit is never used up, so what the plans grant is the limit itself.
    limits: Object.fromEntries(PLAN_LIMITS.flatMap((limit) => {
      const balance = customer.balances[limit];
      return balance ? [[limit, balance.unlimited ? null : (balance.granted ?? balance.remaining)]] : [];
    })),
    purchased: (customer.balances.credits?.breakdown ?? [])
      .filter((balance) => balance.plan_id === TOPUP_PLAN)
      .reduce((sum, balance) => sum + balance.remaining, 0),
    card: customer.payment_method?.card
      ? { brand: customer.payment_method.card.brand, last4: customer.payment_method.card.last4 }
      : undefined,
    signupGranted: customer.subscriptions.some((s) => s.plan_id === SIGNUP_PLAN),
    hasPaid: onPaidPlan || (customer.purchases ?? []).length > 0,
    stripeCustomerId: customer.stripe_id ?? undefined,
  };
}

/** The workspace's cached account: its Autumn customer's plan, features and balance (#650). */
export async function readAccount(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("billingAccounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

/** The workspace's cached balance, for preflight checks. Locks enforce the real limit. */
export async function availableCredits(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) {
  return (await readAccount(ctx, workspaceId))?.balance ?? 0;
}

/**
 * What the workspace's plan allows of `limit` (#632; the workspace's since #650), or
 * undefined when it sets none. Its cached snapshot says, unless its plan's version predates
 * the limit or nothing is cached yet: then its plan in the synced catalog does, or, with no
 * plan, the plan a new customer of its kind starts on. A plan the catalog no longer lists
 * sets none.
 */
export async function planLimit(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, limit: PlanLimit): Promise<number | undefined> {
  const account = await readAccount(ctx, workspaceId);
  const own = account?.limits?.[limit];
  if (own !== undefined) return own ?? undefined;
  const plans = (await readCatalog(ctx))?.plans ?? [];
  const organization = (await ctx.db.get("workspaces", workspaceId))?.kind === "organization";
  const plan = account?.plan
    ? plans.find((candidate) => candidate.id === account.plan)
    : plans.find((candidate) => (organization ? candidate.id === ORGANIZATION_PLAN : candidate.autoEnable && !candidate.addOn));
  return plan?.limits?.[limit] ?? undefined;
}

/** Refuses a request for more papers than the workspace's plan takes in one (#632). */
export async function checkRequestPapers(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, papers: number, what: "screening" | "extraction") {
  const most = await planLimit(ctx, workspaceId, "request_papers");
  if (most !== undefined && papers > most) {
    throw createError("VALIDATION_ERROR", `Your plan takes up to ${most.toLocaleString("en")} papers in one ${what}. Pick fewer, or change plan for more.`);
  }
}

/** Whether the workspace's plans grant `featureId`, per the cached snapshot. */
export async function hasPlanFeature(
  ctx: Pick<QueryCtx, "db">,
  workspaceId: Id<"workspaces">,
  featureId: string,
): Promise<boolean> {
  return (await readAccount(ctx, workspaceId))?.features?.includes(featureId) ?? false;
}

/**
 * Stores a snapshot read from Autumn at `fetchedAt`. `withCard` says its card
 * was fetched; without it the cached card stays. A balance the cache learned
 * after `fetchedAt` (a charge that emptied it) stays too.
 */
export const writeSnapshot = internalMutation({
  args: { workspaceId: v.id("workspaces"), snapshot: billingAccountSnapshotValidator, withCard: v.boolean(), fetchedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, snapshot, withCard, fetchedAt }) => {
    const existing = await readAccount(ctx, workspaceId);
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (!workspace) return null;
    // A snapshot read before the one cached would bring back an older plan and its limits. Its card can still be the newest read.
    if (existing?.fetchedAt !== undefined && existing.fetchedAt > fetchedAt) {
      if (withCard && (existing.cardFetchedAt ?? 0) < fetchedAt) await ctx.db.patch("billingAccounts", existing._id, { card: snapshot.card, cardFetchedAt: fetchedAt });
      return null;
    }
    const newer = existing !== null && existing.refreshedAt > fetchedAt;
    const row = {
      ...snapshot,
      ...(withCard ? { card: snapshot.card, cardFetchedAt: fetchedAt } : { card: existing?.card, cardFetchedAt: existing?.cardFetchedAt }),
      ...(newer && { balance: existing.balance, purchased: existing.purchased }),
      // A person's own workspace's account still names them, until slice 8 drops the field.
      ...(workspace.kind === "personal" ? { userId: workspace.userId } : {}),
      workspaceId,
      refreshedAt: newer ? existing.refreshedAt : fetchedAt,
      fetchedAt,
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("billingAccounts", row);
    return null;
  },
});

/**
 * Zeroes the cached balance now, so work that only checks the cache stops: a
 * charge reported the balance empty, or couldn't reach Autumn. The queued
 * refresh restores the real balance.
 */
export async function zeroCachedBalance(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const account = await readAccount(ctx, workspaceId);
  if (account && account.balance > 0) {
    await ctx.db.patch("billingAccounts", account._id, { balance: 0, purchased: 0, refreshedAt: Date.now() });
  }
  await requestRefresh(ctx, workspaceId);
}

export const zeroBalance = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    await zeroCachedBalance(ctx, workspaceId);
    return null;
  },
});

/**
 * Fetches the customer from Autumn and stores the snapshot. The card costs
 * Autumn a call to Stripe, so only billing screens and card events ask for it.
 */
export async function refreshAccount(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  options: { email?: string; name?: string; card?: boolean } = {},
): Promise<BillingAccountSnapshot> {
  const fetchedAt = Date.now();
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  const snapshot = snapshotFromCustomer(await autumn.customer(customerId, options));
  await ctx.runMutation(internal.billing.accounts.writeSnapshot, { workspaceId, snapshot, withCard: options.card ?? false, fetchedAt });
  return snapshot;
}

/** How long charges wait before the account re-reads Autumn, so a burst of them reads it once. */
const REFRESH_DELAY_MS = 3_000;
/** A queued refresh older than this failed; the next charge queues another. */
const REFRESH_STUCK_MS = 60_000;

/**
 * Re-reads the account from Autumn shortly, unless a re-read is already
 * queued. Charges call it instead of reading Autumn themselves, so parallel
 * work doesn't write the account row once per charge.
 */
export async function requestRefresh(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const account = await readAccount(ctx, workspaceId);
  if (account?.refreshQueuedAt && Date.now() - account.refreshQueuedAt < REFRESH_STUCK_MS) return;
  if (account) await ctx.db.patch("billingAccounts", account._id, { refreshQueuedAt: Date.now() });
  await ctx.scheduler.runAfter(REFRESH_DELAY_MS, internal.billing.accounts.refresh, { workspaceId });
}

export const refresh = internalAction({
  // `userId` alone: a refresh scheduled before accounts were a workspace's (#650), which is the person's own; slice 8 drops it.
  args: { workspaceId: v.optional(v.id("workspaces")), userId: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId }) => {
    const refreshed = workspaceId ?? (userId ? await ctx.runQuery(internal.workspaces.actor.personalOf, { userId }) : null);
    if (refreshed) await refreshAccount(ctx, refreshed);
    return null;
  },
});

/**
 * Creates the Autumn customer and grants the one-time signup credits.
 * Scheduled once when the user row is created; safe to run again.
 */
export const provision = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) return null;
    const workspaceId: Id<"workspaces"> = await ctx.runQuery(internal.workspaces.actor.personalOf, { userId });
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
    const snapshot = await refreshAccount(ctx, workspaceId, { email: user.email, name });
    if (!snapshot.signupGranted) {
      await autumn.attach({
        customerId: userId,
        planId: SIGNUP_PLAN,
        idempotencyKey: `signup-${userId}`,
      });
      await refreshAccount(ctx, workspaceId);
    }
    return null;
  },
});

/**
 * Creates an organization's Autumn customer, its workspace's ID, on the free organization
 * plan (#650): its own credits and limits from the start. Safe to run again.
 */
export const provisionOrganization = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const organization = await ctx.runQuery(internal.billing.accounts.organizationOf, { workspaceId });
    if (!organization) return null;
    const snapshot = await refreshAccount(ctx, workspaceId, { name: organization.name });
    // Autumn gives every new customer the personal Free plan; the organization plan, in its group, takes its place.
    // One that has paid for a plan of its own keeps it.
    if (snapshot.plan !== ORGANIZATION_PLAN && !snapshot.hasPaid) {
      await autumn.attach({ customerId: workspaceId, planId: ORGANIZATION_PLAN, idempotencyKey: `organization-${workspaceId}` });
      await refreshAccount(ctx, workspaceId);
    }
    return null;
  },
});

/** The organization a workspace is, if it's one. */
export const organizationOf = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.object({ name: v.string() }), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    return organization ? { name: organization.name } : null;
  },
});

/** How old a cached account may be before opening billing re-reads it. */
const REFRESH_AFTER_MS = 30_000;

/**
 * Re-reads the signed-in user's account from Autumn. The billing page calls
 * it while rendering on the server, so edits made in Autumn's dashboard
 * that send no webhook (a balance grant, say) show when the page opens.
 */
export const refreshMine = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) return null;
    // The billing page is the person's own until organizations have theirs (#651, #652).
    const workspaceId: Id<"workspaces"> = await ctx.runQuery(internal.workspaces.actor.personalOf, { userId: user._id });
    const account = await ctx.runQuery(internal.billing.accounts.forWorkspace, { workspaceId });
    if (account && Date.now() - account.refreshedAt < REFRESH_AFTER_MS) return null;
    await refreshAccount(ctx, workspaceId, { card: true });
    return null;
  },
});

/** What the workspace's plan allows of `limit`, for an action: a number, or null for none. */
export const planLimitOf = internalQuery({
  args: { workspaceId: v.id("workspaces"), limit: v.union(...PLAN_LIMITS.map((limit) => v.literal(limit))) },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { workspaceId, limit }) => (await planLimit(ctx, workspaceId, limit)) ?? null,
});

export const forWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.object(billingAccountFields), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const row = await readAccount(ctx, workspaceId);
    if (!row) return null;
    const { _id, _creationTime, ...fields } = row;
    return fields;
  },
});

const { stripeCustomerId: _stripeCustomerId, ...myAccountFields } =
  billingAccountSnapshotValidator.fields;
const myAccountKeys = Object.keys(myAccountFields) as (keyof typeof myAccountFields)[];

export const mine = query({
  args: {},
  returns: v.union(v.object(myAccountFields), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const workspaceId = user ? await ownWorkspaceOf(ctx, user._id) : undefined;
    if (!workspaceId) return null;
    // The person's own workspace's, until organizations have billing pages (#651, #652).
    const row = await readAccount(ctx, workspaceId);
    if (!row) return null;
    // Copy only the fields the validator declares, so internal columns stay private.
    return pick(row, myAccountKeys);
  },
});

/** What the signed-in person's plan allows of each limit (#632): a number, or null for none. Null when signed out. */
export const myLimits = query({
  args: {},
  returns: v.union(v.object({ collections: v.union(v.number(), v.null()), concurrency: v.union(v.number(), v.null()), assistant_replies: v.union(v.number(), v.null()), request_papers: v.union(v.number(), v.null()) }), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const workspaceId = user ? await ownWorkspaceOf(ctx, user._id) : undefined;
    if (!workspaceId) return null;
    const limit = async (name: PlanLimit) => (await planLimit(ctx, workspaceId, name)) ?? null;
    return { collections: await limit("collections"), concurrency: await limit("concurrency"), assistant_replies: await limit("assistant_replies"), request_papers: await limit("request_papers") };
  },
});

/** Preflight for dialogs that start paid work. Locks enforce the real limit. */
export const checkBalance = query({
  args: { requiredAmount: v.number() },
  returns: v.union(
    v.object({
      hasEnough: v.boolean(),
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      required: v.number(),
      deficit: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { requiredAmount }) => {
    const user = await getCurrentUser(ctx);
    const workspaceId = user ? await ownWorkspaceOf(ctx, user._id) : undefined;
    if (!workspaceId) return null;
    const account = await readAccount(ctx, workspaceId);
    const total = account?.balance ?? 0;
    const paid = account?.purchased ?? 0;
    return {
      hasEnough: total >= requiredAmount,
      free: total - paid,
      paid,
      total,
      required: requiredAmount,
      deficit: Math.max(0, requiredAmount - total),
    };
  },
});
