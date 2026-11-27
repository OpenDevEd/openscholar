/**
 * A person's Zotero collections, kept as rows, so the form that starts a screening pages through a library of any
 * size and finds a collection by name without asking Zotero for each look (../screening/zoteroSources.ts), and a
 * screening that reads a collection with everything under it knows what is under it (../screening/gathering.ts).
 *
 * A library's collections are read from Zotero a step at a time, several of its pages at once, when someone opens
 * the library and what is kept is older than a few minutes: a group of 3,325 collections took under 7 seconds. Each
 * row then holds what its collection has with everything under it, added up from Zotero's own counts. A paper filed
 * in two collections counts twice there until a screening reads it, so the pages say "about".
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalAction, internalMutation, internalQuery } from "../lib/functions";
import { workspaceMutation, workspaceQuery } from "../lib/userActions";
import { ZOTERO_AT_ONCE, ZOTERO_LIST_PAGE } from "./libraryValidators";

/** How long a library's collections are shown as they were last read, and how long a reading may take before another is set off. */
const FRESH_MS = 10 * 60_000;
const STUCK_MS = 5 * 60_000;
/** How often a reading that went quiet is started again before the library is said to have failed. */
const RESTARTS = 2;
/** Rows one step counts or clears, and rows a page of the form's list shows at most. */
const COUNT_STEP = 100;
const PAGE_MAX = 50;
/** Levels looked up from a collection for where it sits: Zotero's deepest tree measured has 8. */
const LEVELS = 40;

type Tree = Doc<"zoteroTrees">;
const stateValidator = v.object({ state: v.union(v.literal("reading"), v.literal("counting"), v.literal("done"), v.literal("failed")), total: v.number(), read: v.number() });
const rowValidator = v.object({ key: v.string(), name: v.string(), papers: v.number(), inside: v.number(), under: v.optional(v.number()), above: v.optional(v.array(v.object({ key: v.string(), name: v.string() }))) });

const treeOf = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, library: string) => ctx.db.query("zoteroTrees").withIndex("by_user_and_library", (q) => q.eq("userId", userId).eq("library", library)).unique();
const rowOf = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, library: string, key: string) => ctx.db.query("zoteroCollections").withIndex("by_user_and_library_and_key", (q) => q.eq("userId", userId).eq("library", library).eq("key", key)).unique();
const stateOf = (tree: Tree) => ({ state: tree.state, total: tree.total, read: tree.read });
/** A collection as the form lists it. What it holds with everything under it is said once the whole library is counted. */
const shown = (tree: Tree | null, row: Doc<"zoteroCollections">) => ({ key: row.key, name: row.name, papers: row.items, inside: row.inside, ...(tree?.state === "done" ? { under: row.under } : {}) });

/** Has a library's collections read again where what is kept is old, or there is nothing kept, and says how the reading stands. */
export async function ensure(ctx: MutationCtx, userId: Id<"users">, groupId: string | undefined) {
  const library = groupId ?? "";
  const tree = await treeOf(ctx, userId, library);
  const now = Date.now();
  // A reading under way is stuck once nothing of it has been kept for a while, however long ago it began: a large library takes many steps.
  const last = tree ? (tree.state === "reading" || tree.state === "counting" ? Math.max(tree.readAt, tree.beat ?? 0) : tree.readAt) : 0;
  if (tree && now - last < (tree.state === "done" ? FRESH_MS : tree.state === "failed" ? 0 : STUCK_MS)) return stateOf(tree);
  // A reading that went quiet without saying it failed, its action cut short, is started again a few times and then
  // left as failed: a screening that waits on it is told, and doesn't wait for good (../screening/gathering.ts).
  const tries = tree && (tree.state === "reading" || tree.state === "counting") ? (tree.tries ?? 0) + 1 : 0;
  if (tree && tries > RESTARTS) {
    await ctx.db.patch("zoteroTrees", tree._id, { state: "failed", readAt: now, tries: 0 });
    return { state: "failed" as const, total: tree.total, read: tree.read };
  }
  const reading = { state: "reading" as const, readAt: now, beat: undefined, total: tree?.total ?? 0, read: 0, tries };
  const treeId = tree ? (await ctx.db.patch("zoteroTrees", tree._id, reading), tree._id) : await ctx.db.insert("zoteroTrees", { userId, library, ...reading });
  await ctx.scheduler.runAfter(0, internal.zotero.tree.step, { treeId, userId, ...(groupId ? { groupId } : {}), readAt: now, start: 0 });
  return { state: "reading" as const, total: reading.total, read: 0 };
}

/** Opens one of the person's Zotero libraries for the form: its collections are read again where what is kept is old. */
export const open = workspaceMutation({
  args: { groupId: v.optional(v.string()) },
  returns: stateValidator,
  handler: async (ctx, { userId }, { groupId }) => ensure(ctx, userId, groupId),
});

