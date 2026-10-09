// The papers a library's suggestions start from: a collection's newest members, or the library's
// newest papers, by the id each was saved with, at most a hundred, and only the person's own.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { collectionSortName } from "./collections";
import type { Id } from "../_generated/dataModel";
import { SUGGESTION_SEEDS } from "./queries";

async function setup() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const user = (clerkId: string) => ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@test`, state: "active", createdAt: 1, updatedAt: 1 });
    return { ada: await user("ada"), bo: await user("bo") };
  });
  /** Saves papers for `userId`, the nth saved at time n. */
  const save = (userId: Id<"users">, count: number, prefix = "OS") =>
    t.run(async (ctx) => {
      const saved: Id<"libraryItems">[] = [];
      for (let at = 1; at <= count; at += 1) {
        saved.push(await ctx.db.insert("libraryItems", { userId, openalexId: `https://openscholar.ai/${prefix}${at}`, rating: 0, title: `Paper ${at}`, searchableText: `paper ${at}`, savedAt: at, updatedAt: at }));
      }
      return saved;
    });
  const collect = (userId: Id<"users">, items: readonly Id<"libraryItems">[]) =>
    t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", { userId, itemCount: items.length, name: "Rural teachers", sortName: collectionSortName("Rural teachers"), createdAt: 1, updatedAt: 1 });
      for (const libraryItemId of items) {
        await ctx.db.insert("libraryItemCollections", { userId, collectionId, libraryItemId, assignedAt: 1 });
      }
      return collectionId;
    });
  return { t, ...ids, save, collect, as: (clerkId: string) => t.withIdentity({ subject: clerkId }) };
}

describe("suggestionSeeds", () => {
  it("starts from the library's newest papers, at most a hundred a page", async () => {
    const { ada, save, as } = await setup();
    await save(ada, SUGGESTION_SEEDS + 5);
    const { page } = await as("ada").query(api.library.queries.suggestionSeeds, { paginationOpts: { numItems: 500, cursor: null } });
    expect(page).toHaveLength(SUGGESTION_SEEDS);
    expect(page.slice(0, 2)).toEqual(["https://openscholar.ai/OS105", "https://openscholar.ai/OS104"]);
  });

  it("starts from a collection's newest members, and from nothing of someone else's collection", async () => {
    const { ada, bo, save, collect, as } = await setup();
    const items = await save(ada, 5);
    const collectionId = await collect(ada, [items[0]!, items[2]!, items[4]!]);
    const first = { numItems: SUGGESTION_SEEDS, cursor: null };
    expect((await as("ada").query(api.library.queries.suggestionSeeds, { collectionId, paginationOpts: first })).page).toEqual([
      "https://openscholar.ai/OS5",
      "https://openscholar.ai/OS3",
      "https://openscholar.ai/OS1",
    ]);
    await save(bo, 1, "W");
    expect((await as("bo").query(api.library.queries.suggestionSeeds, { collectionId, paginationOpts: first })).page).toEqual([]);
  });

  it("refuses someone signed out", async () => {
    const { t } = await setup();
    await expect(t.query(api.library.queries.suggestionSeeds, { paginationOpts: { numItems: 1, cursor: null } })).rejects.toThrow();
  });
});
