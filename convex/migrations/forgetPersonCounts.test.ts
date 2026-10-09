// Forgetting the charge counts kept per person before workspaces paid (#650).
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { spendSpace, usageAgg, workspaceSpace } from "../billing/usageLog";
import { personalWorkspaceOf } from "../workspaces/personal";

it("forgets the counts under a person and keeps a workspace's, once however often it runs", async () => {
  const t = convexTest(schema);
  const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
  const own = await t.run((ctx) => personalWorkspaceOf(ctx, ada));
  const namespaces = [`user:${ada}`, `spend:${ada}:chat`, workspaceSpace(own), spendSpace(own, "chat")];
  await t.run(async (ctx) => {
    for (const namespace of namespaces) await usageAgg.insert(ctx, { namespace, key: 1, id: "charge", sumValue: 3 });
  });
  const counts = () => t.run((ctx) => usageAgg.countBatch(ctx, namespaces.map((namespace) => ({ namespace }))));
  expect(await counts()).toEqual([1, 1, 1, 1]);
  expect(await t.action(internal.migrations.forgetPersonCounts.run, {})).toBe(2);
  expect(await counts()).toEqual([0, 0, 1, 1]);
  expect(await t.action(internal.migrations.forgetPersonCounts.run, {})).toBe(0);
});
