import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { answersAtVersions, clearPaperAnswers, currentAnswers, replaceAnswers, screeningFor, setPaperAnswers, type AnswerSource } from "./answers";
import {
  applySearchEdit, commandValidator, ratingValidator, searchValidator, shortcutValidator,
  type ResearchCommand, type SavedSearch,
} from "../../lib/research/records";

/** Who made a change to a search: the person, or the assistant acting for them. */
type Author = "user" | "assistant";

const accountArgs = { accountId: v.string() };
const pageArgs = { ...accountArgs, paginationOpts: paginationOptsValidator };
async function account(ctx: Parameters<typeof requireAuth>[0], expected: string) {
  const user = await requireAuth(ctx);
  if (user.clerkId !== expected) throw new Error("Account changed. Retry after signing in.");
  return user._id;
}

export const searches = query({
  args: pageArgs,
  returns: paginationResultValidator(searchValidator),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    const page = await ctx.db.query("searches").withIndex("by_user_and_createdAt", q => q.eq("userId", userId)).order("desc").paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(row => hydrate(ctx, row))) };
  },
});
export const shortcuts = query({
  args: pageArgs,
  returns: paginationResultValidator(shortcutValidator),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    const page = await ctx.db.query("queryShortcuts").withIndex("by_user", q => q.eq("userId", userId)).paginate(args.paginationOpts);
    return { ...page, page: page.page.map(row => row.data) };
  },
});
export const ratings = query({
  args: pageArgs,
  returns: paginationResultValidator(ratingValidator),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    const page = await ctx.db.query("paperRatings").withIndex("by_user", q => q.eq("userId", userId)).paginate(args.paginationOpts);
    return { ...page, page: page.page.map(row => row.data) };
  },
});
export const getSearch = query({
  args: { ...accountArgs, id: v.string() },
  returns: v.union(searchValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    const search = await findSearch(ctx, userId, args.id);
    return search ? hydrate(ctx, search) : null;
  },
});
export const revisions = query({
  args: { ...pageArgs, id: v.string() },
  returns: paginationResultValidator(v.object({ revision: v.number(), author: v.union(v.literal("user"), v.literal("assistant")), data: searchValidator, deleted: v.boolean(), createdAt: v.number() })),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    const search = await findSearch(ctx, userId, args.id);
    if (!search) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db.query("searchRevisions").withIndex("by_search_and_revision", q => q.eq("searchId", search._id)).order("desc").paginate(args.paginationOpts);
    const data = await hydrateRevisions(ctx, search._id, page.page);
    return { ...page, page: page.page.map((row, i) => ({ revision: row.revision, author: row.author, data: data[i], deleted: row.deleted, createdAt: row.createdAt })) };
  },
});

function findSearch(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, localId: string) {
  return ctx.db.query("searches").withIndex("by_user_and_localId", q => q.eq("userId", userId).eq("localId", localId)).unique();
}

type RevisionRow = Pick<Doc<"searchRevisions">, "data" | "responseChunks" | "answersVersion">;

/** A search with its current screening answers. */
async function hydrate(ctx: Pick<QueryCtx, "db">, row: Pick<Doc<"searches">, "_id" | "data" | "responseChunks">): Promise<SavedSearch> {
  const screening = await screeningFor(ctx, row._id);
  return { ...row.data, screeningResponses: screening ? await currentAnswers(ctx, screening._id) : await legacyResponses(ctx, row) };
}

/** Revisions of one search, each with the answers at the screening version it saw. */
async function hydrateRevisions(ctx: Pick<QueryCtx, "db">, searchId: Id<"searches">, rows: RevisionRow[]): Promise<SavedSearch[]> {
  const versions = rows.flatMap(row => (row.answersVersion === undefined ? [] : [row.answersVersion]));
  const screening = versions.length ? await screeningFor(ctx, searchId) : null;
  const answers = screening ? await answersAtVersions(ctx, screening._id, versions) : new Map();
  return Promise.all(rows.map(async row => ({ ...row.data, screeningResponses: row.answersVersion === undefined || !screening ? await legacyResponses(ctx, row) : answers.get(row.answersVersion)! })));
}

