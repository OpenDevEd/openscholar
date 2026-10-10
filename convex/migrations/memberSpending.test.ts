// Members' spending from before #652: the backfill counts each charge under the member who spent it.
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { spentSince } from "../billing/memberCaps";
import { monthStart } from "../../lib/billing/month";
import { personalWorkspaceOf } from "../workspaces/personal";

it("counts the charges made before under their members, once however often it runs", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const { ada, workspaceId } = await t.run(async (ctx) => {
      const ada = await ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      const workspaceId = await personalWorkspaceOf(ctx, ada);
      // Charges as the ledger kept them before it counted them by member.
      for (const credits of [100, 250]) await ctx.db.insert("billingUsage", { userId: ada, workspaceId, chargeId: `charge-${credits}`, credits, kind: "search", description: "A search", createdAt: Date.now() });
      return { ada, workspaceId };
    });
    for (let runs = 0; runs < 2; runs++) {
      await t.mutation(internal.migrations.memberSpending.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    expect(await t.action(internal.migrations.memberSpending.verify, {})).toBe(0);
    expect(await t.run((ctx) => spentSince(ctx, workspaceId, ada, monthStart(Date.now())))).toBe(350);
  } finally {
    vi.useRealTimers();
  }
});
