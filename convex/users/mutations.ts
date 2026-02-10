import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { PLAN_CONFIG } from "../lib/constants";
import { createUserWithDefaults } from "../lib/userCreation";
import { createError } from "../lib/errors";



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
    if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (existing) {
      if (existing.state === "suspended") {
        throw createError("FORBIDDEN", "Account suspended");
      }
      if (existing.state === "deleted") {
        throw createError("FORBIDDEN", "Account deleted");
      }
      // Update last login
      await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
      return existing._id;
    }

    // Create new user using helper
    return await createUserWithDefaults(ctx, {
      workosId: identity.subject,
      email: identity.email ?? "",
      firstName: identity.givenName,
      lastName: identity.familyName,
      avatarUrl: identity.pictureUrl,
    });
  },
});
