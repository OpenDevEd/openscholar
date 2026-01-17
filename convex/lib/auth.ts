import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

export type AuthContext = QueryCtx | MutationCtx;
export type ActionAuthContext = ActionCtx;

/**
 * Get current user from JWT identity
 * Returns null if not authenticated
 */
export async function getCurrentUser(
  ctx: AuthContext
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
    .unique();
}

/**
 * Require authenticated user
 * Throws if not authenticated or account is not active
 */
export async function requireAuth(ctx: AuthContext, allowSyncing?: boolean): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  
  if (!user) {
    const identity = await ctx.auth.getUserIdentity();
    if (identity && allowSyncing) {
      // User is authenticated but not yet in DB (race condition)
      // Return a temporary mock or throw a specific error the client can handle?
      // Actually, safest is to throw a specific error or strict null check
       throw new Error("Unauthenticated"); // Keep behavior for now, modify getCurrentUser?
    }
    throw new Error("Unauthenticated");
  }

  if (user.state !== "active") throw new Error("Account suspended");
  return user;
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

  if (!membership) throw new Error("Not a member of this organization");
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
    throw new Error("Admin access required");
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
    throw new Error("Owner access required");
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
  if (!identity) throw new Error("Unauthenticated");

  const existing = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
    .unique();

  if (existing) {
    // Update last login
    await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
    return existing;
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

  // Initialize credits for new user
  await ctx.db.insert("credits", {
    ownerId: userId,
    ownerType: "user",
    balance: 0,
    lifetimeUsed: 0,
    lastUpdatedAt: now,
  });

  // Initialize free subscription
  await ctx.db.insert("subscriptions", {
    ownerId: userId,
    ownerType: "user",
    plan: "free",
    status: "active",
    createdAt: now,
    updatedAt: now,
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
  if (!identity) throw new Error("Unauthenticated");
  return identity;
}
