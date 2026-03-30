import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { PLAN_CONFIG, FREE_SIGNUP_CREDIT_GRANT } from "./constants";
import { applyTierFreeCreditCap } from "./freeCredits";

export async function createUserWithDefaults(
  ctx: MutationCtx,
  userData: {
    clerkId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  }
): Promise<Id<"users">> {
  const now = Date.now();
  const signupFreeCredits = applyTierFreeCreditCap({
    plan: "free",
    currentFreeBalance: 0,
    amountToAdd: FREE_SIGNUP_CREDIT_GRANT,
  });

  const userId = await ctx.db.insert("users", {
    ...userData,
    state: "active",
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("credits", {
    userId,
    freeBalance: signupFreeCredits.newFreeBalance,
    paidBalance: 0,
    lifetimeUsed: 0,
    lastUpdatedAt: now,
  });

  await ctx.db.insert("subscriptions", {
    userId,
    plan: "free",
    status: "active",
    creditsPerMonth: PLAN_CONFIG.free.creditsPerMonth,
    seats: 1,
    createdAt: now,
    updatedAt: now,
  });

  return userId;
}

/**
 * Repairs missing credits and/or subscription records for an existing user.
 * Idempotent — skips records that already exist.
 */
export async function repairUserBillingRecords(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ creditsCreated: boolean; subscriptionCreated: boolean }> {
  const now = Date.now();
  let creditsCreated = false;
  let subscriptionCreated = false;

  const existingCredits = await ctx.db
    .query("credits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  if (!existingCredits) {
    const signupFreeCredits = applyTierFreeCreditCap({
      plan: "free",
      currentFreeBalance: 0,
      amountToAdd: FREE_SIGNUP_CREDIT_GRANT,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: signupFreeCredits.newFreeBalance,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    creditsCreated = true;
  }

  const existingSubscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  if (!existingSubscription) {
    await ctx.db.insert("subscriptions", {
      userId,
      plan: "free",
      status: "active",
      creditsPerMonth: PLAN_CONFIG.free.creditsPerMonth,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });
    subscriptionCreated = true;
  }

  if (creditsCreated || subscriptionCreated) {
    console.warn(
      `[repairUserBillingRecords] Repaired user ${userId}: credits=${creditsCreated}, subscription=${subscriptionCreated}`,
    );
  }

  return { creditsCreated, subscriptionCreated };
}
