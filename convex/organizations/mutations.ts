import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgAdmin, requireOrgOwner } from "../lib/auth";

/**
 * Update organization details
 */
export const update = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);

    const { organizationId, ...updates } = args;

    await ctx.db.patch(organizationId, {
      ...updates,
      updatedAt: Date.now(),
    });

    return organizationId;
  },
});

/**
 * Update organization settings
 */
export const updateSettings = mutation({
  args: {
    organizationId: v.id("organizations"),
    allowByok: v.optional(v.boolean()),
    creditPooling: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOrgOwner(ctx, args.organizationId);

    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new Error("Organization not found");

    await ctx.db.patch(args.organizationId, {
      settings: {
        ...org.settings,
        allowByok: args.allowByok ?? org.settings?.allowByok,
        creditPooling: args.creditPooling ?? org.settings?.creditPooling,
      },
      updatedAt: Date.now(),
    });

    return args.organizationId;
  },
});
