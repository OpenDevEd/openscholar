// Many readers of a stale topic ask OpenAlex for it once (#355).
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("topic refresh", () => {
  it("schedules one refresh of a stale topic however many read it, and none of a fresh one", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const stale = Date.now() - 2 * 86_400_000;
      await t.run(async (ctx) => {
        await ctx.db.insert("topicDetails", { id: "T10001", description: "d", keywords: [], worksCount: 1, fetchedAt: stale, revision: "r" });
        await ctx.db.insert("topicDetails", { id: "T10002", description: "d", keywords: [], worksCount: 1, fetchedAt: Date.now(), revision: "r" });
      });
      for (let reader = 0; reader < 5; reader++) {
        await t.mutation(internal.topics.details.requestRefresh, { id: "T10001" });
        await t.mutation(internal.topics.details.requestRefresh, { id: "T10002" });
      }
      const refreshes = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((fn) => fn.name.includes("refresh")));
      expect(refreshes.map((fn) => fn.args[0])).toEqual([{ id: "T10001" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
