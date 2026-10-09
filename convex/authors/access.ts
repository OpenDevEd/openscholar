import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getCurrentUser, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_PROFILE_MEMBERS } from "../lib/queryBounds";
import { actorIn } from "../workspaces/actor";

export async function profileRole(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  return profileRoleForUser(ctx, profile, user._id);
}

/**
 * What a person may do with a profile: own it as its maker or an admin of the workspace
 * that owns it (#650), or edit it when they were invited to.
 */
export async function profileRoleForUser(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">, userId: Id<"users">) {
  // Its maker and the workspace's admins own it while they can act in that workspace; one who left it keeps only an invitation of their own.
  const user = profile.workspaceId ? await ctx.db.get("users", userId) : null;
  const actor = user && profile.workspaceId ? await actorIn(ctx, user, profile.workspaceId) : null;
  if (actor && (actor.role === "admin" || profile.createdBy === userId)) return "owner" as const;
  const member = await ctx.db.query("authorProfileMembers")
    .withIndex("by_profileId_and_userId", q => q.eq("profileId", profile._id).eq("userId", userId)).unique();
  return member ? "editor" as const : null;
}

/**
 * The people who own a profile: its maker, and the admins of the workspace that owns it: the
 * person whose own workspace it is, or an organization's admins, the first MAX_PROFILE_MEMBERS.
 */
export async function profileOwners(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">) {
  const workspace = profile.workspaceId ? await ctx.db.get("workspaces", profile.workspaceId) : null;
  const admins = workspace?.kind === "organization"
    ? await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state_and_role", q => q.eq("organizationId", workspace.organizationId).eq("state", "active").eq("role", "org:admin")).take(MAX_PROFILE_MEMBERS)
    : [];
  const people = await Promise.all([
    ...[profile.createdBy, workspace?.kind === "personal" ? workspace.userId : undefined].map(userId => (userId ? ctx.db.get("users", userId) : null)),
    ...admins.map(admin => ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", admin.clerkUserId)).unique()),
  ]);
  return [...new Map(people.flatMap(person => (person ? [[person._id, person] as const] : []))).values()];
}

export async function requireProfileAccess(ctx: QueryCtx | MutationCtx, profileId: Id<"authorProfiles">, ownerOnly = false) {
  const user = await requireAuth(ctx);
  const profile = await ctx.db.get("authorProfiles", profileId);
  if (!profile) throw createError("NOT_FOUND", "Author profile not found");
  const role = await profileRoleForUser(ctx, profile, user._id);
  if (!role || (ownerOnly && role !== "owner")) throw createError("FORBIDDEN", "You do not have permission to change this profile");
  return {profile, user, role};
}