/** How the reading of one of the person's Zotero libraries stands: how many collections it has, and how many are in. */
export const state = workspaceQuery({
  args: { groupId: v.optional(v.string()) },
  returns: v.union(stateValidator, v.null()),
  handler: async (ctx, { userId }, { groupId }) => {
    const tree = await treeOf(ctx, userId, groupId ?? "");
    return tree ? stateOf(tree) : null;
  },
});

/** A page of the collections at one level of one of the person's Zotero libraries, by name: the top level, or the ones inside `parent`. */
export const level = workspaceQuery({
  args: { groupId: v.optional(v.string()), parent: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(rowValidator),
  handler: async (ctx, { userId }, { groupId, parent, paginationOpts }) => {
    const library = groupId ?? "";
    const tree = await treeOf(ctx, userId, library);
    const page = await ctx.db.query("zoteroCollections").withIndex("by_user_and_library_and_parent_and_name", (q) => q.eq("userId", userId).eq("library", library).eq("parent", parent ?? "")).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) });
    return { ...page, page: page.page.map((row) => shown(tree, row)) };
  },
});

/** The collections an address names by key, in order: a folder opened before a reload is shown by its name again. */
export const path = workspaceQuery({
  args: { groupId: v.optional(v.string()), keys: v.array(v.string()) },
  returns: v.array(rowValidator),
  handler: async (ctx, { userId }, { groupId, keys }) => {
    const library = groupId ?? "";
    const tree = await treeOf(ctx, userId, library);
    const rows = await Promise.all(keys.slice(0, LEVELS).map((key) => rowOf(ctx, userId, library, key)));
    return rows.flatMap((row) => (row ? [shown(tree, row)] : []));
  },
});

/** A page of the collections of one of the person's Zotero libraries whose name holds these words, at any level, each with where it sits. */
export const find = workspaceQuery({
  args: { groupId: v.optional(v.string()), text: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(rowValidator),
  handler: async (ctx, { userId }, { groupId, text, paginationOpts }) => {
    const library = groupId ?? "";
    const tree = await treeOf(ctx, userId, library);
    const page = await ctx.db.query("zoteroCollections").withSearchIndex("search_name", (q) => q.search("name", text).eq("userId", userId).eq("library", library)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) });
    const placed = await Promise.all(page.page.map(async (row) => {
      const above: Array<{ key: string; name: string }> = [];
      for (let parent = row.parent, level = 0; parent && level < LEVELS; level++) {
        const one = await rowOf(ctx, userId, library, parent);
        if (!one) break;
        above.unshift({ key: one.key, name: one.name });
        parent = one.parent;
      }
      return { ...shown(tree, row), above };
    }));
    return { ...page, page: placed };
  },
});

/** One step of a library's reading: the next pages of its collections, asked of Zotero at once. The first step asks for one, to learn how many there are. */
export const step = internalAction({
  args: { treeId: v.id("zoteroTrees"), userId: v.id("users"), groupId: v.optional(v.string()), readAt: v.number(), start: v.number(), total: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { treeId, userId, groupId, readAt, start, total }) => {
    type Page = { page: Array<{ key: string; name: string; parentCollection: string | null; numItems: number; numCollections: number }>; total: number };
    const starts = Array.from({ length: total === undefined ? 1 : Math.min(ZOTERO_AT_ONCE, Math.ceil((total - start) / ZOTERO_LIST_PAGE)) }, (_, at) => start + at * ZOTERO_LIST_PAGE);
    try {
      const pages: Page[] = await Promise.all(starts.map((from) => ctx.runAction(internal.zotero.actions.collectionsOf, { userId, ...(groupId ? { groupId } : {}), start: from })));
      const all = pages[0]?.total ?? total ?? 0;
      const next = start + starts.length * ZOTERO_LIST_PAGE;
      await ctx.runMutation(internal.zotero.tree.put, { treeId, readAt, total: all, read: Math.min(next, all), rows: pages.flatMap((one) => one.page).map((one) => ({ key: one.key, name: one.name, parent: one.parentCollection ?? "", items: one.numItems, inside: one.numCollections })) });
      if (next < all) await ctx.scheduler.runAfter(0, internal.zotero.tree.step, { treeId, userId, ...(groupId ? { groupId } : {}), readAt, start: next, total: all });
      else await ctx.scheduler.runAfter(0, internal.zotero.tree.count, { treeId, readAt, cursor: null });
    } catch (error) {
      console.error("[zotero] A library's collections couldn't be read", error);
      await ctx.runMutation(internal.zotero.tree.failed, { treeId, readAt });
    }
    return null;
  },
});

