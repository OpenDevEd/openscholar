// A library's filtered counts stay exact and within Convex's transaction limits (#350).
// These are the slowest cases at full size, so they run beside convex/limits/maxSize.test.ts.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { matchingOf, seedAccount, seedLibrary, seededLibrary } from "../lib/maxSize.test-support";

describe("a library's filtered counts at the largest sizes the product allows", () => {
  it("a library's filtered counts are exact for every filter, from its counts or along the narrowest", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    // Counted: the aggregate's worker takes minutes to count 10,000 papers in a test, and counts don't read papers.
    const items = 2_000;
    const { collectionId } = await seedLibrary(t, userId, { items, counted: true });
    const sorted = { sortBy: "savedAt" as const, sortOrder: "desc" as const };
    const seeded = seededLibrary(items);
    for (const view of [{ minRating: 4 }, { yearFrom: 2020 }, { savedAfter: 1_700_000_000_500 }, { collectionId }, { collectionId, maxRating: 1 }, { minRating: 5, yearTo: 1995 }, { minRating: 5, yearTo: 1990 }]) {
      expect(await as.query(api.library.queries.getLibraryFilteredCount, { ...sorted, ...view })).toEqual({ count: matchingOf(seeded, view), capped: false });
    }
  }, 300_000);

  it("a library of long abstracts counts two filters by reading only the narrower one's papers", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    await seedLibrary(t, userId, { items: 2_000, abstractChars: 4_500, counted: true });
    // Rating 4 and up never meets year 1990 in the seed: the count reads only the papers of the narrower filter, the year's.
    const count = await as.query(api.library.queries.getLibraryFilteredCount, { sortBy: "savedAt", sortOrder: "desc", minRating: 4, yearTo: 1990 });
    expect(count).toEqual({ count: 0, capped: false });
  }, 300_000);
});
