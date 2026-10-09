// Clearing the person a cached billing account named before workspaces (#650, slice 8).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/personal";

it("clears an account's person, keeps its workspace, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const workspaceId = await t.run((ctx) => personalWorkspaceOf(ctx, ada));
    await t.run((ctx) => ctx.db.insert("billingAccounts", { userId: ada, workspaceId, plan: "free", pastDue: false, balance: 500, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1 }));
    expect(await t.action(internal.migrations.narrowBilling.verify, {})).toBe(1);
    const rows = () => t.run((ctx) => ctx.db.query("billingAccounts").collect());
    await t.mutation(internal.migrations.narrowBilling.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect(once).toMatchObject([{ workspaceId, balance: 500 }]);
    expect(once[0]).not.toHaveProperty("userId");
    await t.mutation(internal.migrations.narrowBilling.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.narrowBilling.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
