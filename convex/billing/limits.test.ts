// What a plan allows (#632): a limit is a feature in Autumn never used up, read from the
// customer's balance, or from their plan in the synced catalog when their snapshot has none.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { checkRequestPapers, planLimit, snapshotFromCustomer } from "./accounts";
import type { AutumnCustomer } from "./autumn";
import type { BillingCatalog } from "./validators";

const customer = (balances: AutumnCustomer["balances"]): AutumnCustomer => ({
  id: "u",
  stripe_id: null,
  subscriptions: [{ plan_id: "go", auto_enable: false, status: "active", past_due: false, canceled_at: null, current_period_end: null, add_on: false }],
  balances,
});

const catalog: BillingCatalog = {
  plans: [
    { id: "free", name: "Free", addOn: false, autoEnable: true, features: [], popular: false, limits: { collections: 20, request_papers: 1_000 } },
    { id: "go", name: "Go", addOn: false, autoEnable: false, features: [], popular: false, limits: { collections: 200, concurrency: null } },
  ],
  features: [],
};

describe("plan limits", () => {
  it("are what the customer's plans grant of each limit, null when unlimited, and left out when no plan sets one", () => {
    const { limits } = snapshotFromCustomer(customer({
      credits: { remaining: 10 },
      collections: { remaining: 200, granted: 200 },
      concurrency: { remaining: 0, granted: 0, unlimited: true },
    }));
    expect(limits).toEqual({ collections: 200, concurrency: null });
  });

  it("fall back to the person's plan in the catalog, then the plan every customer gets, and set none past that", async () => {
    const t = convexTest(schema);
    const { fresh, onGo, cached } = await t.run(async (ctx) => {
      await ctx.db.insert("billingCatalog", { ...catalog, syncedAt: 1 });
      const user = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, state: "active", createdAt: 1, updatedAt: 1 });
      const account = { pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1 };
      const [fresh, onGo, cached] = [await user("fresh"), await user("go"), await user("cached")];
      // Their plan's version predates the limits: the snapshot has none.
      await ctx.db.insert("billingAccounts", { ...account, userId: onGo, plan: "go" });
      await ctx.db.insert("billingAccounts", { ...account, userId: cached, plan: "go", limits: { collections: 50 } });
      return { fresh, onGo, cached };
    });
    const limits = (userId: typeof fresh) => t.run(async (ctx) => Promise.all((["collections", "concurrency", "request_papers"] as const).map(async (limit) => (await planLimit(ctx, userId, limit)) ?? "none")));
    expect(await limits(fresh)).toEqual([20, "none", 1_000]);
    expect(await limits(onGo)).toEqual([200, "none", "none"]);
    expect(await limits(cached)).toEqual([50, "none", "none"]);

    await t.run(async (ctx) => {
      await checkRequestPapers(ctx, fresh, 1_000, "screening");
      await expect(checkRequestPapers(ctx, fresh, 1_001, "screening")).rejects.toThrow(/plan takes up to 1,000 papers in one screening/);
      await checkRequestPapers(ctx, onGo, 1_000_000, "extraction");
    });
  });
});
