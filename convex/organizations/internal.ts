import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { PLAN_CONFIG } from "../lib/constants";


/**
 * Sync a new organization from WorkOS webhook
 */
export const syncOrgFromWorkos = internalMutation({
  args: {
    workosId: v.string(),
    name: v.string(),
  },
  returns: v.id("organizations"),
  handler: async (ctx, args) => {
    // Check if org already exists
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();

    if (existing) return existing._id;

    const now = Date.now();

    // Create new organization
    const orgId = await ctx.db.insert("organizations", {
      workosId: args.workosId,
      name: args.name,
      createdAt: now,
      updatedAt: now,
    });

    // Initialize credits for new org
    await ctx.db.insert("credits", {
      ownerId: orgId,
      ownerType: "organization",
      freeBalance: 0,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });

    // Initialize free subscription
    await ctx.db.insert("subscriptions", {
      ownerId: orgId,
      ownerType: "organization",
      plan: "free",
      status: "active",
      creditsPerMonth: PLAN_CONFIG.free.creditsPerMonth,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    return orgId;
  },
});

/**
 * Update existing organization from WorkOS webhook
 */
export const updateOrgFromWorkos = internalMutation({
  args: {
    workosId: v.string(),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();

    if (!org) return;

    await ctx.db.patch(org._id, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Handle deleted organizations from WorkOS webhook.
 * We keep records for billing/audit history while revoking all access.
 */
export const markOrgDeletedFromWorkos = internalMutation({
  args: {
    workosId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();

    if (!org) return null;

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
      .collect();

    await Promise.all(memberships.map((membership) => ctx.db.delete(membership._id)));

    await ctx.db.patch(org._id, {
      name: org.name.startsWith("[Deleted] ") ? org.name : `[Deleted] ${org.name}`,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Link Stripe customer to organization
 */
export const linkStripeCustomer = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    stripeCustomerId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.organizationId, {
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update organization settings
 */
export const updateSettings = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    settings: v.object({
      allowByok: v.optional(v.boolean()),
      creditPooling: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Organization not found" });

    await ctx.db.patch(args.organizationId, {
      settings: {
        ...org.settings,
        ...args.settings,
      },
      updatedAt: Date.now(),
    });
  },
});
