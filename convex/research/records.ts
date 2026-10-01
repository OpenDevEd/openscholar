import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { accountMutation, accountQuery, assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, type Author } from "../lib/userActions";
import { answersAtVersions, clearPaperAnswers, currentAnswers, replaceAnswers, screeningFor, setPaperAnswers, type AnswerSource } from "./answers";
import {
  applySearchEdit, commandValidator, currentSearch, historyArrays, historySummary, ratingValidator, searchValidator, shortcutValidator,
  type ResearchCommand, type SavedSearch, type StoredSearch,
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
    const page = await ctx.db.query("searchRevisions").withIndex("by_search_and_revision", q => q.eq("searchId", search._id)).order("desc")
      // Revisions saved before #354 hold their search's whole history; a page of them stops at
      // this many bytes and goes on from its cursor.
      .paginate({ ...args.paginationOpts, maximumBytesRead: REVISION_PAGE_BYTES });
    const data = await hydrateRevisions(ctx, search._id, page.page);
    return { ...page, page: page.page.map((row, i) => ({ revision: row.revision, author: row.author, data: data[i], deleted: row.deleted, createdAt: row.createdAt })) };
  },
});
/** Bytes one page of revisions reads at most, leaving room for their answers. */
const REVISION_PAGE_BYTES = 8 * 2 ** 20;
export const revisions = accountQuery(revisionsAction);
export const revisionsForAssistant = assistantQuery(revisionsAction);

const historyKind = v.union(v.literal("query"), v.literal("question"));
const historyEntryValidator = v.object({ text: v.string(), field: v.optional(searchValidator.fields.field), timestamp: v.string() });

export const searchHistoryAction = defineUserQuery({
  path: "research/records:searchHistory",
  description: "Lists a saved search's earlier queries, or its research questions, newest first, a page at a time.",
  args: { ...pageArgs, id: v.string(), kind: historyKind },
  returns: paginationResultValidator(historyEntryValidator),
  run: async (ctx, userId, args) => {
    const search = await findSearch(ctx, userId, args.id);
    if (!search) return { page: [], isDone: true, continueCursor: "" };
    // A search not moved yet still holds its history: all of it, as one page.
    const legacy = args.kind === "query" ? search.data.queryHistory : search.data.questionHistory;
    if (legacy) {
      const entries = legacy.map((entry) => ("query" in entry ? { text: entry.query, field: entry.field, timestamp: entry.timestamp } : { text: entry.question, timestamp: entry.timestamp }));
      return { page: entries.reverse(), isDone: true, continueCursor: "" };
    }
    const page = await ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", q => q.eq("searchId", search._id).eq("kind", args.kind)).order("desc")
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, HISTORY_PAGE_MAX) });
    return { ...page, page: page.page.map(({ text, field, timestamp }) => ({ text, ...(field ? { field } : {}), timestamp })) };
  },
});
export const searchHistory = accountQuery(searchHistoryAction);
export const searchHistoryForAssistant = assistantQuery(searchHistoryAction);

export const searchHistoryEntryAction = defineUserQuery({
  path: "research/records:searchHistoryEntry",
  description: "Reads one of a saved search's earlier queries, or research questions, a number of steps before the newest.",
  args: { id: v.string(), kind: historyKind, stepsBack: v.number(), cursor: v.optional(v.string()) },
  // Either the entry (null when there's none that far back), or where to go on from after
  // skipping as many entries as one read allows.
  returns: v.union(v.object({ entry: v.union(historyEntryValidator, v.null()) }), v.object({ skipped: v.number(), cursor: v.string() })),
  run: async (ctx, userId, args) => {
    const search = await findSearch(ctx, userId, args.id);
    if (!search || !Number.isInteger(args.stepsBack) || args.stepsBack < 0) return { entry: null };
    const legacy = args.kind === "query" ? search.data.queryHistory : search.data.questionHistory;
    if (legacy) {
      const entry = legacy[legacy.length - 1 - args.stepsBack];
      return { entry: entry ? ("query" in entry ? { text: entry.query, ...(entry.field ? { field: entry.field } : {}), timestamp: entry.timestamp } : { text: entry.question, timestamp: entry.timestamp }) : null };
    }
    const page = await ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", q => q.eq("searchId", search._id).eq("kind", args.kind)).order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.stepsBack + 1, maximumRowsRead: HISTORY_SKIP_ROWS, maximumBytesRead: HISTORY_SKIP_BYTES });
    const row = page.page[args.stepsBack];
    if (row) return { entry: { text: row.text, ...(row.field ? { field: row.field } : {}), timestamp: row.timestamp } };
    return page.isDone ? { entry: null } : { skipped: page.page.length, cursor: page.continueCursor };
  },
});
export const searchHistoryEntry = accountQuery(searchHistoryEntryAction);
export const searchHistoryEntryForAssistant = assistantQuery(searchHistoryEntryAction);

/** Most rows and bytes one read skips on the way to an entry far back in a history. */
const HISTORY_SKIP_ROWS = 10_000;
const HISTORY_SKIP_BYTES = 8 * 2 ** 20;

