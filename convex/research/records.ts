import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { accountMutation, accountQuery, assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, type Author } from "../lib/userActions";
import {
  applySearchEdit, commandValidator, ratingValidator, searchValidator, shortcutValidator,
  type ResearchCommand, type SavedSearch,
} from "../../lib/research/records";

const accountArgs = { accountId: v.string() };
const pageArgs = { paginationOpts: paginationOptsValidator };
async function account(ctx: Parameters<typeof requireAuth>[0], expected: string) {
  const user = await requireAuth(ctx);
  if (user.clerkId !== expected) throw new Error("Account changed. Retry after signing in.");
  return user._id;
}

// Each action is defined once; the page's function and the assistant's are made from it.

export const searchesAction = defineUserQuery({
  path: "research/records:searches",
  description: "Lists the person's saved searches, newest first, a page at a time. Each has an ID the other search tools take.",
  args: pageArgs,
  returns: paginationResultValidator(searchValidator),
  run: async (ctx, userId, args) => {
    const page = await ctx.db.query("searches").withIndex("by_user_and_createdAt", q => q.eq("userId", userId)).order("desc").paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(row => hydrate(ctx, row))) };
  },
});
export const searches = accountQuery(searchesAction);
export const searchesForAssistant = assistantQuery(searchesAction);

export const shortcutsAction = defineUserQuery({
  path: "research/records:shortcuts",
  description: "Lists the person's query shortcuts (the Bookmarks page): a short name that expands to a longer query.",
  args: pageArgs,
  returns: paginationResultValidator(shortcutValidator),
  run: async (ctx, userId, args) => {
    const page = await ctx.db.query("queryShortcuts").withIndex("by_user", q => q.eq("userId", userId)).paginate(args.paginationOpts);
    return { ...page, page: page.page.map(row => row.data) };
  },
});
export const shortcuts = accountQuery(shortcutsAction);
export const shortcutsForAssistant = assistantQuery(shortcutsAction);

export const ratingsAction = defineUserQuery({
  path: "research/records:ratings",
  description: "Lists the papers the person has rated, each with its rating from 0 to 5.",
  args: pageArgs,
  returns: paginationResultValidator(ratingValidator),
  run: async (ctx, userId, args) => {
    const page = await ctx.db.query("paperRatings").withIndex("by_user", q => q.eq("userId", userId)).paginate(args.paginationOpts);
    return { ...page, page: page.page.map(row => row.data) };
  },
});
export const ratings = accountQuery(ratingsAction);
export const ratingsForAssistant = assistantQuery(ratingsAction);

export const getSearchAction = defineUserQuery({
  path: "research/records:getSearch",
  description: "Reads one saved search by ID: its query, filters, sort, page, and screening questions and answers.",
  args: { id: v.string() },
  returns: v.union(searchValidator, v.null()),
  run: async (ctx, userId, args) => {
    const search = await findSearch(ctx, userId, args.id);
    return search ? hydrate(ctx, search) : null;
  },
});
export const getSearch = accountQuery(getSearchAction);
export const getSearchForAssistant = assistantQuery(getSearchAction);

export const revisionsAction = defineUserQuery({
  path: "research/records:revisions",
  description: "Lists a saved search's earlier versions, newest first, each marked as made by the person or by the assistant.",
  args: { ...pageArgs, id: v.string() },
  returns: paginationResultValidator(v.object({ revision: v.number(), author: v.union(v.literal("user"), v.literal("assistant")), data: searchValidator, deleted: v.boolean(), createdAt: v.number() })),
  run: async (ctx, userId, args) => {
    const search = await findSearch(ctx, userId, args.id);
    if (!search) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db.query("searchRevisions").withIndex("by_search_and_revision", q => q.eq("searchId", search._id)).order("desc").paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(async row => ({ revision: row.revision, author: row.author, data: await hydrate(ctx, row), deleted: row.deleted, createdAt: row.createdAt }))) };
  },
});
export const revisions = accountQuery(revisionsAction);
export const revisionsForAssistant = assistantQuery(revisionsAction);

function findSearch(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, localId: string) {
  return ctx.db.query("searches").withIndex("by_user_and_localId", q => q.eq("userId", userId).eq("localId", localId)).unique();
}

