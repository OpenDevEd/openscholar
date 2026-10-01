import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { requireFeature } from "./guard";

async function seed(t: ReturnType<typeof convexTest>, features: string[]) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
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