/** Keeps a step's collections: each as a row, the one it had replaced. What it holds with everything under it starts at what it holds itself. */
export const put = internalMutation({
  args: { treeId: v.id("zoteroTrees"), readAt: v.number(), total: v.number(), read: v.number(), rows: v.array(v.object({ key: v.string(), name: v.string(), parent: v.string(), items: v.number(), inside: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { treeId, readAt, total, read, rows }) => {
    const tree = await ctx.db.get("zoteroTrees", treeId);
    if (!tree || tree.readAt !== readAt) return null;
    for (const row of rows) {
      const was = await rowOf(ctx, tree.userId, tree.library, row.key);
      const now = { ...row, under: row.items, readAt };
      if (was) await ctx.db.patch("zoteroCollections", was._id, now);
      else await ctx.db.insert("zoteroCollections", { userId: tree.userId, library: tree.library, ...now });
    }
    await ctx.db.patch("zoteroTrees", treeId, { total, read, beat: Date.now() });
    return null;
  },
});

export const failed = internalMutation({
  args: { treeId: v.id("zoteroTrees"), readAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { treeId, readAt }) => {
    const tree = await ctx.db.get("zoteroTrees", treeId);
    if (tree?.readAt === readAt) await ctx.db.patch("zoteroTrees", treeId, { state: "failed" });
    return null;
  },
});

/**
 * Once a library is read: a step at a time, a collection Zotero no longer has goes, and what each collection holds
 * is added to every collection it sits in, so each says what it has with everything under it.
 */
export const count = internalMutation({
  args: { treeId: v.id("zoteroTrees"), readAt: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { treeId, readAt, cursor }) => {
    const tree = await ctx.db.get("zoteroTrees", treeId);
    if (!tree || tree.readAt !== readAt) return null;
    await ctx.db.patch("zoteroTrees", treeId, { ...(cursor === null ? { state: "counting" as const } : {}), beat: Date.now() });
    const page = await ctx.db.query("zoteroCollections").withIndex("by_user_and_library_and_key", (q) => q.eq("userId", tree.userId).eq("library", tree.library)).paginate({ cursor, numItems: COUNT_STEP });
    for (const row of page.page) {
      if (row.readAt !== readAt) { await ctx.db.delete("zoteroCollections", row._id); continue; }
      if (!row.items) continue;
      for (let parent = row.parent, level = 0; parent && level < LEVELS; level++) {
        const above = await rowOf(ctx, tree.userId, tree.library, parent);
        if (!above || above.readAt !== readAt) break;
        await ctx.db.patch("zoteroCollections", above._id, { under: above.under + row.items });
        parent = above.parent;
      }
    }
    if (page.isDone) await ctx.db.patch("zoteroTrees", treeId, { state: "done" });
    else await ctx.scheduler.runAfter(0, internal.zotero.tree.count, { treeId, readAt, cursor: page.continueCursor });
    return null;
  },
});

/**
 * For a screening that reads a collection with everything under it: has the library read where it is old, and says
 * whether it is all in. A reading that has just failed is said, and not tried again: the screening's check fails its
 * source as it does any other it can't read, and the next check, or the form, starts the reading anew.
 */
export const ready = internalMutation({
  args: { userId: v.id("users"), groupId: v.optional(v.string()) },
  returns: v.union(v.literal("done"), v.literal("wait"), v.literal("failed")),
  handler: async (ctx, { userId, groupId }) => {
    const tree = await treeOf(ctx, userId, groupId ?? "");
    if (tree?.state === "failed" && Date.now() - tree.readAt < STUCK_MS) return "failed";
    return (await ensure(ctx, userId, groupId)).state === "done" ? "done" : "wait";
  },
});

/** One collection as kept: what it holds itself, and with everything under it. */
export const one = internalQuery({
  args: { userId: v.id("users"), groupId: v.optional(v.string()), key: v.string() },
  returns: v.union(v.null(), v.object({ items: v.number(), under: v.number() })),
  handler: async (ctx, { userId, groupId, key }) => {
    const row = await rowOf(ctx, userId, groupId ?? "", key);
    return row ? { items: row.items, under: row.under } : null;
  },
});

/** A page of the collections inside one, by name, each with what it holds itself: what a screening reads on to once the one they sit in is read. */
export const inside = internalQuery({
  args: { userId: v.id("users"), groupId: v.optional(v.string()), parent: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ key: v.string(), items: v.number() })),
  handler: async (ctx, { userId, groupId, parent, paginationOpts }) => {
    const page = await ctx.db.query("zoteroCollections").withIndex("by_user_and_library_and_parent_and_name", (q) => q.eq("userId", userId).eq("library", groupId ?? "").eq("parent", parent)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, ZOTERO_LIST_PAGE) });
    return { ...page, page: page.page.map((row) => ({ key: row.key, items: row.items })) };
  },
});
