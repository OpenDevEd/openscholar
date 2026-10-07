// What reading a library costs as it grows (#631, #633): its first page, a page of one collection,
// a rating filter, and filtered counts, and whether a view of one collection reaches every paper in it.
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, it, vi } from "vitest";
import schema from "../schema";
import { countPapersAction, papersAction } from "../library/queries";
import { insertMany, seedAccount, seedLibrary } from "../lib/maxSize.test-support";
import { measure, now, record, save } from "./measure.test-support";
import { PAPERS_PAGE } from "../library/validators";

const SIZES = (process.env.BENCH_LIBRARY_SIZES ?? "1000,12000,25000").split(",").map(Number);

describe("library reads by size", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  afterAll(() => save(__filename));

  for (const size of SIZES) {
    it(`${size} saved papers`, async () => {
      const t = convexTest(schema);
      const { userId } = await seedAccount(t);
      // Every paper in one collection, and a second, small collection of 50, as a person filing a few papers keeps.
      const { itemIds, collectionId } = await seedLibrary(t, userId, { items: size });
      const [small] = await insertMany(t, "collections", [{ userId, name: "Shortlist", sortName: "shortlist", itemCount: 50, createdAt: 1, updatedAt: 1 }]);
      await insertMany(t, "libraryItemCollections", itemIds.filter((_, i) => i % Math.floor(size / 50) === 0).slice(0, 50).map((libraryItemId) => ({ userId, collectionId: small, libraryItemId, assignedAt: 1 })));
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const at = (scenario: string) => ({ area: "library", scenario, size });
      const papers = (given: Record<string, unknown>) => (ctx: any) => papersAction.run(ctx, userId, given as never);
      const shown = (read: { papers: unknown[] } | undefined) => `${read?.papers.length ?? 0} rows`;
      // Each view holds more than a page, so the right first page is a full one.
      const full = (read: { papers: unknown[] }) => read.papers.length === PAPERS_PAGE;

      await measure(t, at("first page"), papers({}), shown, full);
      await measure(t, at("page of the collection holding every paper"), papers({ collectionId }), shown, full);
      await measure(t, at("page of a 50-paper collection"), papers({ collectionId: small }), shown, full);
      await measure(t, at("page rated 5"), papers({ minRating: 5 }), shown, full);
      await measure(t, at("count rated 4 or more"), (ctx) => countPapersAction.run(ctx, userId, { minRating: 4 }), (r) => `${r.count}${r.atLeast ? "+" : ""}`, (r) => !r.atLeast && r.count === itemIds.filter((_, i) => (i % 5) + 1 >= 4).length);
      // Every paper in the small collection is rated 1, the first of every five.
      await measure(t, at("count of the 50-paper collection, rated 1"), (ctx) => countPapersAction.run(ctx, userId, { collectionId: small, maxRating: 1 }), (r) => `${r.count}${r.atLeast ? "+" : ""}`, (r) => !r.atLeast && r.count === 50);

      // A view of the collection holding every paper, read to its end: does it reach them all?
      let cursor: string | undefined;
      let reached = 0;
      let calls = 0;
      let error: string | undefined;
      const started = now();
      do {
        try {
          const read: { papers: unknown[]; next?: string } = await t.run((ctx) => papersAction.run(ctx, userId, { collectionId, ...(cursor ? { cursor } : {}) } as never));
          reached += read.papers.length;
          cursor = read.next;
          calls += 1;
        } catch (thrown) {
          error = `call ${calls + 1}: ${String((thrown as Error).message ?? thrown).split("\n")[0]}`;
          break;
        }
      } while (cursor && calls < 5_000);
      record({ ...at("collection view read to its end"), ok: !error && reached === size, ms: Math.round(now() - started), result: `${reached} of ${size} papers in ${calls} calls`, ...(error ? { error } : {}) });
    });
  }
});
