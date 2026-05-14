import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { PLAN_CONFIG } from "./constants";
import { createCreditsForUser } from "../credits/internal";

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

  const userId = await ctx.db.insert("users", {
    ...userData,
    state: "active",
    libraryItemCount: 0,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await createCreditsForUser(ctx, userId, now);

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
    await createCreditsForUser(ctx, userId, now);
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
