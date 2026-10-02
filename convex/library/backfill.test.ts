import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

it("finds every item missing paperData by walking every page, not only the first", async () => {
  const t = convexTest(schema);
  const missing = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {libraryItemCount: 0,  clerkId: "backfill", email: "backfill@example.org", state: "active", createdAt: 1, updatedAt: 1 });
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

/** A library row saved with `openalexId`, missing its paperData, and the API's answer for it. */
async function backfilled(openalexId: string, answered: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answered), { status: 200 })));
  const t = convexTest(schema);
  const itemId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "backfill", email: "backfill@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    return ctx.db.insert("libraryItems", { userId, openalexId, rating: 0, title: "Paper", searchableText: "paper", savedAt: 1, updatedAt: 1 });
  });
  await t.action(internal.library.backfill.backfillPaperData, {});
  const item = await t.run((ctx) => ctx.db.get("libraryItems", itemId));
  return JSON.parse(item?.paperData ?? "null") as Record<string, unknown> | null;
}

afterEach(() => vi.unstubAllGlobals());

it("keeps the row's id in the work it stores when the API answers it by another id, as the OpenScholar API does", async () => {
  const work = { id: "https://openscholar.ai/OS7", display_name: "Paper", ids: { openalex: "https://openalex.org/W7" } };
  expect(await backfilled("https://openalex.org/W7", work)).toEqual({ ...work, id: "https://openalex.org/W7" });
});

it("keeps the row's id when neither id is a work id it can read", async () => {
  const work = { id: "https://openscholar.ai/W7", display_name: "Paper" };
  expect(await backfilled("https://example.org/W7", work)).toEqual({ ...work, id: "https://example.org/W7" });
});

it("stores OpenAlex's work as it is when it answers by the row's own id", async () => {
  const work = { id: "https://openalex.org/W8", display_name: "Paper" };
  expect(await backfilled("W8", work)).toEqual(work);
});
