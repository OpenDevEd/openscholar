// The backfill that puts billing rows from before workspaces on the person's own workspace (#650, slice 7).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { personalWorkspaceOf } from "../workspaces/personal";

it("puts each account and charge on its person's own workspace, leaves one whose person has none, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    // Ada has her own workspace; the charges of an account purged before workspaces have none to go to.
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const own = await t.run(async (ctx) => personalWorkspaceOf(ctx, ada));
    const charge = { chargeId: "c1", credits: 3, kind: "chat" as const, description: "Chat message", createdAt: 1 };
    await runUntriggered(t, async (ctx) => {
      const gone = await ctx.db.insert("users", { clerkId: "gone", email: "gone@example.org", state: "deleted", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("billingAccounts", { userId: ada, pastDue: false, balance: 10, purchased: 0, features: [], limits: {}, signupGranted: true, hasPaid: false, refreshedAt: 1 });
      await ctx.db.insert("billingUsage", { ...charge, userId: ada });
      await ctx.db.insert("billingUsage", { ...charge, chargeId: "c2", userId: gone });
    });
    expect(await t.action(internal.migrations.billingWorkspaces.verify, {})).toBe(2);
    const rows = () => t.run(async (ctx) => ({ accounts: await ctx.db.query("billingAccounts").collect(), usage: await ctx.db.query("billingUsage").collect() }));
    await t.mutation(internal.migrations.billingWorkspaces.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect(once.accounts).toMatchObject([{ userId: ada, workspaceId: own }]);
    expect(once.usage.map((row) => [row.chargeId, row.workspaceId])).toEqual([["c1", own], ["c2", undefined]]);
    await t.mutation(internal.migrations.billingWorkspaces.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.billingWorkspaces.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
