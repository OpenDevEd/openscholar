import { internalMutation, internalQuery, type MutationCtx } from "../lib/functions";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { userValidator } from "../lib/validators";
import { createUserWithDefaults, ensureBillingAccount } from "../lib/userCreation";
import { clerkEventOutcomeValidator } from "../evidenceLibraries/validators";
import {
  applyOrderedClerkEvent,
  type ClerkEventMetadata,
  type ClerkEventOutcome,
} from "../webhooks/eventOrdering";
import { claimAdminInvite } from "../admins/access";

const clerkEventMetadataFields = {
  eventId: v.string(),
  eventType: v.string(),
  instanceId: v.string(),
  occurredAt: v.number(),
  payloadSha256: v.string(),
};

export const getCurrentUser = internalQuery({
  args: {},
  returns: userValidator,
  handler: async (ctx) => {
    return await requireAuth(ctx);
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), userValidator),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) return null;
    return user;
  },
});

type UserUpsertProjectionArgs = ClerkEventMetadata & {
  clerkId: string;
  email: string;
  verifiedEmails?: string[];
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

export async function applyUserUpsertProjection(
  ctx: MutationCtx,
  args: UserUpsertProjectionArgs,
): Promise<ClerkEventOutcome> {
  if (args.entityId !== args.clerkId) {
    throw new Error("Clerk user event entity does not match its payload");
  }
  return await applyOrderedClerkEvent(ctx, args, async () => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (existing) {
      await ctx.db.patch("users", existing._id, {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        avatarUrl: args.avatarUrl,
        state: "active",
        updatedAt: Date.now(),
      });
      await ensureBillingAccount(ctx, existing._id);
      await claimAdminInvite(ctx, existing._id, args.email, args.verifiedEmails ?? []);
      return;
    }

    const userId = await createUserWithDefaults(ctx, {
      clerkId: args.clerkId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      avatarUrl: args.avatarUrl,
    });
    await claimAdminInvite(ctx, userId, args.email, args.verifiedEmails ?? []);
  });
}

export const upsertUserFromClerk = internalMutation({
  args: {
    ...clerkEventMetadataFields,
    clerkId: v.string(),
    email: v.string(),
    verifiedEmails: v.optional(v.array(v.string())),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: clerkEventOutcomeValidator,
  handler: async (ctx, args) =>
    await applyUserUpsertProjection(ctx, {
      ...args,
      entityId: args.clerkId,
      entityType: "user",
      processedAt: Date.now(),
    }),
});

type UserDeleteProjectionArgs = ClerkEventMetadata & { clerkId: string };

export async function applyUserDeleteProjection(
  ctx: MutationCtx,
  args: UserDeleteProjectionArgs,
): Promise<ClerkEventOutcome> {
  if (args.entityId !== args.clerkId) {
    throw new Error("Clerk user event entity does not match its payload");
  }
  return await applyOrderedClerkEvent(ctx, args, async () => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    const grants = await ctx.db.query("evidenceLibraryMembers")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkId)).collect();
    for (const grant of grants) await ctx.db.delete("evidenceLibraryMembers", grant._id);
    if (!user) return;

    await ctx.db.patch("users", user._id, {
      state: "deleted",
      updatedAt: Date.now(),
    });
  });
}

export const markUserDeletedFromClerk = internalMutation({
  args: {
    ...clerkEventMetadataFields,
    clerkId: v.string(),
  },
  returns: clerkEventOutcomeValidator,
  handler: async (ctx, args) =>
    await applyUserDeleteProjection(ctx, {
      ...args,
      entityId: args.clerkId,
      entityType: "user",
      processedAt: Date.now(),
    }),
});

export const updateLastLogin = internalMutation({
  args: { clerkId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    if (!user) return null;

    await ctx.db.patch("users", user._id, {
      lastLoginAt: Date.now(),
    });

    return null;
  },
});
