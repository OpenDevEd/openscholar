// What a plan allows (#632): a limit is a feature in Autumn never used up, read from the
// customer's balance, or from their plan in the synced catalog when their snapshot has none.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/personal";
import { internal } from "../_generated/api";
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
    const { fresh, onGo, cached, archived } = await t.run(async (ctx) => {
      await ctx.db.insert("billingCatalog", { ...catalog, syncedAt: 1 });
      const user = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, state: "active", createdAt: 1, updatedAt: 1 });
      const account = { pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1 };
      const [fresh, onGo, cached, archived] = [await user("fresh"), await user("go"), await user("cached"), await user("archived")];
      // Their plan's version predates the limits: the snapshot has none.
      await ctx.db.insert("billingAccounts", { ...account, userId: onGo, plan: "go" });
      await ctx.db.insert("billingAccounts", { ...account, userId: cached, plan: "go", limits: { collections: 50 } });
      // A plan taken off the catalog, its snapshot from before the limits.
      await ctx.db.insert("billingAccounts", { ...account, userId: archived, plan: "legacy_pro" });
      return { fresh, onGo, cached, archived };
    });
    const limits = (userId: typeof fresh) => t.run(async (ctx) => { const workspaceId = await personalWorkspaceOf(ctx, userId); return Promise.all((["collections", "concurrency", "request_papers"] as const).map(async (limit) => (await planLimit(ctx, workspaceId, limit)) ?? "none")); });
    expect(await limits(fresh)).toEqual([20, "none", 1_000]);
    expect(await limits(onGo)).toEqual([200, "none", "none"]);
    expect(await limits(cached)).toEqual([50, "none", "none"]);
    // Not the new customer's plan: none of its limits.
    expect(await limits(archived)).toEqual(["none", "none", "none"]);

    await t.run(async (ctx) => {
      await checkRequestPapers(ctx, await personalWorkspaceOf(ctx, fresh), 1_000, "screening");
      await expect(checkRequestPapers(ctx, await personalWorkspaceOf(ctx, fresh), 1_001, "screening")).rejects.toThrow(/plan takes up to 1,000 papers in one screening/);
      await checkRequestPapers(ctx, await personalWorkspaceOf(ctx, onGo), 1_000_000, "extraction");
    });
  });
});

describe("plan limits over time", () => {
  it("keep the newest snapshot's plan when an older refresh lands after it", async () => {
    const t = convexTest(schema);
    const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "late", email: "late@test.local", state: "active", createdAt: 1, updatedAt: 1 }));
    const snapshot = (plan: string, collections: number) => ({ plan, pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, limits: { collections } });
    const workspaceId = await t.run((ctx) => personalWorkspaceOf(ctx, userId));
    await t.mutation(internal.billing.accounts.writeSnapshot, { workspaceId, snapshot: snapshot("go", 200), withCard: false, fetchedAt: 2_000 });
    await t.mutation(internal.billing.accounts.writeSnapshot, { workspaceId, snapshot: snapshot("pro", 1_000), withCard: false, fetchedAt: 1_000 });
    expect(await t.run((ctx) => planLimit(ctx, workspaceId, "collections"))).toBe(200);
    // One that read the card brings it, though its plan is older.
    await t.mutation(internal.billing.accounts.writeSnapshot, { workspaceId, snapshot: { ...snapshot("pro", 1_000), card: { brand: "visa", last4: "4242" } }, withCard: true, fetchedAt: 1_500 });
    expect(await t.run((ctx) => ctx.db.query("billingAccounts").unique())).toMatchObject({ plan: "go", card: { last4: "4242" } });
    // And a card read before that one doesn't replace it.
    await t.mutation(internal.billing.accounts.writeSnapshot, { workspaceId, snapshot: { ...snapshot("pro", 1_000), card: { brand: "visa", last4: "1111" } }, withCard: true, fetchedAt: 1_200 });
    expect((await t.run((ctx) => ctx.db.query("billingAccounts").unique()))?.card?.last4).toBe("4242");
  });

  it("refuse a screening request past the plan before it reads a paper", async () => {
    const t = convexTest(schema);
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { clerkId: "small", email: "small@test.local", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("libraryCounts", { workspaceId: await personalWorkspaceOf(ctx, id), count: 5_000 });
      await ctx.db.insert("billingAccounts", { userId: id, plan: "free", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1, limits: { request_papers: 1_000 } });
      return id;
    });
    const request = { userId, set: { kind: "saved" as const }, questions: [{ key: "q1", question: "Is it a trial?" }], scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], minimumScore: 1, starThresholds: [] } };
    await t.query(internal.screening.start.check, { ...request, first: 1, last: 1_000 });
    await expect(t.query(internal.screening.start.check, { ...request, first: 1, last: 1_001 })).rejects.toThrow(/plan takes up to 1,000 papers in one screening/);
  });
});