/**
 * Answers saved before they had their own rows, in chunks on the search and its
 * revisions. Read only until `migrations/moveScreeningAnswers` has moved them all.
 */
async function legacyResponses(ctx: Pick<QueryCtx, "db">, row: Pick<Doc<"searches">, "data" | "responseChunks">) {
  if (!row.responseChunks) return row.data.screeningResponses;
  const chunks = await Promise.all(row.responseChunks.map(id => ctx.db.get("researchResponseChunks", id)));
  if (chunks.some(chunk => !chunk)) throw new Error("Saved screening responses are missing.");
  return chunks.flatMap(chunk => chunk!.responses);
}

/**
 * Moves one search's answers out of its chunks: each revision's answers go into the
 * history as a version the revision then points at, and the search's current answers
 * into answer rows. Revisions before the first answer need no version: their chunks are
 * empty. Every search saved by the old code has a `responseChunks` field, and moving clears
 * it, so a search moves once. Deleted searches are reached through their revisions. Safe to run again.
 */
export async function moveSearchAnswers(ctx: MutationCtx, searchId: Id<"searches">, userId: Id<"users">) {
  const search = await ctx.db.get("searches", searchId);
  if (search?.responseChunks === undefined && search !== null) return false;
  if (await screeningFor(ctx, searchId)) return false;
  const revisions = await ctx.db.query("searchRevisions").withIndex("by_search_and_revision", q => q.eq("searchId", searchId)).collect();
  let previous: string | undefined;
  let answersVersion: number | undefined;
  for (const row of [...revisions, ...(search ? [search] : [])]) {
    // The old code reused a search's chunks until its answers changed, so a large search
    // has few distinct chunk lists. Replaying only those keeps the move within one transaction's limits.
    const chunks = JSON.stringify(row.responseChunks ?? row.data.screeningResponses);
    if (chunks !== previous) answersVersion = await replaceAnswers(ctx, userId, searchId, await legacyResponses(ctx, row), "unrecorded", "searchId" in row ? row.createdAt : Date.now());
    previous = chunks;
    if ("searchId" in row && answersVersion !== undefined) await ctx.db.patch("searchRevisions", row._id, { answersVersion });
  }
  if (search) await ctx.db.patch("searches", search._id, { responseChunks: undefined });
  return answersVersion !== undefined;
}

/** Answers in a comparable order, whatever order they were stored in. */
const normalized = (responses: SavedSearch["screeningResponses"]) =>
  JSON.stringify(responses.flatMap(row => row.responses.map(value => [row.paperId, value.question, value.response])).sort());

/**
 * Checks the move before chunks are removed: every revision still on chunks must read the
 * same answers from the history, and no search or revision with answers may still be waiting.
 */
export async function verifyMovedAnswers(ctx: QueryCtx) {
  const mismatches: string[] = [];
  let revisions = 0;
  let waiting = 0;
  for await (const row of ctx.db.query("searchRevisions")) {
    if (!row.responseChunks) continue;
    revisions++;
    if (row.answersVersion === undefined) {
      if ((await legacyResponses(ctx, row)).length > 0) waiting++;
      continue;
    }
    if (normalized(await legacyResponses(ctx, row)) !== normalized((await hydrateRevisions(ctx, row.searchId, [row]))[0].screeningResponses)) mismatches.push(`${row.searchId} revision ${row.revision}`);
  }
  for await (const search of ctx.db.query("searches")) if (search.responseChunks !== undefined) waiting++;
  return { revisions, waiting, mismatches };
}

/** Who a change to answers is recorded as: the assistant, or the person and what the page said. */
const answerSource = (author: Author, by?: "model" | "person"): AnswerSource => (author === "assistant" ? "assistant" : by ?? "person");

