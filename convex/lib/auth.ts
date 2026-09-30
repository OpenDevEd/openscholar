import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { createUserWithDefaults } from "./userCreation";
import { createError } from "./errors";

export type AuthContext = QueryCtx | MutationCtx;
export type ActionAuthContext = ActionCtx;

async function getUserByClerkId(
  ctx: AuthContext,
  clerkId: string
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

function assertActiveUser(user: Doc<"users">): Doc<"users"> {
  if (user.state === "suspended") {
    throw createError("FORBIDDEN", "Account suspended");
  }

  if (user.state === "deleted") {
    throw createError("FORBIDDEN", "Account deleted");
  }

  return user;
}

/**
 * The user an internal call acts for, such as an assistant tool acting for the person
 * who sent the message. Refuses a missing, suspended or deleted account, as `requireAuth` does.
 */
export async function requireActiveUser(ctx: AuthContext, userId: Id<"users">): Promise<Doc<"users">> {
  const user = await ctx.db.get("users", userId);
  if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
  return assertActiveUser(user);
}

export async function getCurrentUser(
  ctx: AuthContext
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const user = await getUserByClerkId(ctx, identity.subject);
  if (!user || user.state !== "active") return null;
  return user;
}

export async function getCurrentUserSafe(
  ctx: QueryCtx
): Promise<Doc<"users"> | null> {
  return await getCurrentUser(ctx);
}

export async function requireAuth(ctx: AuthContext, allowSyncing?: boolean): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }

  const user = await getUserByClerkId(ctx, identity.subject);

  if (!user) {
    if (allowSyncing) {
      throw createError("UNAUTHENTICATED", "User not synced yet");
    }
    throw createError("UNAUTHENTICATED", "Authentication required");
  }

  return assertActiveUser(user);
}

export async function getOrCreateUserFromIdentity(
  ctx: MutationCtx
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");

  const existing = await getUserByClerkId(ctx, identity.subject);

  if (existing) {
    assertActiveUser(existing);
    await ctx.db.patch("users", existing._id, { lastLoginAt: Date.now() });
    return existing;
  }

  const userId = await createUserWithDefaults(ctx, {
    clerkId: identity.subject,
    email: identity.email ?? "",
    firstName: identity.givenName,
    lastName: identity.familyName,
    avatarUrl: identity.pictureUrl,
  });

  return (await ctx.db.get("users", userId))!;
}

export async function getUserCredits(
  ctx: AuthContext,
  userId: Id<"users">
): Promise<Doc<"credits"> | null> {
  return await ctx.db
    .query("credits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function requireActionAuth(ctx: ActionAuthContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");
  return identity;
}