async function hydrate(ctx: Pick<QueryCtx, "db">, row: Pick<Doc<"searches">, "data" | "responseChunks">): Promise<SavedSearch> {
  if (!row.responseChunks) return row.data;
  const chunks = await Promise.all(row.responseChunks.map(id => ctx.db.get("researchResponseChunks", id)));
  if (chunks.some(chunk => !chunk)) throw new Error("Saved screening responses are missing.");
  return { ...row.data, screeningResponses: chunks.flatMap(chunk => chunk!.responses) };
}

/** Screening runs can exceed a document's 1 MiB limit. Revisions share immutable chunks. */
async function storeSearch(ctx: MutationCtx, data: SavedSearch) {
  const responseChunks: Id<"researchResponseChunks">[] = [];
  let chunk: SavedSearch["screeningResponses"] = [];
  let bytes = 0;
  for (const row of data.screeningResponses) {
    const size = JSON.stringify(row).length * 3;
    if (chunk.length && bytes + size > 250_000) {
      responseChunks.push(await ctx.db.insert("researchResponseChunks", { responses: chunk }));
      chunk = []; bytes = 0;
    }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) responseChunks.push(await ctx.db.insert("researchResponseChunks", { responses: chunk }));
  return { data: { ...data, screeningResponses: [] }, responseChunks };
}

function validateSearch(search: SavedSearch) {
  if (!search.id || !Number.isFinite(Date.parse(search.createdAt)) || !Number.isFinite(Date.parse(search.updatedAt))) throw new Error("Invalid saved search identity or timestamp.");
  for (const range of [search.yearRange, search.ratingRange]) {
    if (range && (range.length !== 2 || range[0] > range[1])) throw new Error("Invalid search range.");
  }
  for (const date of [search.dateRange?.from, search.dateRange?.to]) {
    if (date !== undefined && !Number.isFinite(Date.parse(date))) throw new Error("Invalid search date.");
  }
}

async function revision(ctx: MutationCtx, search: Doc<"searches">, author: "user" | "assistant", deleted = false) {
  await ctx.db.insert("searchRevisions", { userId: search.userId, searchId: search._id, revision: search.revision, author, data: search.data, ...(search.responseChunks ? { responseChunks: search.responseChunks } : {}), deleted, createdAt: Date.now() });
}

/** Assistant tools can call this transaction helper with their authenticated owner. */
export async function applyCommand(ctx: MutationCtx, userId: Id<"users">, command: ResearchCommand, author: "user" | "assistant") {
  switch (command.kind) {
    case "createSearch": {
      validateSearch(command.search);
      if (await findSearch(ctx, userId, command.search.id)) throw new Error("Search already exists.");
      const id = await ctx.db.insert("searches", { userId, localId: command.search.id, ...await storeSearch(ctx, command.search), revision: 1 });
      await revision(ctx, (await ctx.db.get("searches", id))!, author);
      return;
    }
    case "editSearch": {
      const search = await findSearch(ctx, userId, command.id);
      if (!search) throw new Error("Search not found.");
      const previous = await hydrate(ctx, search);
      const data = applySearchEdit(previous, command.edit, new Date().toISOString());
      validateSearch(data);
      if (JSON.stringify({ ...data, updatedAt: previous.updatedAt }) === JSON.stringify(previous)) return;
      const stored = JSON.stringify(data.screeningResponses) === JSON.stringify(previous.screeningResponses) && search.responseChunks
        ? { data: { ...data, screeningResponses: [] }, responseChunks: search.responseChunks }
        : await storeSearch(ctx, data);
      const next = { ...search, ...stored, revision: search.revision + 1 };
      await ctx.db.patch("searches", search._id, { ...stored, revision: next.revision });
      await revision(ctx, next, author);
      return;
    }
    case "deleteSearch": {
      const search = await findSearch(ctx, userId, command.id);
      if (!search) return;
      await revision(ctx, { ...search, revision: search.revision + 1 }, author, true);
      await ctx.db.delete("searches", search._id);
      return;
    }
    case "shortcut": {
      if (!command.shorthand.trim()) throw new Error("Bookmark name is required.");
      const row = await ctx.db.query("queryShortcuts").withIndex("by_user_and_shorthand", q => q.eq("userId", userId).eq("data.shorthand", command.shorthand)).unique();
      if (command.value === null) { if (row) await ctx.db.delete("queryShortcuts", row._id); return; }
      const data = { shorthand: command.shorthand, ...command.value };
      if (row) await ctx.db.patch("queryShortcuts", row._id, { data });
      else await ctx.db.insert("queryShortcuts", { userId, data });
      return;
    }
    case "rating": {
      if (!command.paperId || (command.rating !== null && (!Number.isInteger(command.rating) || command.rating < 0 || command.rating > 5))) throw new Error("Rating must be an integer from 0 to 5.");
      const row = await ctx.db.query("paperRatings").withIndex("by_user_and_paperId", q => q.eq("userId", userId).eq("data.paperId", command.paperId)).unique();
      if (command.rating === null) { if (row) await ctx.db.delete("paperRatings", row._id); return; }
      const data = { paperId: command.paperId, rating: command.rating };
      if (row) await ctx.db.patch("paperRatings", row._id, { data });
      else await ctx.db.insert("paperRatings", { userId, data });
    }
  }
}

