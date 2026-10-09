// Clearing the person research rows belonged to before workspaces (#650, slice 8).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { personalWorkspaceOf } from "../workspaces/personal";
import type { SavedSearch } from "../../lib/research/records";

const record: SavedSearch = {
  id: "local-original", query: "tutoring AND randomized", field: "title_and_abstract", count: 42,
  queryHistoryCount: 1, questionCount: 1, latestQuestion: "Does tutoring work?", questionText: "Does tutoring work?",
  screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }, { paperId: "W2", responses: [{ question: "Randomized?", response: null }] }],
  createdAt: "2026-08-01T11:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
  dateRange: { from: "2020-01-01T00:00:00Z", to: "2025-12-31T00:00:00Z" }, yearRange: [2020, 2025], filterType: "date", isYearRangeEnabled: true,
  sortBy: "cited_by_count:desc", selectedRegions: ["africa"], selectedCountryFocus: ["MA"], ratingRange: [2, 5], onlyRatedPapers: true,
  citesItemId: "W10", citedByItemId: "W11", relatedToItemId: "W12", reviewFilter: true, researchAreas: ["17"], sdgs: ["4"],
  openAccessOnly: true, workTypes: ["article"], workLanguages: ["en"], institutionTypes: ["education"], funders: ["F123"], authors: ["A123"],
  minCitations: 3, hasAbstract: true, includeRetracted: false, language: "fr", page: 3,
};

it("clears the person a search, its revision, history and screening named, keeps who made the revision, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const own = await t.run(async (ctx) => personalWorkspaceOf(ctx, ada));
    const data = { ...record, id: "s1" };
    await runUntriggered(t, async (ctx) => {
      const searchId = await ctx.db.insert("searches", { userId: ada, workspaceId: own, createdBy: ada, localId: "s1", revision: 1, data });
      await ctx.db.insert("searchRevisions", { userId: ada, searchId, revision: 1, author: "user", data, deleted: false, createdAt: 1 });
      await ctx.db.insert("searchHistory", { userId: ada, searchId, kind: "query", text: "tutoring", timestamp: "2026-01-01T00:00:00Z", position: 0 });
      await ctx.db.insert("screenings", { userId: ada, workspaceId: own, searchId, version: 0, createdAt: 1 });
      await ctx.db.insert("recordCounts", { userId: ada, workspaceId: own, table: "searches", count: 1 });
    });
    expect(await t.action(internal.migrations.narrowResearch.verify, {})).toBe(5);
    const rows = () => t.run(async (ctx) => ({
      searches: await ctx.db.query("searches").collect(),
      revisions: await ctx.db.query("searchRevisions").collect(),
      history: await ctx.db.query("searchHistory").collect(),
      screenings: await ctx.db.query("screenings").collect(),
      counts: await ctx.db.query("recordCounts").collect(),
    }));
    await t.mutation(internal.migrations.narrowResearch.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect(Object.values(once).flat().every((row) => !("userId" in row))).toBe(true);
    expect(once.revisions).toMatchObject([{ createdBy: ada }]);
    await t.mutation(internal.migrations.narrowResearch.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.narrowResearch.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
