import { mutation } from "../lib/functions";
import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { analyticsChoiceValidator } from "../lib/validators";
import { getIdentity, refuseApps, requireAuth } from "../lib/auth";
import { createUserWithDefaults, ensureBillingAccount } from "../lib/userCreation";
import { createError } from "../lib/errors";

export const updateProfile = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    await refuseApps(ctx);
    const user = await requireAuth(ctx);

    await ctx.db.patch("users", user._id, {
      ...args,
      updatedAt: Date.now(),
    });

    return user._id;
  },
});

/**
 * A browser's stored cookie banner answer as someone signs in. A rejection always holds. An acceptance only fills an
 * account with no answer, since it may be older than a rejection made elsewhere: when unsure, they aren't named.
 */
function consentAtSignIn(saved: Doc<"users">["analyticsConsent"], stored?: Infer<typeof analyticsChoiceValidator>) {
  if (!stored || stored === saved?.choice || (saved && stored === "granted")) return saved;
  return { choice: stored, at: Date.now() };
}

export const ensureUser = mutation({
  args: { analyticsConsent: v.optional(analyticsChoiceValidator) },
  returns: v.id("users"),
  handler: async (ctx, { analyticsConsent }) => {
    const identity = await getIdentity(ctx);
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
        analyticsConsent?: Doc<"users">["analyticsConsent"];
      } = { lastLoginAt, analyticsConsent: consentAtSignIn(existing.analyticsConsent, analyticsConsent) };

      if (!existing.email && identity.email) patch.email = identity.email;
      if (!existing.firstName && identity.givenName) patch.firstName = identity.givenName;
      if (!existing.lastName && identity.familyName) patch.lastName = identity.familyName;
      if (!existing.avatarUrl && identity.pictureUrl) patch.avatarUrl = identity.pictureUrl;
      if (patch.email ?? patch.firstName ?? patch.lastName ?? patch.avatarUrl) {
        patch.updatedAt = Date.now();
      }

      await ctx.db.patch("users", existing._id, patch);
      await ensureBillingAccount(ctx, existing._id);
      return existing._id;
    }

    return await createUserWithDefaults(ctx, {
      clerkId: identity.subject,
      email: identity.email ?? "",
      firstName: identity.givenName,
      lastName: identity.familyName,
      avatarUrl: identity.pictureUrl,
      analyticsConsent: consentAtSignIn(undefined, analyticsConsent),
    });
  },
});

/** Someone just answered the cookie banner while signed in: that's their answer now, on every device. */
export const saveAnalyticsConsent = mutation({
  args: { choice: analyticsChoiceValidator },
  returns: v.null(),
  handler: async (ctx, { choice }) => {
    const user = await requireAuth(ctx);
    await ctx.db.patch("users", user._id, { analyticsConsent: { choice, at: Date.now() } });
    return null;
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
      await ctx.db.patch("users", user._id, patch);
    }
    return null;
  },
});
