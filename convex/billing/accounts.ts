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
import { PLAN_LIMITS, SIGNUP_PLAN, TOPUP_PLAN, type PlanLimit } from "../../lib/billing/plans";
import { readCatalog } from "./catalog";

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

export async function readAccount(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("billingAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** The cached balance, for preflight checks. Locks enforce the real limit. */
export async function availableCredits(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return (await readAccount(ctx, userId))?.balance ?? 0;
}

/**
 * What the person's plan allows of `limit` (#632), or undefined when it sets none. Their
 * cached snapshot says, unless their plan's version predates the limit or nothing is cached
 * yet: then their plan in the synced catalog does, or, with no plan, the plan every new
 * customer gets. A plan the catalog no longer lists sets none.
 */
export async function planLimit(ctx: QueryCtx | MutationCtx, userId: Id<"users">, limit: PlanLimit): Promise<number | undefined> {
  const account = await readAccount(ctx, userId);
  const own = account?.limits?.[limit];
  if (own !== undefined) return own ?? undefined;
  const plans = (await readCatalog(ctx))?.plans ?? [];
  const plan = account?.plan ? plans.find((candidate) => candidate.id === account.plan) : plans.find((candidate) => candidate.autoEnable && !candidate.addOn);
  return plan?.limits?.[limit] ?? undefined;
}

/** Refuses a request for more papers than the person's plan takes in one (#632). */
export async function checkRequestPapers(ctx: QueryCtx | MutationCtx, userId: Id<"users">, papers: number, what: "screening" | "extraction") {
  const most = await planLimit(ctx, userId, "request_papers");
  if (most !== undefined && papers > most) {
    throw createError("VALIDATION_ERROR", `Your plan takes up to ${most.toLocaleString("en")} papers in one ${what}. Pick fewer, or change plan for more.`);
  }
}

/** Whether the user's plans grant `featureId`, per the cached snapshot. */
export async function hasPlanFeature(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  featureId: string,
): Promise<boolean> {
  return (await readAccount(ctx, userId))?.features?.includes(featureId) ?? false;
}

/**
 * Stores a snapshot read from Autumn at `fetchedAt`. `withCard` says its card
 * was fetched; without it the cached card stays. A balance the cache learned
 * after `fetchedAt` (a charge that emptied it) stays too.
 */
export const writeSnapshot = internalMutation({
  args: { userId: v.id("users"), snapshot: billingAccountSnapshotValidator, withCard: v.boolean(), fetchedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, snapshot, withCard, fetchedAt }) => {
    const existing = await readAccount(ctx, userId);
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
      userId,
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
export async function zeroCachedBalance(ctx: MutationCtx, userId: Id<"users">) {
  const account = await readAccount(ctx, userId);
  if (account && account.balance > 0) {
    await ctx.db.patch("billingAccounts", account._id, { balance: 0, purchased: 0, refreshedAt: Date.now() });
  }
  await requestRefresh(ctx, userId);
}

export const zeroBalance = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await zeroCachedBalance(ctx, userId);
    return null;
  },
});

/**
 * Fetches the customer from Autumn and stores the snapshot. The card costs
 * Autumn a call to Stripe, so only billing screens and card events ask for it.
 */
export async function refreshAccount(
  ctx: ActionCtx,
  userId: Id<"users">,
  options: { email?: string; name?: string; card?: boolean } = {},
): Promise<BillingAccountSnapshot> {
  const fetchedAt = Date.now();
  const snapshot = snapshotFromCustomer(await autumn.customer(userId, options));
  await ctx.runMutation(internal.billing.accounts.writeSnapshot, { userId, snapshot, withCard: options.card ?? false, fetchedAt });
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
export async function requestRefresh(ctx: MutationCtx, userId: Id<"users">) {
  const account = await readAccount(ctx, userId);
  if (account?.refreshQueuedAt && Date.now() - account.refreshQueuedAt < REFRESH_STUCK_MS) return;
  if (account) await ctx.db.patch("billingAccounts", account._id, { refreshQueuedAt: Date.now() });
  await ctx.scheduler.runAfter(REFRESH_DELAY_MS, internal.billing.accounts.refresh, { userId });
}

export const refresh = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await refreshAccount(ctx, userId);
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
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
    const snapshot = await refreshAccount(ctx, userId, { email: user.email, name });
    if (!snapshot.signupGranted) {
      await autumn.attach({
        customerId: userId,
        planId: SIGNUP_PLAN,
        idempotencyKey: `signup-${userId}`,
      });
      await refreshAccount(ctx, userId);
    }
    return null;
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
    const account = await ctx.runQuery(internal.billing.accounts.forUser, { userId: user._id });
    if (account && Date.now() - account.refreshedAt < REFRESH_AFTER_MS) return null;
    await refreshAccount(ctx, user._id, { card: true });
    return null;
  },
});

export const forUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.object(billingAccountFields), v.null()),
  handler: async (ctx, { userId }) => {
    const row = await readAccount(ctx, userId);
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
    if (!user) return null;
    const row = await readAccount(ctx, user._id);
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
    if (!user) return null;
    const limit = async (name: PlanLimit) => (await planLimit(ctx, user._id, name)) ?? null;
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
    if (!user) return null;
    const account = await readAccount(ctx, user._id);
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
