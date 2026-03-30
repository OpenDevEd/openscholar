import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createUserWithDefaults, repairUserBillingRecords } from "../lib/userCreation";
import { createError } from "../lib/errors";

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

export const ensureUser = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      if (existing.state === "suspended") {
        throw createError("FORBIDDEN", "Account suspended");
      }
      if (existing.state === "deleted") {
        throw createError("FORBIDDEN", "Account deleted");
      }

      const lastLoginAt = Date.now();
      const patch: {
        lastLoginAt: number;
        email?: string;
        firstName?: string;
        lastName?: string;
        avatarUrl?: string;
        updatedAt?: number;
      } = { lastLoginAt };

      if (!existing.email && identity.email) patch.email = identity.email;
      if (!existing.firstName && identity.givenName) patch.firstName = identity.givenName;
      if (!existing.lastName && identity.familyName) patch.lastName = identity.familyName;
      if (!existing.avatarUrl && identity.pictureUrl) patch.avatarUrl = identity.pictureUrl;
      if (patch.email ?? patch.firstName ?? patch.lastName ?? patch.avatarUrl) {
        patch.updatedAt = Date.now();
      }

      await ctx.db.patch(existing._id, patch);
      await repairUserBillingRecords(ctx, existing._id);
      return existing._id;
    }

    return await createUserWithDefaults(ctx, {
      clerkId: identity.subject,
      email: identity.email ?? "",
      firstName: identity.givenName,
      lastName: identity.familyName,
      avatarUrl: identity.pictureUrl,
    });
  },
});

export const syncProfileFromSession = mutation({
  args: {
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const patch: Record<string, unknown> = {};
    if (args.email && !user.email) patch.email = args.email;
    if (args.firstName !== undefined && !user.firstName) patch.firstName = args.firstName;
    if (args.lastName !== undefined && !user.lastName) patch.lastName = args.lastName;
    if (args.avatarUrl !== undefined && !user.avatarUrl) patch.avatarUrl = args.avatarUrl;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(user._id, patch);
    }
    return null;
  },
});
