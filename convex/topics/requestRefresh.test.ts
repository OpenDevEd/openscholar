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

describe("topic details from OpenAlex", () => {
  it("reads a topic's keywords as OpenAlex sends them now, each an object with its name", async () => {
    const t = convexTest(schema);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      id: "https://openalex.org/T11636",
      description: "Artificial intelligence in medicine.",
      keywords: [{ id: "https://openalex.org/keywords/ai-in-healthcare", display_name: "artificial intelligence in healthcare", score: 0.49 }, { id: "https://openalex.org/keywords/clinical-ai", display_name: "clinical AI", score: 0.3 }],
      works_count: 120,
    })));
    try {
      await t.action(internal.topics.details.refresh, { id: "T11636" });
      const saved = await t.run((ctx) => ctx.db.query("topicDetails").withIndex("by_external_id", (q) => q.eq("id", "T11636")).unique());
      expect(saved?.keywords).toEqual(["artificial intelligence in healthcare", "clinical AI"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
