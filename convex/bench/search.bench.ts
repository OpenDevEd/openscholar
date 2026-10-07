// What searching a person's lists by text costs as they grow (#631, #636): saved searches,
// bookmarks and extraction jobs, for a word one row in a hundred has and for one no row has.
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import schema from "../schema";
import { listedSearchesAction, listedShortcutsAction } from "../research/records";
import { listJobsAction } from "../extraction/queries/jobs";
import { insertMany, seedAccount, text } from "../lib/maxSize.test-support";
import { measure, save } from "./measure.test-support";
import { jobText, searchText, shortcutText } from "../lib/searchText";

const SIZES = (process.env.BENCH_LIST_SIZES ?? "500,5000,10000").split(",").map(Number);
const page = { cursor: null, numItems: 20 };
/** Row `i`'s words: one row in a hundred also has "malaria". */
const words = (i: number, length: number) => `${i % 100 === 0 ? "malaria " : ""}${text(length, i)}`;

describe("text search of a person's lists by size", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  afterAll(() => save(__filename));

  for (const size of SIZES) {
    it(`${size} rows each`, async () => {
      const t = convexTest(schema);
      const { userId } = await seedAccount(t);
      const at = (scenario: string) => ({ area: "text search", scenario, size });
      const day = "2026-10-01T00:00:00Z";
      // Each row with its search text, as the app writes it (../lib/searchText.ts).
      await insertMany(t, "searches", Array.from({ length: size }, (_, i) => {
        const data = { id: `s${i}`, query: words(i, 60), field: "title_and_abstract" as const, count: i, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: day, updatedAt: day };
        return { userId, localId: `s${i}`, revision: 1, data, searchText: searchText(data) };
      }));
      await insertMany(t, "queryShortcuts", Array.from({ length: size }, (_, i) => {
        const data = { shorthand: `b${i}`, expansion: words(i, 80), createdAt: i };
        return { userId, sortName: `b${i}`, data, searchText: shortcutText(data) };
      }));
      await insertMany(t, "extractionJobs", Array.from({ length: size }, (_, i) => ({ userId, name: words(i, 50), searchText: jobText({ name: words(i, 50) }), sourceType: "history", status: "completed", totalPapers: 10, createdAt: i, updatedAt: i })));
      const rows = (read: { page: unknown[] } | undefined) => `${read?.page.length ?? 0} rows`;
      // The right first page: 20 rows when 1 in 100 match and there are that many, or every match, done.
      const want = (label: string) => (read: { page: unknown[]; isDone: boolean }) => (label === "none" ? read.page.length === 0 && read.isDone : read.page.length === Math.min(page.numItems, Math.ceil(size / 100)));
      for (const [label, needle] of [["1 row in 100", "malaria"], ["none", "zzzz"]] as const) {
        const shown = (read: { page: unknown[]; isDone: boolean } | undefined) => `${rows(read)}${read?.isDone ? "" : ", not done"}`;
        await measure(t, at(`saved searches, word in ${label === "none" ? "no row" : label}`), (ctx) => listedSearchesAction.run(ctx, userId, { paginationOpts: page, sort: "recent", text: needle }), shown, want(label));
        await measure(t, at(`bookmarks, word in ${label === "none" ? "no row" : label}`), (ctx) => listedShortcutsAction.run(ctx, userId, { paginationOpts: page, sort: "recent", text: needle }), shown, want(label));
        await measure(t, at(`extraction jobs, word in ${label === "none" ? "no row" : label}`), (ctx) => listJobsAction.run(ctx, userId, { paginationOpts: page, sort: "recent", text: needle }), shown, want(label));
      }
    });
  }
});