async function received(ctx: MutationCtx, userId: Id<"users">, key: string) {
  return await ctx.db.query("researchReceipts").withIndex("by_user_and_key", q => q.eq("userId", userId).eq("key", key)).unique();
}

export const changeAction = defineUserMutation({
  path: "research/records:change",
  description:
    "Changes the person's research records: create, edit or delete a saved search, set or remove a query shortcut, or rate a paper. Edits to a search show live on the person's open page and are kept as revisions.",
  args: { requestId: v.string(), command: commandValidator },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  // Search changes are kept as revisions, but nothing restores one yet, and shortcuts and ratings keep no history (#342).
  undoable: false,
  retryKey: "requestId",
  // The receipt makes a retried request apply once, from the page or from the assistant.
  run: async (ctx, userId, args, author: Author) => {
    const key = `change:${args.requestId}`;
    if (await received(ctx, userId, key)) return null;
    await applyCommand(ctx, userId, args.command, author);
    await ctx.db.insert("researchReceipts", { userId, key });
    return null;
  },
});
export const change = accountMutation(changeAction);
export const changeForAssistant = assistantMutation(changeAction);

export const importBatch = mutation({
  args: { ...accountArgs, searches: v.array(searchValidator), shortcuts: v.array(shortcutValidator), ratings: v.array(ratingValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    if (args.searches.length + args.shortcuts.length + args.ratings.length > 25) throw new Error("Import at most 25 records per batch.");
    const items: Array<{ key: string; command: ResearchCommand }> = [
      ...args.searches.map(search => ({ key: `search:${search.id}`, command: { kind: "createSearch" as const, search } })),
      ...args.shortcuts.map(({ shorthand, ...value }) => ({ key: `shortcut:${shorthand}`, command: { kind: "shortcut" as const, shorthand, value } })),
      ...args.ratings.map(({ paperId, rating }) => ({ key: `rating:${paperId}`, command: { kind: "rating" as const, paperId, rating } })),
    ];
    for (const { key, command } of items) {
      const fingerprint = await digestOpaqueToken(JSON.stringify(command));
      const receipt = await received(ctx, userId, `import:${key}`);
      if (receipt?.fingerprint === fingerprint) continue;
      if (command.kind === "createSearch" && (receipt || await findSearch(ctx, userId, command.search.id))) {
        // Preserve a local edit made after an interrupted import as a separate copy.
        const copyKey = `import:${key}:${fingerprint}`;
        if (!await received(ctx, userId, copyKey)) {
          await applyCommand(ctx, userId, { ...command, search: { ...command.search, id: `${command.search.id}-${fingerprint}` } }, "user");
          await ctx.db.insert("researchReceipts", { userId, key: copyKey, fingerprint });
        }
        continue;
      }
      if (receipt) throw new Error("This local bookmark or rating changed after import. Your local copy has been kept.");
      const existing = command.kind === "shortcut"
        ? await ctx.db.query("queryShortcuts").withIndex("by_user_and_shorthand", q => q.eq("userId", userId).eq("data.shorthand", command.shorthand)).unique()
        : command.kind === "rating"
          ? await ctx.db.query("paperRatings").withIndex("by_user_and_paperId", q => q.eq("userId", userId).eq("data.paperId", command.paperId)).unique()
          : null;
      if (existing) {
        const same = command.kind === "shortcut" ? existing.data && "expansion" in existing.data && existing.data.expansion === command.value?.expansion
          : command.kind === "rating" && "rating" in existing.data && existing.data.rating === command.rating;
        if (!same) throw new Error("This local bookmark or rating differs from your saved account record. Your local copy has been kept.");
      } else await applyCommand(ctx, userId, command, "user");
      await ctx.db.insert("researchReceipts", { userId, key: `import:${key}`, fingerprint });
    }
    return null;
  },
});
