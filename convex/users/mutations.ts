import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { PLAN_CONFIG } from "../lib/constants";

/**
 * Update current user's profile
 */
export const updateProfile = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    await ctx.db.patch(user._id, {
      ...args,
      updatedAt: Date.now(),
    });

    return user._id;
  },
});

/**
 * Ensure user exists in database (called on first login)
 */
export const ensureUser = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (existing) {
      // Update last login
      await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
      return existing._id;
    }

    // Create new user from JWT claims
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      workosId: identity.subject,
      email: identity.email ?? "",
      firstName: identity.givenName,
      lastName: identity.familyName,
      avatarUrl: identity.pictureUrl,
      state: "active",
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Initialize credits
    await ctx.db.insert("credits", {
      ownerId: userId,
      ownerType: "user",
      freeBalance: 0,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });

    // Initialize free subscription
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
  },
});