/** Most history entries one page returns: about 2 MB of the longest saved OQL queries. */
const HISTORY_PAGE_MAX = 100;

/**
 * Appends entries to a search's history, reading its last position once.
 *
 * ponytail: one transaction writes at most 16,000 rows, so a search with more entries than
 * that can't move or be imported; none on shared dev comes near.
 */
async function addHistory(ctx: MutationCtx, search: Pick<Doc<"searches">, "_id" | "userId">, kind: "query" | "question", entries: Array<{ text: string; field?: SavedSearch["field"]; timestamp: string }>) {
  if (!entries.length) return;
  const last = await ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", q => q.eq("searchId", search._id).eq("kind", kind)).order("desc").first();
  let position = last?.position ?? -1;
  for (const entry of entries) await ctx.db.insert("searchHistory", { userId: search.userId, searchId: search._id, kind, ...entry, position: ++position });
}

const queryEntry = (entry: { query: string; field?: SavedSearch["field"]; timestamp: string }) => ({ text: entry.query, ...(entry.field ? { field: entry.field } : {}), timestamp: entry.timestamp });
const questionEntry = (entry: { question: string; timestamp: string }) => ({ text: entry.question, timestamp: entry.timestamp });

/**
 * Moves a search's history arrays into searchHistory rows and keeps only their summary on
 * the search (#354). Every search saved before #354 holds the arrays, and moving removes
 * them, so a search moves once. Safe to run again.
 */
export async function moveSearchHistory(ctx: MutationCtx, searchId: Id<"searches">) {
  const search = await ctx.db.get("searches", searchId);
  if (!search || (!search.data.queryHistory && !search.data.questionHistory)) return false;
  await addHistory(ctx, search, "query", (search.data.queryHistory ?? []).map(queryEntry));
  await addHistory(ctx, search, "question", (search.data.questionHistory ?? []).map(questionEntry));
  const { queryHistory: _queries, questionHistory: _questions, ...data } = search.data;
  await ctx.db.patch("searches", search._id, { data: { ...data, ...historySummary(search.data.queryHistory ?? [], search.data.questionHistory ?? []) } });
  return true;
}

/**
 * Most history entries a copy replaces or copies, per kind: with the longest saved OQL
 * queries, about 6 MB read from each search and 6 MB written.
 *
 * ponytail: a copy to or from a search with more fails by name, and changes nothing; copy
 * in batches if one ever needs to.
 */
const COPY_HISTORY_MAX = 300;

/**
 * Replaces `search`'s history with the history of the user's search `fromId`, as it was at
 * `fromUpdatedAt`; returns its summary.
 */
async function copyHistory(ctx: MutationCtx, userId: Id<"users">, search: Doc<"searches">, fromId: string, fromUpdatedAt: string) {
  const found = await findSearch(ctx, userId, fromId);
  if (!found) throw new Error("Search not found.");
  await moveSearchHistory(ctx, found._id);
  const from = (await ctx.db.get("searches", found._id))!;
  if (from.data.updatedAt !== fromUpdatedAt) throw new Error("That search changed. Choose it again.");
  const { queryHistoryCount, questionCount, latestQuestion, questionText } = currentSearch(from.data);
  // A search given its own history keeps it.
  if (from._id === search._id) return { queryHistoryCount, questionCount, latestQuestion, questionText };
  for (const kind of ["query", "question"] as const) {
    const range = (id: Id<"searches">) => ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", q => q.eq("searchId", id).eq("kind", kind));
    const replaced = await range(search._id).take(COPY_HISTORY_MAX + 1);
    const rows = await range(from._id).take(COPY_HISTORY_MAX + 1);
    if (replaced.length > COPY_HISTORY_MAX) throw new Error(`This search has more than ${COPY_HISTORY_MAX} ${kind} history entries to replace.`);
    if (rows.length > COPY_HISTORY_MAX) throw new Error(`Search ${fromId} has more than ${COPY_HISTORY_MAX} ${kind} history entries to copy.`);
    for (const row of replaced) await ctx.db.delete("searchHistory", row._id);
    for (const { text, field, timestamp, position } of rows) await ctx.db.insert("searchHistory", { userId, searchId: search._id, kind, text, ...(field ? { field } : {}), timestamp, position });
  }
  return { queryHistoryCount, questionCount, latestQuestion, questionText };
}

function findSearch(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, localId: string) {
  return ctx.db.query("searches").withIndex("by_user_and_localId", q => q.eq("userId", userId).eq("localId", localId)).unique();
}

type RevisionRow = Pick<Doc<"searchRevisions">, "data" | "responseChunks" | "answersVersion">;

/** A search with its current screening answers. */
async function hydrate(ctx: Pick<QueryCtx, "db">, row: Pick<Doc<"searches">, "_id" | "data" | "responseChunks">): Promise<SavedSearch> {
  const screening = await screeningFor(ctx, row._id);
  return { ...currentSearch(row.data), screeningResponses: screening ? await currentAnswers(ctx, screening._id) : await legacyResponses(ctx, row) };
}

