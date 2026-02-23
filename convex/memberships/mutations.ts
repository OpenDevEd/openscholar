import { mutation } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { requireOrgAdmin, requireOrgOwner } from "../lib/auth";

/**
 * Update a member's role
 */
export const updateRole = mutation({
  args: {
    membershipId: v.id("memberships"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  },
  returns: v.id("memberships"),
  handler: async (ctx, args) => {
    // Only owners can change roles
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new ConvexError("Membership not found");
    
    await requireOrgOwner(ctx, membership.organizationId);

    await ctx.db.patch(args.membershipId, { role: args.role });
    return args.membershipId;
  },
});

/**
 * Remove a member from an organization
 */
export const remove = mutation({
  args: { membershipId: v.id("memberships") },
  returns: v.null(),
  handler: async (ctx, { membershipId }) => {
    const membership = await ctx.db.get(membershipId);
    if (!membership) throw new ConvexError("Membership not found");

    // Admins and owners can remove members
    await requireOrgAdmin(ctx, membership.organizationId);

    // Cannot remove the last owner
    if (membership.role === "owner") {
      const owners = await ctx.db
        .query("memberships")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", membership.organizationId)
        )
        .collect();

      const ownerCount = owners.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        throw new ConvexError("Cannot remove the last owner");
      }
    }

    await ctx.db.delete(membershipId);
  },
});

/**
 * Add custom permissions to a member
 */
export const addPermissions = mutation({
  args: {
    membershipId: v.id("memberships"),
    permissions: v.array(v.string()),
  },
  returns: v.id("memberships"),
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new ConvexError("Membership not found");

    await requireOrgOwner(ctx, membership.organizationId);

    const newPermissions = [
      ...new Set([...membership.permissions, ...args.permissions]),
    ];

    await ctx.db.patch(args.membershipId, { permissions: newPermissions });
    return args.membershipId;
  },
});
