// A person's Zotero collections kept as rows (./tree.ts): what each holds with everything under it, and what a later reading takes away.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { team } from "../screening/reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const row = (key: string, parent: string, items: number, inside = 0) => ({ key, name: `Collection ${key}`, parent, items, inside });

it("counts what each collection holds with everything under it, pages a level by name, finds one by name with where it sits, and drops what Zotero no longer has", async () => {
  const made = await team(["ann", "ben"]);
  const { workspaceId } = made;
  const userId = made.ids.ann!;
  const treeId = await made.t.run((ctx) => ctx.db.insert("zoteroTrees", { userId, library: "", state: "reading", readAt: 1, total: 4, read: 0 }));
  // A (3 of its own) holds B (2) and C (none), and B holds D (5).
  await made.t.mutation(internal.zotero.tree.put, { treeId, readAt: 1, total: 4, read: 4, rows: [row("A", "", 3, 2), row("B", "A", 2, 1), row("C", "A", 0), row("D", "B", 5)] });
  // Until it is counted, a collection says what it holds itself and no more.
  expect((await made.as.ann!.query(api.zotero.tree.level, { workspaceId, paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([{ key: "A", name: "Collection A", papers: 3, inside: 2 }]);
  await made.t.mutation(internal.zotero.tree.count, { treeId, readAt: 1, cursor: null });
  expect(await made.as.ann!.query(api.zotero.tree.state, { workspaceId })).toEqual({ state: "done", total: 4, read: 4 });
  expect((await made.as.ann!.query(api.zotero.tree.level, { workspaceId, paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([{ key: "A", name: "Collection A", papers: 3, inside: 2, under: 10 }]);
  expect((await made.as.ann!.query(api.zotero.tree.level, { workspaceId, parent: "A", paginationOpts: { cursor: null, numItems: 10 } })).page.map((one) => [one.key, one.under])).toEqual([["B", 7], ["C", 0]]);
  expect((await made.as.ann!.query(api.zotero.tree.find, { workspaceId, text: "D", paginationOpts: { cursor: null, numItems: 10 } })).page).toMatchObject([{ key: "D", above: [{ key: "A", name: "Collection A" }, { key: "B", name: "Collection B" }] }]);
  // They are Ann's: Ben's own library is empty.
  expect((await made.as.ben!.query(api.zotero.tree.level, { workspaceId, paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);

  // Read again: D is gone from Zotero and B holds one more. What is kept follows.
  await made.t.run((ctx) => ctx.db.patch("zoteroTrees", treeId, { state: "reading", readAt: 2 }));
  await made.t.mutation(internal.zotero.tree.put, { treeId, readAt: 2, total: 3, read: 3, rows: [row("A", "", 3, 2), row("B", "A", 3), row("C", "A", 0)] });
  await made.t.mutation(internal.zotero.tree.count, { treeId, readAt: 2, cursor: null });
  expect((await made.t.run((ctx) => ctx.db.query("zoteroCollections").collect())).map((one) => [one.key, one.under]).sort()).toEqual([["A", 6], ["B", 3], ["C", 0]]);
});

it("leaves a long reading alone while it keeps what it reads, and starts one again that went quiet", async () => {
  const made = await team(["ann"]);
  const { workspaceId } = made;
  const began = Date.now();
  const treeId = await made.t.run((ctx) => ctx.db.insert("zoteroTrees", { userId: made.ids.ann!, library: "", state: "reading", readAt: began, total: 900, read: 0 }));
  // Ten minutes in, it has just kept another step of a large library.
  vi.setSystemTime(began + 10 * 60_000);
  await made.t.mutation(internal.zotero.tree.put, { treeId, readAt: began, total: 900, read: 400, rows: [row("A", "", 1)] });
  expect(await made.as.ann!.mutation(api.zotero.tree.open, { workspaceId })).toEqual({ state: "reading", total: 900, read: 400 });
  expect((await made.t.run((ctx) => ctx.db.get("zoteroTrees", treeId)))!.readAt).toBe(began);
  // Nothing more of it for longer than a step takes: it is read again from the start.
  vi.setSystemTime(began + 20 * 60_000);
  expect(await made.as.ann!.mutation(api.zotero.tree.open, { workspaceId })).toEqual({ state: "reading", total: 900, read: 0 });
  expect((await made.t.run((ctx) => ctx.db.get("zoteroTrees", treeId)))!.readAt).toBe(began + 20 * 60_000);
});