function validateSearch(search: SavedSearch) {
  if (!search.id || !Number.isFinite(Date.parse(search.createdAt)) || !Number.isFinite(Date.parse(search.updatedAt))) throw new Error("Invalid saved search identity or timestamp.");
  for (const range of [search.yearRange, search.ratingRange]) {
    if (range && (range.length !== 2 || range[0] > range[1])) throw new Error("Invalid search range.");
  }
  for (const date of [search.dateRange?.from, search.dateRange?.to]) {
    if (date !== undefined && !Number.isFinite(Date.parse(date))) throw new Error("Invalid search date.");
  }
}

/** A revision stores the search's fields, and the screening version its answers are rebuilt from. */
async function revision(ctx: MutationCtx, search: Doc<"searches">, author: Author, deleted = false) {
  const answersVersion = (await screeningFor(ctx, search._id))?.version;
  await ctx.db.insert("searchRevisions", { userId: search.userId, searchId: search._id, revision: search.revision, author, data: search.data, ...(answersVersion === undefined ? {} : { answersVersion }), deleted, createdAt: Date.now() });
}

/** Assistant tools can call this transaction helper with their authenticated owner. */
export async function applyCommand(ctx: MutationCtx, userId: Id<"users">, command: ResearchCommand, author: Author) {
  switch (command.kind) {
    case "createSearch": {
      validateSearch(command.search);
      if (await findSearch(ctx, userId, command.search.id)) throw new Error("Search already exists.");
      const id = await ctx.db.insert("searches", { userId, localId: command.search.id, data: { ...command.search, screeningResponses: [] }, revision: 1 });
      // Answers carried in a new search come from an import or the assistant; neither says who gave them.
      await replaceAnswers(ctx, userId, id, command.search.screeningResponses, author === "assistant" ? "assistant" : "unrecorded", Date.now());
      await revision(ctx, (await ctx.db.get("searches", id))!, author);
      return;
    }
    case "editSearch": {
      const search = await findSearch(ctx, userId, command.id);
      if (!search) throw new Error("Search not found.");
      // A search still on chunks moves first, so every revision keeps its answers.
      await moveSearchAnswers(ctx, search._id, userId);
      const now = new Date();
      const edit = command.edit;
      // One paper's answers: the page writes these one paper at a time, so they touch only that paper and make no revision.
      if (edit.kind === "responses" || (edit.kind === "clearResponses" && edit.paperId)) {
        if (edit.kind === "responses") await setPaperAnswers(ctx, userId, search._id, edit.paperId, edit.responses, answerSource(author, edit.by), now.getTime());
        else await clearPaperAnswers(ctx, search._id, edit.paperId!, now.getTime());
        await ctx.db.patch("searches", search._id, { data: { ...search.data, updatedAt: now.toISOString() } });
        return;
      }
      const previous = await hydrate(ctx, search);
      const data = applySearchEdit(previous, edit, now.toISOString());
      validateSearch(data);
      if (JSON.stringify({ ...data, updatedAt: previous.updatedAt }) === JSON.stringify(previous)) return;
      if (JSON.stringify(data.screeningResponses) !== JSON.stringify(previous.screeningResponses)) {
        await replaceAnswers(ctx, userId, search._id, data.screeningResponses, answerSource(author), now.getTime());
      }
      const next = { ...search, data: { ...data, screeningResponses: [] }, revision: search.revision + 1 };
      await ctx.db.patch("searches", search._id, { data: next.data, revision: next.revision });
      await revision(ctx, next, author);
      return;
    }
    case "deleteSearch": {
      const search = await findSearch(ctx, userId, command.id);
      if (!search) return;
      await moveSearchAnswers(ctx, search._id, userId);
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

export const change = mutation({
  args: { ...accountArgs, requestId: v.string(), command: commandValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    const key = `change:${args.requestId}`;
    if (await received(ctx, userId, key)) return null;
    await applyCommand(ctx, userId, args.command, "user");
    await ctx.db.insert("researchReceipts", { userId, key });
    return null;
  },
});

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
