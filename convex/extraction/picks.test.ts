// An extraction's picks as the sources its job stores (#690): any number of paper sets, each a range, and uploads.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/personal";
import { sourcesFor } from "./picks";

async function setup() {
  const t = convexTest(schema);
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "alice", email: "alice@example.com", state: "active", createdAt: 1, updatedAt: 1 }));
  const alice = t.withIdentity({ subject: "alice" });
  const sources = (picks: Parameters<typeof sourcesFor>[2], uploads?: Parameters<typeof sourcesFor>[3]) =>
    t.run(async (ctx) => sourcesFor(ctx, { userId, workspaceId: await personalWorkspaceOf(ctx, userId) }, picks, uploads));
  return { t, alice, sources };
}

describe("an extraction's picks", () => {
  it("become one source each: a search from its result `first`, a collection's and the saved papers' range, and an upload", async () => {
    const { t, alice, sources } = await setup();
    const { id: searchId } = await alice.mutation(api.research.searches.create, { query: "teacher coaching" });
    const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { name: "Trials" });
    const pdf = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })));

    const made = await sources(
      [
        { set: { kind: "search", searchId }, first: 101, last: 300 },
        { set: { kind: "search", searchId }, first: 1, last: 50 },
        { set: { kind: "collection", collectionId }, first: 5, last: 20 },
        { set: { kind: "saved" }, first: 1, last: 10 },
      ],
      [{ storageId: pdf, title: "Report.pdf" }],
    );
    expect(made.map(({ source, title, searchFilters, librarySet }) => ({ source, title, first: searchFilters?.first, limit: searchFilters?.limit, librarySet }))).toEqual([
      { source: "history", title: "teacher coaching", first: 101, limit: 300, librarySet: undefined },
      // A search read from its first result says nothing of where it starts.
      { source: "history", title: "teacher coaching", first: undefined, limit: 50, librarySet: undefined },
      { source: "collection", title: "Trials", first: undefined, limit: undefined, librarySet: { collectionId, first: 5, last: 20, count: 0 } },
      { source: "library", title: "Saved papers", first: undefined, limit: undefined, librarySet: { first: 1, last: 10, count: 0 } },
      { source: "upload", title: "Report.pdf", first: undefined, limit: undefined, librarySet: undefined },
    ]);
    expect(made[4]).toMatchObject({ storageId: pdf, bucketKey: `upload:${pdf}` });
    // Two ranges of one search are two sources, which the start keeps apart.
    expect(new Set(made.slice(0, 2).map((source) => source.bucketKey)).size).toBe(2);
  });

  it("refuses a range that runs backwards or starts before the first paper, and a collection of another workspace", async () => {
    const { t, sources } = await setup();
    await expect(sources([{ set: { kind: "saved" }, first: 0, last: 10 }])).rejects.toThrow(/from 1 up/);
    await expect(sources([{ set: { kind: "saved" }, first: 20, last: 10 }])).rejects.toThrow(/first before the last/);
    await t.run((ctx) => ctx.db.insert("users", { clerkId: "bob", email: "bob@example.com", state: "active", createdAt: 1, updatedAt: 1 }));
    const { id: elsewhere } = await t.withIdentity({ subject: "bob" }).mutation(api.library.collections.createCollection, { name: "Bob's" });
    await expect(sources([{ set: { kind: "collection", collectionId: elsewhere }, first: 1, last: 3 }])).rejects.toThrow(/Collection not found/);
  });
});
