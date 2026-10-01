// Searches saved before #354 hold their history in arrays; the migration moves every entry
// into searchHistory rows once, and `verify` says when none is left.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const queryHistory = [{ query: "tutoring", field: "title" as const, timestamp: "2026-08-01T10:00:00Z" }, { query: "tutoring AND randomized", timestamp: "2026-08-01T11:00:00Z" }];
const questionHistory = [{ question: "Does tutoring work?", timestamp: "2026-08-01T10:30:00Z" }];
const legacy = (id: string) => ({
  id, query: "tutoring AND randomized", field: "title_and_abstract" as const, count: 42, queryHistory, questionHistory,
  screeningQuestions: [], screeningResponses: [], createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T11:00:00Z",
});

describe("moveSearchHistory", () => {
  it("moves every legacy search's history into rows once, whether an edit or the migration reaches it first", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
        for (const id of ["edited", "untouched"]) await ctx.db.insert("searches", { userId, localId: id, data: legacy(id), revision: 1 });
      });
      const alice = t.withIdentity({ subject: "alice" });
      const entries = async (id: string, kind: "query" | "question") => (await alice.query(api.research.records.searchHistory, { accountId: "alice", id, kind, paginationOpts: { cursor: null, numItems: 25 } })).page.map((entry) => entry.text);
      expect(await t.action(internal.migrations.moveSearchHistory.verify, {})).toHaveLength(2);
      // Before it moves, a search's history reads from its arrays.
      expect(await entries("untouched", "query")).toEqual(["tutoring AND randomized", "tutoring"]);

      await alice.mutation(api.research.records.change, { accountId: "alice", requestId: "edit", command: { kind: "editSearch", id: "edited", edit: { kind: "query", query: "newest", field: "title" } } });
      await t.mutation(internal.migrations.moveSearchHistory.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await t.action(internal.migrations.moveSearchHistory.verify, {})).toEqual([]);
      expect(await entries("edited", "query")).toEqual(["newest", "tutoring AND randomized", "tutoring"]);
      expect(await entries("untouched", "query")).toEqual(["tutoring AND randomized", "tutoring"]);
      expect(await entries("untouched", "question")).toEqual(["Does tutoring work?"]);
      expect(await t.run((ctx) => ctx.db.query("searchHistory").collect())).toHaveLength(7);
      expect(await alice.query(api.research.records.getSearch, { accountId: "alice", id: "untouched" })).toMatchObject({ queryHistoryCount: 2, questionCount: 1, latestQuestion: "Does tutoring work?" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a legacy search of 4,200 short entries within one transaction's limits", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest({ schema, transactionLimits: true });
      const many = Array.from({ length: 4_200 }, (_, i) => ({ query: `q${i}`, timestamp: "2026-08-01T10:00:00Z" }));
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("searches", { userId, localId: "many", data: { ...legacy("many"), queryHistory: many }, revision: 1 });
      });
      await t.mutation(internal.migrations.moveSearchHistory.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.action(internal.migrations.moveSearchHistory.verify, {})).toEqual([]);
      const rows = await t.run((ctx) => ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position").collect());
      expect(rows.filter((row) => row.kind === "query").map((row) => row.text)).toEqual(many.map((entry) => entry.query));
    } finally {
      vi.useRealTimers();
    }
  });
});
