import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

it("finds every item missing paperData by walking every page, not only the first", async () => {
  const t = convexTest(schema);
  const missing = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "backfill", email: "backfill@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const ids = [];
    for (let i = 0; i < 60; i++) {
      const id = await ctx.db.insert("libraryItems", { userId, openalexId: `https://openalex.org/W${i}`, rating: 0, title: `Paper ${i}`, searchableText: `paper ${i}`, savedAt: i, updatedAt: i, ...(i < 50 ? { paperData: "{}" } : {}) });
      if (i >= 50) ids.push(id);
    }
    return ids;
  });
  const found: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { items: Array<{ _id: string }>; isDone: boolean; continueCursor: string } = await t.query(internal.library.backfillMutations.getItemsMissingPaperData, { paginationOpts: { numItems: 25, cursor } });
    found.push(...page.items.map((item) => item._id));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(found.sort()).toEqual([...missing].sort());
});
