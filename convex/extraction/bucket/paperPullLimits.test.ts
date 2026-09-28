import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import {
  PAPER_PULL_CAP_BY_PLAN,
  PAPER_PULL_DEFAULT_BY_PLAN,
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

async function seedPlan(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  plan: "free" | "go" | "pro",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("billingAccounts", {
      userId,
      plan,
      pastDue: false,
      balance: 0,
      purchased: 0,
      signupGranted: true,
      hasPaid: plan !== "free",
      refreshedAt: Date.now(),
    });
  });
}

describe("convex/extraction/bucket/limits — paper-pull cap/default", () => {
  it("exposes plan-keyed cap and default tables", () => {
    expect(PAPER_PULL_CAP_BY_PLAN.free).toBe(200);
    expect(PAPER_PULL_CAP_BY_PLAN.go).toBe(200);
    expect(PAPER_PULL_CAP_BY_PLAN.pro).toBe(200);
    expect(PAPER_PULL_DEFAULT_BY_PLAN.free).toBe(200);
    expect(PAPER_PULL_DEFAULT_BY_PLAN.go).toBe(200);
    expect(PAPER_PULL_DEFAULT_BY_PLAN.pro).toBe(200);
  });

  it("default never exceeds cap for any plan (config invariant)", () => {
    for (const plan of Object.keys(PAPER_PULL_CAP_BY_PLAN) as Array<
      keyof typeof PAPER_PULL_CAP_BY_PLAN
    >) {
      expect(PAPER_PULL_DEFAULT_BY_PLAN[plan]).toBeLessThanOrEqual(
        PAPER_PULL_CAP_BY_PLAN[plan],
      );
    }
  });

  it("getPaperPullCapForUser returns free cap when user has no subscription", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pull_none");
    const cap: number = await t.query(
      internal.extraction.bucket.limits.getPaperPullCapForUser,
      { userId },
    );
    expect(cap).toBe(PAPER_PULL_CAP_BY_PLAN.free);
  });

  it("getPaperPullDefaultForUser returns free default when user has no subscription", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pull_def_none");
    const def: number = await t.query(
      internal.extraction.bucket.limits.getPaperPullDefaultForUser,
      { userId },
    );
    expect(def).toBe(PAPER_PULL_DEFAULT_BY_PLAN.free);
  });

  it("returns the pro-plan cap/default for a user on Pro", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pull_pro");
    await seedPlan(t, userId, "pro");
    const cap: number = await t.query(
      internal.extraction.bucket.limits.getPaperPullCapForUser,
      { userId },
    );
    const def: number = await t.query(
      internal.extraction.bucket.limits.getPaperPullDefaultForUser,
      { userId },
    );
    expect(cap).toBe(PAPER_PULL_CAP_BY_PLAN.pro);
    expect(def).toBe(PAPER_PULL_DEFAULT_BY_PLAN.pro);
  });

  describe("clamp: default never exceeds cap", () => {
    const originalFreeDefault = PAPER_PULL_DEFAULT_BY_PLAN.free;
    afterEach(() => {
      PAPER_PULL_DEFAULT_BY_PLAN.free = originalFreeDefault;
    });

    it("clamps default down to cap when config drifts above cap", async () => {
      PAPER_PULL_DEFAULT_BY_PLAN.free = 301;
      const t = convexTest(schema);
      const userId = await seedUser(t, "clerk_pull_clamp");
      const def: number = await t.query(
        internal.extraction.bucket.limits.getPaperPullDefaultForUser,
        { userId },
      );
      expect(def).toBe(PAPER_PULL_CAP_BY_PLAN.free);
    });
  });
});

describe("convex/extraction/bucket/queries — getMyPaperPullCap / getMyPaperPullDefault", () => {
  it("public getMyPaperPullCap returns the same number as the internal helper", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pull_pub_cap");
    const asUser = t.withIdentity({ subject: "clerk_pull_pub_cap" });
    const cap: number = await asUser.query(
      api.extraction.bucket.queries.getMyPaperPullCap,
      {},
    );
    expect(cap).toBe(PAPER_PULL_CAP_BY_PLAN.free);
    // internal round-trip agrees
    const internalCap: number = await t.query(
      internal.extraction.bucket.limits.getPaperPullCapForUser,
      { userId },
    );
    expect(internalCap).toBe(cap);
  });

  it("public getMyPaperPullDefault returns the same number as the internal helper", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pull_pub_def");
    const asUser = t.withIdentity({ subject: "clerk_pull_pub_def" });
    const def: number = await asUser.query(
      api.extraction.bucket.queries.getMyPaperPullDefault,
      {},
    );
    expect(def).toBe(PAPER_PULL_DEFAULT_BY_PLAN.free);
    const internalDef: number = await t.query(
      internal.extraction.bucket.limits.getPaperPullDefaultForUser,
      { userId },
    );
    expect(internalDef).toBe(def);
  });
});
