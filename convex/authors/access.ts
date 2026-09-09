import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getCurrentUser, requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

export async function profileRole(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  return profileRoleForUser(ctx, profile, user._id);
}

export async function profileRoleForUser(ctx: QueryCtx | MutationCtx, profile: Doc<"authorProfiles">, userId: Id<"users">) {
  if (profile.ownerId === userId) return "owner" as const;
  const member = await ctx.db.query("authorProfileMembers")
    .withIndex("by_profileId_and_userId", q => q.eq("profileId", profile._id).eq("userId", userId)).unique();
  return member ? "editor" as const : null;
}

export async function requireProfileAccess(ctx: QueryCtx | MutationCtx, profileId: Id<"authorProfiles">, ownerOnly = false) {
  const user = await requireAuth(ctx);
  const profile = await ctx.db.get("authorProfiles", profileId);
  if (!profile) throw createError("NOT_FOUND", "Author profile not found");
  const role = await profileRole(ctx, profile);
  if (!role || (ownerOnly && role !== "owner")) throw createError("FORBIDDEN", "You do not have permission to change this profile");
  return {profile, user, role};
}
