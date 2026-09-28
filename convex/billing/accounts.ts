import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { autumn, type AutumnCustomer } from "./autumn";
import {
  billingAccountFields,
  billingAccountSnapshotValidator,
  type BillingAccountSnapshot,
} from "./validators";
import { PLAN_IDS, PLAN_TIER, type PlanId } from "../../lib/billing/plans";

const SIGNUP_PLAN = "signup_credits";

function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Reads what OpenScholar needs from an Autumn customer. */
export function snapshotFromCustomer(customer: AutumnCustomer): BillingAccountSnapshot {
  const main = customer.subscriptions.filter((s) => !s.add_on);
  const current = main.find((s) => s.status === "active" || s.status === "trialing");
  const scheduled = main.find((s) => s.status === "scheduled");
  const plan = current && isPlanId(current.plan_id) ? current.plan_id : "free";
  const periodEnd = current?.current_period_end ?? undefined;
  return {
    plan,
    pastDue: current?.past_due ?? false,
    renewsAt: current && !current.canceled_at && plan !== "free" ? periodEnd : undefined,
    changesAt: current?.canceled_at ? periodEnd : undefined,
    nextPlan: scheduled && isPlanId(scheduled.plan_id) ? scheduled.plan_id : undefined,
    balance: customer.balances.credits?.remaining ?? 0,
    purchased: (customer.balances.credits?.breakdown ?? [])
      .filter((balance) => balance.plan_id === "top_up")
      .reduce((sum, balance) => sum + balance.remaining, 0),
    card: customer.payment_method?.card
      ? { brand: customer.payment_method.card.brand, last4: customer.payment_method.card.last4 }
      : undefined,
    signupGranted: customer.subscriptions.some((s) => s.plan_id === SIGNUP_PLAN),
    hasPaid: plan !== "free" || (customer.purchases ?? []).length > 0,
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

/** The user's plan tier, for feature flags with a minimum tier. */
export async function planTier(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return PLAN_TIER[(await readAccount(ctx, userId))?.plan ?? "free"];
}

export const writeSnapshot = internalMutation({
  args: { userId: v.id("users"), snapshot: billingAccountSnapshotValidator },
  returns: v.null(),
  handler: async (ctx, { userId, snapshot }) => {
    const existing = await readAccount(ctx, userId);
    const row = { ...snapshot, userId, refreshedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("billingAccounts", row);
    return null;
  },
});

/** Fetches the customer from Autumn and stores the snapshot. */
export async function refreshAccount(
  ctx: ActionCtx,
  userId: Id<"users">,
  profile: { email?: string; name?: string } = {},
): Promise<BillingAccountSnapshot> {
  const snapshot = snapshotFromCustomer(await autumn.customer(userId, profile));
  await ctx.runMutation(internal.billing.accounts.writeSnapshot, { userId, snapshot });
  return snapshot;
}

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

export const refresh = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await refreshAccount(ctx, userId);
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

export const mine = query({
  args: {},
  returns: v.union(v.object(myAccountFields), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const row = await readAccount(ctx, user._id);
    if (!row) return null;
    const { _id, _creationTime, userId, refreshedAt, stripeCustomerId, ...snapshot } = row;
    return snapshot;
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
