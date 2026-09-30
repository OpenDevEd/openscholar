import { v } from "convex/values";
import { mutation } from "../lib/functions";
import { requireEvidenceLibraryAccess, readLibraryRole } from "./access";
import { createError } from "../lib/errors";

const collaboratorRole = v.union(v.literal("editor"), v.literal("creator"));

/** Direct grants are for existing organization members. External access uses invitations. */
export const addOrganizationMember = mutation({
  args: { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string(), role: collaboratorRole },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const membership = await ctx.db.query("organizationMemberships")
      .withIndex("by_organizationId_and_clerkUserId_and_state", q => q.eq("organizationId", access.organization._id).eq("clerkUserId", args.clerkUserId).eq("state", "active"))
      .unique();
    if (!membership) throw createError("FORBIDDEN", "Choose an organization member");
    if (await readLibraryRole(ctx, access.library, args.clerkUserId)) {
      throw createError("CONFLICT", "This person already has access");
    }
    await ctx.db.insert("evidenceLibraryMembers", { ...args, grantedBy: access.clerkUserId, grantedAt: Date.now() });
    return null;
  },
});

export const changeRole = mutation({
  args: { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string(), role: collaboratorRole },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    if (await readLibraryRole(ctx, access.library, args.clerkUserId) === "owner") {
      throw createError("FORBIDDEN", "Owner access is managed by the organization");
    }
    const assignment = await ctx.db.query("evidenceLibraryMembers")
      .withIndex("by_libraryId_and_clerkUserId", q => q.eq("libraryId", args.libraryId).eq("clerkUserId", args.clerkUserId)).unique();
    if (!assignment) throw createError("NOT_FOUND", "Library member not found");
    await ctx.db.patch("evidenceLibraryMembers", assignment._id, { role: args.role });
    return null;
  },
});

export const removeMember = mutation({
  args: { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    if (await readLibraryRole(ctx, access.library, args.clerkUserId) === "owner") {
      throw createError("FORBIDDEN", "Owner access is managed by the organization");
    }
    const assignment = await ctx.db.query("evidenceLibraryMembers")
      .withIndex("by_libraryId_and_clerkUserId", q => q.eq("libraryId", args.libraryId).eq("clerkUserId", args.clerkUserId)).unique();
    if (assignment) await ctx.db.delete("evidenceLibraryMembers", assignment._id);
    return null;
  },
});
