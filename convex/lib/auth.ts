import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { createUserWithDefaults } from "./userCreation";
import { createError } from "./errors";


export type AuthContext = QueryCtx | MutationCtx;
export type ActionAuthContext = ActionCtx;

async function getUserByWorkosId(
  ctx: AuthContext,
  workosId: string
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", workosId))
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
 * Get current user from JWT identity
 * Returns null if not authenticated
 */
export async function getCurrentUser(
  ctx: AuthContext
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const user = await getUserByWorkosId(ctx, identity.subject);
  if (!user || user.state !== "active") return null;
  return user;
}

/**
 * Get current user without throwing - returns null if not authenticated or not synced
 * Use this for queries that need graceful handling during first-login sync
 * This is an alias to getCurrentUser for consistency, as getCurrentUser already returns null safely
 */
export async function getCurrentUserSafe(
  ctx: QueryCtx
): Promise<Doc<"users"> | null> {
  return await getCurrentUser(ctx);
}

/**
 * Require authenticated user
 * Throws if not authenticated or account is not active
 */
export async function requireAuth(ctx: AuthContext, allowSyncing?: boolean): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }

  const user = await getUserByWorkosId(ctx, identity.subject);

  if (!user) {
    if (allowSyncing) {
      throw createError("UNAUTHENTICATED", "User not synced yet");
    }
    throw createError("UNAUTHENTICATED", "Authentication required");
  }

  return assertActiveUser(user);
}

/**
 * Require user to be a member of the organization
 */
export async function requireOrgMember(
  ctx: AuthContext,
  organizationId: Id<"organizations">
): Promise<{ user: Doc<"users">; membership: Doc<"memberships"> }> {
  const user = await requireAuth(ctx);

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) =>
      q.eq("userId", user._id).eq("organizationId", organizationId)
    )
    .unique();

  if (!membership) throw createError("FORBIDDEN", "Not a member of this organization");
  return { user, membership };
}

/**
 * Require user to be an admin or owner of the organization
 */
export async function requireOrgAdmin(
  ctx: AuthContext,
  organizationId: Id<"organizations">
): Promise<{ user: Doc<"users">; membership: Doc<"memberships"> }> {
  const { user, membership } = await requireOrgMember(ctx, organizationId);

  if (membership.role !== "owner" && membership.role !== "admin") {
    throw createError("FORBIDDEN", "Admin access required");
  }
  return { user, membership };
}

/**
 * Require user to be the owner of the organization
 */
export async function requireOrgOwner(
  ctx: AuthContext,
  organizationId: Id<"organizations">
): Promise<{ user: Doc<"users">; membership: Doc<"memberships"> }> {
  const { user, membership } = await requireOrgMember(ctx, organizationId);

  if (membership.role !== "owner") {
    throw createError("FORBIDDEN", "Owner access required");
  }
  return { user, membership };
}

/**
 * Get or create user from JWT identity (for first-time login)
 */
export async function getOrCreateUserFromIdentity(
  ctx: MutationCtx
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");

  const existing = await getUserByWorkosId(ctx, identity.subject);

  if (existing) {
    assertActiveUser(existing);
    // Update last login
    await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
    return existing;
  }

  // Create new user from JWT claims
  const userId = await createUserWithDefaults(ctx, {
    workosId: identity.subject,
    email: identity.email ?? "",
    firstName: identity.givenName,
    lastName: identity.familyName,
    avatarUrl: identity.pictureUrl,
  });

  return (await ctx.db.get(userId))!;
}

/**
 * Get user's credits balance
 */
export async function getUserCredits(
  ctx: AuthContext,
  userId: Id<"users">
): Promise<Doc<"credits"> | null> {
  return await ctx.db
    .query("credits")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", userId).eq("ownerType", "user")
    )
    .unique();
}

/**
 * Get organization's credits balance
 */
export async function getOrgCredits(
  ctx: AuthContext,
  organizationId: Id<"organizations">
): Promise<Doc<"credits"> | null> {
  return await ctx.db
    .query("credits")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", organizationId).eq("ownerType", "organization")
    )
    .unique();
}

/**
 * Require authenticated user in Action
 * Returns the UserIdentity since DB access is not available
 */
export async function requireActionAuth(ctx: ActionAuthContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw createError("UNAUTHENTICATED", "Authentication required");
  return identity;
}
