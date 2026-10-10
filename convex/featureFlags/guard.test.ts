import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { requireFeature } from "./guard";

async function seed(t: ReturnType<typeof convexTest>, features: string[]) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      
      clerkId: `clerk_${features.join("_") || "none"}`,
      email: "flags@test.local",
      state: "active" as const,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("billingAccounts", {
      userId,
      plan: features.length > 0 ? "pro" : "free",
      features,
      pastDue: false,
      balance: 0,
      purchased: 0,
      signupGranted: true,
      hasPaid: false,
      refreshedAt: 1,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.start",
      enabled: true,
      planFeature: "extraction",
      updatedAt: 1,
    });
    return userId;
  });
}

describe("a flag that requires a plan feature", () => {
  it("lets users whose plan grants the feature through", async () => {
    const t = convexTest(schema);
    const userId = await seed(t, ["extraction"]);
    // Throws if the user may not start extraction.
    await t.run((ctx) => requireFeature(ctx, "extraction.start", userId));
  });

  it("refuses users whose plan doesn't grant it", async () => {
    const t = convexTest(schema);
    const userId = await seed(t, []);
    await expect(t.run((ctx) => requireFeature(ctx, "extraction.start", userId))).rejects.toThrow(
      /FEATURE_PLAN_REQUIRED|isn't included in your plan/,
    );
  });
});

describe("an organization whose plan grants extraction", () => {
  it("lets its members start one in it, whatever their own plan", async () => {
    const t = convexTest(schema);
    const userId = await seed(t, []);
    const workspaceId = await t.run(async (ctx) => {
      const user = (await ctx.db.get("users", userId))!;
      await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: 1 });
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "mem_1", clerkUserId: user.clerkId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      const workspace = (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!;
      await ctx.db.insert("billingAccounts", { workspaceId: workspace._id, plan: "team", features: ["extraction"], pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: true, refreshedAt: 1 });
      return workspace._id;
    });
    await t.run((ctx) => requireFeature(ctx, "extraction.enabled", userId));
    await t.run((ctx) => requireFeature(ctx, "extraction.start", userId, workspaceId));
    // In their own workspace it's their own plan that says.
    await expect(t.run((ctx) => requireFeature(ctx, "extraction.start", userId))).rejects.toThrow();
  });
});

describe("moving flags from plan tiers to plan features", () => {
  it("gives tier-gated flags their plan feature, clears tiers, and drops retired flags", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", { key: "extraction.start", enabled: true, minimumTier: 20, updatedAt: 1 });
      await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: true, minimumTier: 0, updatedAt: 1 });
      await ctx.db.insert("featureFlags", { key: "subscriptions.plan.go", enabled: true, minimumTier: 0, updatedAt: 1 });
    });

    await t.mutation(internal.featureFlags.internal.adoptPlanFeatures, {});
    await t.mutation(internal.featureFlags.internal.adoptPlanFeatures, {});

    const flags = await t.run((ctx) => ctx.db.query("featureFlags").collect());
    expect(flags.map(({ key, planFeature, minimumTier }) => ({ key, planFeature, minimumTier }))).toEqual([
      { key: "extraction.start", planFeature: "extraction", minimumTier: undefined },
      { key: "extraction.pdf", planFeature: undefined, minimumTier: undefined },
    ]);
  });
});