/** Revisions of one search, each with the answers at the screening version it saw. */
async function hydrateRevisions(ctx: Pick<QueryCtx, "db">, searchId: Id<"searches">, rows: RevisionRow[]): Promise<SavedSearch[]> {
  const versions = rows.flatMap(row => (row.answersVersion === undefined ? [] : [row.answersVersion]));
  const screening = versions.length ? await screeningFor(ctx, searchId) : null;
  const answers = screening ? await answersAtVersions(ctx, screening._id, versions) : new Map();
  return Promise.all(rows.map(async row => ({ ...currentSearch(row.data), screeningResponses: row.answersVersion === undefined || !screening ? await legacyResponses(ctx, row) : answers.get(row.answersVersion)! })));
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
      // The history it starts with: what came with it, or else its first query.
      const queries = command.history?.queryHistory.length ? command.history.queryHistory : [{ query: command.search.query, field: command.search.field, timestamp: command.search.createdAt }];
      const questions = command.history?.questionHistory ?? [];
      const id = await ctx.db.insert("searches", { userId, localId: command.search.id, data: { ...command.search, ...historySummary(queries, questions), screeningResponses: [] }, revision: 1 });
      await addHistory(ctx, { _id: id, userId }, "query", queries.map(queryEntry));
      await addHistory(ctx, { _id: id, userId }, "question", questions.map(questionEntry));
      // Answers carried in a new search come from an import or the assistant; neither says who gave them.
      await replaceAnswers(ctx, userId, id, command.search.screeningResponses, author === "assistant" ? "assistant" : "unrecorded", Date.now());
      await revision(ctx, (await ctx.db.get("searches", id))!, author);
      return;
    }
    case "editSearch": {
      const found = await findSearch(ctx, userId, command.id);
      if (!found) throw new Error("Search not found.");
      // A search still on chunks moves first, so every revision keeps its answers, and one
      // still holding its history moves that, so the history is only ever in its rows.
      await moveSearchAnswers(ctx, found._id, userId);
      const search = (await moveSearchHistory(ctx, found._id)) ? (await ctx.db.get("searches", found._id))! : found;
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
      const data = edit.kind === "copySearch"
        ? { ...applySearchEdit(previous, edit, now.toISOString()), ...(await copyHistory(ctx, userId, search, edit.from, edit.fromUpdatedAt)) }
        : applySearchEdit(previous, edit, now.toISOString());
      validateSearch(data);
      // A copy may change only the history rows, so it always makes a revision.
      if (edit.kind !== "copySearch" && JSON.stringify({ ...data, updatedAt: previous.updatedAt }) === JSON.stringify(previous)) return;
      if (JSON.stringify(data.screeningResponses) !== JSON.stringify(previous.screeningResponses)) {
        await replaceAnswers(ctx, userId, search._id, data.screeningResponses, answerSource(author), now.getTime());
      }
      const next = { ...search, data: { ...data, screeningResponses: [] }, revision: search.revision + 1 };
      await ctx.db.patch("searches", search._id, { data: next.data, revision: next.revision });
      if (edit.kind === "query") await addHistory(ctx, search, "query", [{ text: edit.query, field: edit.field, timestamp: data.updatedAt }]);
      if (edit.kind === "question") await addHistory(ctx, search, "question", [{ text: edit.question, timestamp: data.updatedAt }]);
      if (edit.kind === "removeQueryHistoryEntry") {
        const entry = await ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_timestamp", q => q.eq("searchId", search._id).eq("kind", "query").eq("timestamp", edit.timestamp))
          .filter(q => q.and(q.eq(q.field("text"), edit.query), q.eq(q.field("field"), edit.field))).first();
        if (!entry) throw new Error("History entry not found.");
        await ctx.db.delete("searchHistory", entry._id);
      }
      await revision(ctx, next, author);
      return;
    }
    case "deleteSearch": {
      const found = await findSearch(ctx, userId, command.id);
      if (!found) return;
      await moveSearchAnswers(ctx, found._id, userId);
      // Its history stays in its rows, with the revisions, after the search is gone.
      const search = (await moveSearchHistory(ctx, found._id)) ? (await ctx.db.get("searches", found._id))! : found;
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
  // Each search comes with the history this browser kept of it.
  args: { ...accountArgs, searches: v.array(v.object({ search: searchValidator, history: v.optional(v.object(historyArrays)) })), shortcuts: v.array(shortcutValidator), ratings: v.array(ratingValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await account(ctx, args.accountId);
    if (args.searches.length + args.shortcuts.length + args.ratings.length > 25) throw new Error("Import at most 25 records per batch.");
    const items: Array<{ key: string; command: ResearchCommand }> = [
      ...args.searches.map(({ search, history }) => ({ key: `search:${search.id}`, command: { kind: "createSearch" as const, search, ...(history ? { history } : {}) } })),
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
