import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getCurrentUser, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_PROFILE_MEMBERS } from "../lib/queryBounds";
import { grantOf, open } from "../sharing/items";
import { actorIn } from "../workspaces/actor";

/** What the person reading a profile is to it: their role, and whether they act in the workspace that owns it, whose members see its Activity and who has it open (#656, #657). */
export async function profileViewer(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">) {
  const user = await getCurrentUser(ctx);
  if (!user) return {role: null, member: false};
  return {role: await profileRoleForUser(ctx, profile, user._id), member: Boolean(profile.workspaceId && (await actorIn(ctx, user, profile.workspaceId)))};
}

/**
 * What a person may do with a profile: own it as an owner or admin of the workspace that owns it (#650, #1093), or
 * edit it when it was shared with them (#653), as its maker is when they don't run the workspace: a profile is public,
 * so its guests are its editors, wherever they act.
 */
export async function profileRoleForUser(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">, userId: Id<"users">) {
  // The workspace's owner or admins own it while they can act in it.
  const user = profile.workspaceId ? await ctx.db.get("users", userId) : null;
  const actor = user && profile.workspaceId ? await actorIn(ctx, user, profile.workspaceId) : null;
  if (actor?.role === "admin") return "owner" as const;
  return profile.workspaceId && (await grantOf(ctx, profile._id, userId)) && (await open(ctx, profile.workspaceId)) ? "editor" as const : null;
}

/**
 * The people who own a profile: the admins of the workspace that owns it: the person whose own
 * workspace it is, or an organization's admins, the first MAX_PROFILE_MEMBERS.
 */
export async function profileOwners(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">) {
  const workspace = profile.workspaceId ? await ctx.db.get("workspaces", profile.workspaceId) : null;
  const admins = workspace?.kind === "organization"
    ? await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state_and_role", q => q.eq("organizationId", workspace.organizationId).eq("state", "active").eq("role", "org:admin")).take(MAX_PROFILE_MEMBERS)
    : [];
  const people = await Promise.all([
    ...[workspace?.kind === "personal" ? workspace.userId : undefined].map(userId => (userId ? ctx.db.get("users", userId) : null)),
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
