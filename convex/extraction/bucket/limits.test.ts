import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import {
  PAPER_LIMIT_BY_PLAN,
  PAPER_LIMIT_MAX,
} from "./limits";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@test.com`,
      firstName: "T",
      lastName: "U",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  });
}

async function seedSubscription(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  plan: "free" | "go" | "pro" | "enterprise",
  status: "active" | "canceled" | "trialing" | "past_due",
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("subscriptions", {
      userId,
      plan,
      status,
      stripeSubscriptionId: plan === "free" ? undefined : `sub_${userId}`,
      stripeCustomerId: `cus_${userId}`,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("convex/extraction/bucket/limits", () => {
  it("exposes a plan-keyed map and a derived ceiling", () => {
    expect(PAPER_LIMIT_BY_PLAN.free).toBe(1000);
    expect(PAPER_LIMIT_BY_PLAN.go).toBe(1000);
    expect(PAPER_LIMIT_BY_PLAN.pro).toBe(1000);
    expect(PAPER_LIMIT_BY_PLAN.enterprise).toBe(1000);
    expect(PAPER_LIMIT_MAX).toBe(
      Math.max(...Object.values(PAPER_LIMIT_BY_PLAN)),
    );
  });

  it("returns the free-plan limit when a user has no subscription row", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_nopaper_free");
    const limit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId },
    );
    expect(limit).toBe(PAPER_LIMIT_BY_PLAN.free);
  });

  it("returns the pro-plan limit for an active pro subscription", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pro");
    await seedSubscription(t, userId, "pro", "active");
    const limit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId },
    );
    expect(limit).toBe(PAPER_LIMIT_BY_PLAN.pro);
  });

  it("falls back to free for a canceled subscription", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_canceled");
    await seedSubscription(t, userId, "pro", "canceled");
    const limit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId },
    );
    expect(limit).toBe(PAPER_LIMIT_BY_PLAN.free);
  });

  it("trialing and past_due count as entitled", async () => {
    const t = convexTest(schema);
    const trialUserId = await seedUser(t, "clerk_trial");
    await seedSubscription(t, trialUserId, "go", "trialing");
    const trialLimit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId: trialUserId },
    );
    expect(trialLimit).toBe(PAPER_LIMIT_BY_PLAN.go);

    const pastDueUserId = await seedUser(t, "clerk_pastdue");
    await seedSubscription(t, pastDueUserId, "enterprise", "past_due");
    const pastDueLimit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId: pastDueUserId },
    );
    expect(pastDueLimit).toBe(PAPER_LIMIT_BY_PLAN.enterprise);
  });
});
