import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { PLAN_CONFIG } from "./constants";

export async function createUserWithDefaults(
  ctx: MutationCtx,
  userData: {
    workosId: string;
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
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("credits", {
    ownerId: userId,
    ownerType: "user",
    freeBalance: 0,
    paidBalance: 0,
    lifetimeUsed: 0,
    lastUpdatedAt: now,
  });

  await ctx.db.insert("subscriptions", {
    ownerId: userId,
    ownerType: "user",
    plan: "free",
    status: "active",
    creditsPerMonth: PLAN_CONFIG.free.creditsPerMonth,
    seats: 1,
    createdAt: now,
    updatedAt: now,
  });

  return userId;
}
