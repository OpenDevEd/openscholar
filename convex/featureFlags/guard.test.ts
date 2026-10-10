import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
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

describe("a plan feature is its workspace's, not the account's", () => {
  it("is asked of the workspace the person acts in: an organization's plan grants nothing in their own, nor theirs in it", async () => {
    const t = convexTest(schema);
    const userId = await seed(t, []);
    const { workspaceId, own } = await t.run(async (ctx) => {
      const user = (await ctx.db.get("users", userId))!;
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "mem_1", clerkUserId: user.clerkId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      const workspace = (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique())!;
      await ctx.db.insert("billingAccounts", { workspaceId: workspace._id, plan: "team", features: ["extraction"], pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: true, refreshedAt: 1 });
      return { workspaceId: workspace._id, own: (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())!._id };
    });
    // The organization's plan has it and their own doesn't.
    await t.run((ctx) => requireFeature(ctx, "extraction.start", userId, workspaceId));
    await expect(t.run((ctx) => requireFeature(ctx, "extraction.start", userId, own))).rejects.toThrow(/FEATURE_PLAN_REQUIRED/);
    await expect(t.run((ctx) => requireFeature(ctx, "extraction.start", userId))).rejects.toThrow(/FEATURE_PLAN_REQUIRED/);

    // The other way round: what they pay for themselves opens nothing in the organization.
    await t.run(async (ctx) => {
      for (const [id, features] of [[own, ["extraction"]], [workspaceId, []]] as const) {
        const account = (await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", id)).unique())!;
        await ctx.db.patch("billingAccounts", account._id, { features: [...features] });
      }
    });
    await t.run((ctx) => requireFeature(ctx, "extraction.start", userId, own));
    await expect(t.run((ctx) => requireFeature(ctx, "extraction.start", userId, workspaceId))).rejects.toThrow(/FEATURE_PLAN_REQUIRED/);
  });
});
