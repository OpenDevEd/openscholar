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
