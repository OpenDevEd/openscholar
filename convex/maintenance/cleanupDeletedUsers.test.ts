/// <reference types="vite/client" />
// The cleanup behind the privacy policy's "about 30 days".
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob("/convex/**/*.ts");

const DAY = 24 * 60 * 60 * 1000;

const addDeleted = (t: ReturnType<typeof convexTest>, name: string, deletedDaysAgo: number) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: name,
      email: `${name}@example.org`,
      state: "deleted",
      createdAt: 1,
      updatedAt: Date.now() - deletedDaysAgo * DAY,
    }),
  );

describe("cleaning up deleted accounts", () => {
  it("removes those past 30 days, whatever newer deletions come first, and then stops", async () => {
    const t = convexTest(schema, modules);
    // Created first, so an index on state alone returns all of these ahead of the old ones.
    for (let i = 0; i < 60; i++) await addDeleted(t, `recent${i}`, 5);
    await addDeleted(t, "old1", 40);
    await addDeleted(t, "old2", 90);

    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    const pendingBeforeLastRun = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});

    const left = await t.run((ctx) => ctx.db.query("users").take(100));
    expect(left.filter((user) => user.clerkId.startsWith("old"))).toEqual([]);
    expect(left).toHaveLength(60);
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(pending.length).toBe(pendingBeforeLastRun.length);
  });
});
