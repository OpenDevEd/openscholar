import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { accountMutation, accountQuery, assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, type Author } from "../lib/userActions";
import { answersAmong, clearPaperAnswers, removeAnswers, screeningFor, seedAnswers, setPaperAnswers, sweepAnswers, type AnswerSource } from "./answers";
import {
  ANSWERED_PAPERS_MAX, applySearchEdit, commandValidator, currentSearch, historyArrays, historySummary, listedSearchValidator, listedSortValidator, paperResponsesValidator, RATED_PAPERS_MAX, ratingValidator, restoredSearch, searchValidator, SHORTCUT_NAMES_MAX, shortcutSortValidator, shortcutValidator,
  type ResearchCommand, type SavedSearch, type StoredSearch,
} from "../../lib/research/records";
import { stream } from "convex-helpers/server/stream";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import schema from "../schema";
import { countRecordPage, countRow } from "./recordCounts";
import { shortcutSortName } from "../../lib/query-shortcuts";

const accountArgs = { accountId: v.string() };
const pageArgs = { paginationOpts: paginationOptsValidator };
async function account(ctx: Parameters<typeof requireAuth>[0], expected: string) {
  const user = await requireAuth(ctx);
  if (user.clerkId !== expected) throw new Error("Account changed. Retry after signing in.");
  return user._id;
}

// Each action is defined once; the page's function and the assistant's are made from it.

/** Most searches one listed page holds. */
const LISTED_PAGE_MAX = 50;
/**
 * Searches a text-filtered read looks through, and bytes any listed read takes, at most. A
 * page that stops there comes back short with a cursor, and the list reads on from it.
 */
const FILTER_ROWS = 1_000;
const LISTED_BYTES = 8 * 1024 * 1024;

export const listedSearchesAction = defineUserQuery({
  path: "research/records:listedSearches",
  description:
    "Lists the person's saved searches without their screening answers, a page at a time: newest, oldest, most or fewest results first. Given `text`, only those whose query or questions contain it; given `exclude`, all but the search with that ID. A page can come back short without being the last.",
  args: { ...pageArgs, sort: listedSortValidator, text: v.optional(v.string()), exclude: v.optional(v.string()) },
  returns: paginationResultValidator(listedSearchValidator),
  run: async (ctx, userId, { paginationOpts, sort, text, exclude }) => {
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LISTED_PAGE_MAX) };
    const index = sort === "most" || sort === "least" ? "by_user_and_count" : "by_user_and_createdAt";
    const order = sort === "oldest" || sort === "least" ? "asc" : "desc";
    const needle = text?.trim().toLowerCase();
    const page = await (needle || exclude !== undefined
      ? stream(ctx.db, schema).query("searches").withIndex(index, q => q.eq("userId", userId)).order(order)
          .filterWith(async row => {
            if (row.localId === exclude) return false;
            if (!needle) return true;
            const search = currentSearch(row.data);
            return search.query.toLowerCase().includes(needle) || search.questionText.toLowerCase().includes(needle);
          })
          .paginate({ ...opts, maximumRowsRead: FILTER_ROWS, maximumBytesRead: LISTED_BYTES })
      : ctx.db.query("searches").withIndex(index, q => q.eq("userId", userId)).order(order).paginate({ ...opts, maximumBytesRead: LISTED_BYTES }));
    return { ...page, page: page.page.map(row => { const { screeningResponses: _answers, ...listed } = currentSearch(row.data); return listed; }) };
  },
});
export const listedSearches = accountQuery(listedSearchesAction);
export const listedSearchesForAssistant = assistantQuery(listedSearchesAction);

export const countSearchesAction = defineUserQuery({
  path: "research/records:countSearches",
  description: "Says how many saved searches the person has.",
  args: {},
  returns: v.number(),
  // Someone who has saved nothing has no count; one from before counts were kept gets theirs from migrations/pagedRecords.
  run: async (ctx, userId) => (await countRow(ctx, "searches", userId))?.count ?? 0,
});
export const countSearches = accountQuery(countSearchesAction);
export const countSearchesForAssistant = assistantQuery(countSearchesAction);

/** One step of a person's first count of their searches, shortcuts or screening jobs (./recordCounts.ts). */
export const countRecordsPage = internalMutation({
  args: { table: v.union(v.literal("searches"), v.literal("queryShortcuts"), v.literal("screeningJobs"), v.literal("extractionJobs")), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { table, userId }) => {
    await countRecordPage(ctx, table, userId);
    return null;
  },
});

/** Most shortcuts one listed page holds. */
const SHORTCUT_PAGE_MAX = 50;

export const listedShortcutsAction = defineUserQuery({
  path: "research/records:listedShortcuts",
  description:
    "Lists the person's query shortcuts (the Bookmarks page), each a short name that expands to a longer query, a page at a time: newest or oldest first, or by name. Given `text`, only those whose name or expansion contain it. A page can come back short without being the last.",
  args: { ...pageArgs, sort: shortcutSortValidator, text: v.optional(v.string()) },
  returns: paginationResultValidator(shortcutValidator),
  run: async (ctx, userId, { paginationOpts, sort, text }) => {
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, SHORTCUT_PAGE_MAX), maximumBytesRead: LISTED_BYTES };
    const index = sort === "alpha" || sort === "alpha-desc" ? "by_user_and_sortName" : "by_user_and_createdAt";
    const order = sort === "oldest" || sort === "alpha" ? "asc" : "desc";
    const needle = text?.trim().toLowerCase();
    const page = await (needle
      ? stream(ctx.db, schema).query("queryShortcuts").withIndex(index, q => q.eq("userId", userId)).order(order)
          .filterWith(async row => row.data.shorthand.toLowerCase().includes(needle) || row.data.expansion.toLowerCase().includes(needle))
          .paginate({ ...opts, maximumRowsRead: FILTER_ROWS })
      : ctx.db.query("queryShortcuts").withIndex(index, q => q.eq("userId", userId)).order(order).paginate(opts));
    return { ...page, page: page.page.map(row => row.data) };
  },
});
export const listedShortcuts = accountQuery(listedShortcutsAction);
export const listedShortcutsForAssistant = assistantQuery(listedShortcutsAction);

export const countShortcutsAction = defineUserQuery({
  path: "research/records:countShortcuts",
  description: "Says how many query shortcuts the person has.",
  args: {},
  returns: v.number(),
  run: async (ctx, userId) => (await countRow(ctx, "queryShortcuts", userId))?.count ?? 0,
});
export const countShortcuts = accountQuery(countShortcutsAction);
export const countShortcutsForAssistant = assistantQuery(countShortcutsAction);

/** The person's shortcuts among `names`. */
async function shortcutsAmong(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, names: string[]) {
  const rows = await Promise.all(
    names.map(name => ctx.db.query("queryShortcuts").withIndex("by_user_and_shorthand", q => q.eq("userId", userId).eq("data.shorthand", name)).first()),
  );
  return rows.flatMap(row => (row ? [row.data] : []));
}

/** The expansions of the person's shortcuts among `names`, by name, for `expandShortcuts`. */
export async function shortcutExpansions(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, names: string[]) {
  return Object.fromEntries((await shortcutsAmong(ctx, userId, names)).map(shortcut => [shortcut.shorthand, shortcut.expansion]));
}

export const shortcutsOfAction = defineUserQuery({
  path: "research/records:shortcutsOf",
  description: `Reads the person's shortcuts with these names, at most ${SHORTCUT_NAMES_MAX} of them, as one page; a name they haven't saved is left out.`,
  args: { names: v.array(v.string()) },
  returns: paginationResultValidator(shortcutValidator),
  run: async (ctx, userId, { names }) => {
    if (names.length > SHORTCUT_NAMES_MAX) throw new Error(`Shortcuts are read ${SHORTCUT_NAMES_MAX} names at a time.`);
    return { page: await shortcutsAmong(ctx, userId, names), isDone: true, continueCursor: "" };
  },
});
export const shortcutsOf = accountQuery(shortcutsOfAction);
export const shortcutsOfForAssistant = assistantQuery(shortcutsOfAction);

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

/** The person's ratings among `paperIds`. */
export async function ratingsAmong(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperIds: string[]) {
  const rows = await Promise.all(
    paperIds.map(paperId => ctx.db.query("paperRatings").withIndex("by_user_and_paperId", q => q.eq("userId", userId).eq("data.paperId", paperId)).first()),
  );
  return rows.flatMap(row => (row ? [row.data] : []));
}

export const ratingsOfAction = defineUserQuery({
  path: "research/records:ratingsOf",
  description: `Reads the person's ratings of the papers with these IDs, at most ${RATED_PAPERS_MAX} of them, as one page; a paper they haven't rated is left out.`,
  args: { paperIds: v.array(v.string()) },
  returns: paginationResultValidator(ratingValidator),
  run: async (ctx, userId, { paperIds }) => {
    if (paperIds.length > RATED_PAPERS_MAX) throw new Error(`Ratings are read ${RATED_PAPERS_MAX} papers at a time.`);
    return { page: await ratingsAmong(ctx, userId, paperIds), isDone: true, continueCursor: "" };
  },
});
export const ratingsOf = accountQuery(ratingsOfAction);
export const ratingsOfForAssistant = assistantQuery(ratingsOfAction);

/** A search as its page reads it: everything but its screening answers, which `answersOf` reads for the papers on screen. */
const listed = (search: SavedSearch) => { const { screeningResponses: _answers, ...fields } = search; return fields; };

export const getSearchAction = defineUserQuery({
  path: "research/records:getSearch",
  description: "Reads one saved search by ID: its query, filters, sort, page and screening questions. Its screening answers are read by paper with answersOf.",
  args: { id: v.string() },
  returns: v.union(listedSearchValidator, v.null()),
  run: async (ctx, userId, args) => {
    const search = await findSearch(ctx, userId, args.id);
    return search ? listed(currentSearch(search.data)) : null;
  },
});
export const getSearch = accountQuery(getSearchAction);
export const getSearchForAssistant = assistantQuery(getSearchAction);

export const answersOfAction = defineUserQuery({
  path: "research/records:answersOf",
  description: `Reads a saved search's screening answers for the papers with these IDs, at most ${ANSWERED_PAPERS_MAX} of them, as one page; a paper with no answers is left out. Given \`version\`, the answers as they were at that screening version, which a revision of the search names.`,
  args: { id: v.string(), paperIds: v.array(v.string()), version: v.optional(v.number()) },
  returns: paginationResultValidator(paperResponsesValidator),
  run: async (ctx, userId, { id, paperIds, version }) => {
    if (paperIds.length > ANSWERED_PAPERS_MAX) throw new Error(`Answers are read ${ANSWERED_PAPERS_MAX} papers at a time.`);
    const search = await findSearch(ctx, userId, id);
    const screening = search && (await screeningFor(ctx, search._id));
    return { page: screening ? await answersAmong(ctx, screening, paperIds, version) : [], isDone: true, continueCursor: "" };
  },
});
export const answersOf = accountQuery(answersOfAction);
export const answersOfForAssistant = assistantQuery(answersOfAction);

export const revisionsAction = defineUserQuery({
  path: "research/records:revisions",
  description: "Lists a saved search's earlier versions, newest first, each marked as made by the person or by the assistant. Each names the screening version its answers stood at, which answersOf reads by paper.",
  args: { ...pageArgs, id: v.string() },
  returns: paginationResultValidator(v.object({ revision: v.number(), author: v.union(v.literal("user"), v.literal("assistant")), data: listedSearchValidator, answersVersion: v.optional(v.number()), deleted: v.boolean(), createdAt: v.number() })),
  run: async (ctx, userId, args) => {
    const search = await findSearch(ctx, userId, args.id);
    if (!search) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db.query("searchRevisions").withIndex("by_search_and_revision", q => q.eq("searchId", search._id)).order("desc")
      // Revisions saved before #354 hold their search's whole history; a page of them stops at
      // this many bytes and goes on from its cursor.
      .paginate({ ...args.paginationOpts, maximumBytesRead: REVISION_PAGE_BYTES });
    return { ...page, page: page.page.map(row => ({ revision: row.revision, author: row.author, data: listed(currentSearch(row.data)), ...(row.answersVersion === undefined ? {} : { answersVersion: row.answersVersion }), deleted: row.deleted, createdAt: row.createdAt })) };
  },
});
/** Bytes one page of revisions reads at most. */
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

/** One revision of a search, if it was kept. */
function revisionRow(ctx: Pick<QueryCtx, "db">, searchId: Id<"searches">, number: number) {
  return ctx.db.query("searchRevisions").withIndex("by_search_and_revision", q => q.eq("searchId", searchId).eq("revision", number)).unique();
}

/**
 * Applies one change, in the caller's transaction, for the person it's made for. Returns the
 * command that reverses it (#342), when it changed something that can be put back: making a
 * search, changing its query or filters, a shortcut, a rating. Deleting, clearing, and
 * changes to questions and answers return none.
 */
export async function applyCommand(ctx: MutationCtx, userId: Id<"users">, command: ResearchCommand, author: Author): Promise<ResearchCommand | undefined> {
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
      await seedAnswers(ctx, userId, id, command.search.screeningResponses, author === "assistant" ? "assistant" : "unrecorded", Date.now());
      await revision(ctx, (await ctx.db.get("searches", id))!, author);
      return { kind: "deleteSearch", id: command.search.id };
    }
    case "editSearch": {
      const found = await findSearch(ctx, userId, command.id);
      if (!found) throw new Error("Search not found.");
      // A search still holding its history moves it first, so the history is only ever in its rows.
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
      // The search's own fields; its answers live in their rows and change only through the edits below.
      const previous: SavedSearch = { ...currentSearch(search.data), screeningResponses: [] };
      let data: SavedSearch;
      if (edit.kind === "restore") {
        if (edit.expect !== undefined && search.revision !== edit.expect) throw createError("CONFLICT", "This search has changed since then, so it was left as it is.");
        const then = await revisionRow(ctx, search._id, edit.revision);
        if (!then || then.deleted) throw createError("NOT_FOUND", "That version of the search wasn't kept.");
        data = restoredSearch(previous, currentSearch(then.data), now.toISOString());
      } else if (edit.kind === "copySearch") {
        data = { ...applySearchEdit(previous, edit, now.toISOString()), ...(await copyHistory(ctx, userId, search, edit.from, edit.fromUpdatedAt)) };
      } else data = applySearchEdit(previous, edit, now.toISOString());
      validateSearch(data);
      // An edit that takes answers from every paper: all of them, or those to one question.
      const removes = edit.kind === "clearResponses" || edit.kind === "clearScreeningQuestions" ? { all: true as const }
        : edit.kind === "removeQuestionResponses" || edit.kind === "replaceScreeningQuestion" ? { question: edit.question } : null;
      const screening = removes && (await screeningFor(ctx, search._id));
      const next = { ...search, data: { ...data, screeningResponses: [] }, revision: search.revision + 1 };
      let answersChanged = false;
      if (removes && screening) {
        // The first papers go with the edit; a screening with more is swept on in the background.
        const removed = await removeAnswers(ctx, screening, "question" in removes ? removes.question : undefined, now.getTime());
        answersChanged = removed.changed;
        if (removed.cursor !== null) await ctx.scheduler.runAfter(0, internal.research.records.sweepAnswersBatch, { screeningId: screening._id, through: removed.through, cursor: removed.cursor });
      }
      // A copy may change only the history rows, so it always makes a revision.
      if (edit.kind !== "copySearch" && !answersChanged && JSON.stringify({ ...data, updatedAt: previous.updatedAt }) === JSON.stringify(previous)) return;
      await ctx.db.patch("searches", search._id, { data: next.data, revision: next.revision });
      if (edit.kind === "query") await addHistory(ctx, search, "query", [{ text: edit.query, field: edit.field, timestamp: data.updatedAt }]);
      // Going back to an earlier query is one more query the search has had.
      if (edit.kind === "restore" && data.queryHistoryCount > previous.queryHistoryCount) await addHistory(ctx, search, "query", [{ text: data.query, field: data.field, timestamp: data.updatedAt }]);
      if (edit.kind === "question") await addHistory(ctx, search, "question", [{ text: edit.question, timestamp: data.updatedAt }]);
      if (edit.kind === "removeQueryHistoryEntry") {
        const entry = await ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_timestamp", q => q.eq("searchId", search._id).eq("kind", "query").eq("timestamp", edit.timestamp))
          .filter(q => q.and(q.eq(q.field("text"), edit.query), q.eq(q.field("field"), edit.field))).first();
        if (!entry) throw new Error("History entry not found.");
        await ctx.db.delete("searchHistory", entry._id);
      }
      await revision(ctx, next, author);
      // A change to the query or the filters is reversed by restoring the revision before it,
      // when that revision was kept and restoring it would bring something back.
      const reversible = edit.kind === "patch" || edit.kind === "query" || edit.kind === "restore";
      if (!reversible || !(await revisionRow(ctx, search._id, search.revision))) return;
      const back = restoredSearch(data, previous, data.updatedAt);
      if (JSON.stringify({ ...back, queryHistoryCount: data.queryHistoryCount }) === JSON.stringify(data)) return;
      return { kind: "editSearch", id: command.id, edit: { kind: "restore", revision: search.revision, expect: next.revision } };
    }
    case "deleteSearch": {
      const found = await findSearch(ctx, userId, command.id);
      if (!found) return;
      // Its history stays in its rows, with the revisions, after the search is gone.
      const search = (await moveSearchHistory(ctx, found._id)) ? (await ctx.db.get("searches", found._id))! : found;
      await revision(ctx, { ...search, revision: search.revision + 1 }, author, true);
      await ctx.db.delete("searches", search._id);
      return;
    }
    case "shortcut": {
      if (!command.shorthand.trim()) throw new Error("Bookmark name is required.");
      const row = await ctx.db.query("queryShortcuts").withIndex("by_user_and_shorthand", q => q.eq("userId", userId).eq("data.shorthand", command.shorthand)).unique();
      if (command.expect !== undefined && (row?.data.expansion ?? null) !== command.expect) throw createError("CONFLICT", "This shortcut has changed since then, so it was left as it is.");
      // What puts it back: the shortcut as it was, or none, as long as it's still what this change made it.
      const undo: ResearchCommand = { kind: "shortcut", shorthand: command.shorthand, value: row ? { expansion: row.data.expansion, createdAt: row.data.createdAt } : null, expect: command.value?.expansion ?? null };
      if (command.value === null) { if (row) await ctx.db.delete("queryShortcuts", row._id); return row ? undo : undefined; }
      const data = { shorthand: command.shorthand, ...command.value };
      if (row) await ctx.db.patch("queryShortcuts", row._id, { data });
      else await ctx.db.insert("queryShortcuts", { userId, data, sortName: shortcutSortName(command.shorthand) });
      return undo;
    }
    // A clear takes the rows up to the newest there is now. A clock can't draw that line:
    // a row made a moment earlier or later can carry the same millisecond.
    case "clearSearches": {
      const newest = await ctx.db.query("searches").withIndex("by_user", q => q.eq("userId", userId)).order("desc").first();
      if (newest) await clearBatch(ctx, userId, author, newest._creationTime);
      return;
    }
    case "clearShortcuts": {
      const newest = await ctx.db.query("queryShortcuts").withIndex("by_user", q => q.eq("userId", userId)).order("desc").first();
      if (newest) await clearShortcutBatch(ctx, userId, newest._creationTime);
      return;
    }
    case "rating": {
      if (!command.paperId || (command.rating !== null && (!Number.isInteger(command.rating) || command.rating < 0 || command.rating > 5))) throw new Error("Rating must be an integer from 0 to 5.");
      const row = await ctx.db.query("paperRatings").withIndex("by_user_and_paperId", q => q.eq("userId", userId).eq("data.paperId", command.paperId)).unique();
      if (command.expect !== undefined && (row?.data.rating ?? null) !== command.expect) throw createError("CONFLICT", "This rating has changed since then, so it was left as it is.");
      const undo: ResearchCommand = { kind: "rating", paperId: command.paperId, rating: row?.data.rating ?? null, expect: command.rating };
      if (command.rating === null) { if (row) await ctx.db.delete("paperRatings", row._id); return row ? undo : undefined; }
      const data = { paperId: command.paperId, rating: command.rating };
      if (row) await ctx.db.patch("paperRatings", row._id, { data });
      else await ctx.db.insert("paperRatings", { userId, data });
      return undo;
    }
  }
}

async function received(ctx: MutationCtx, userId: Id<"users">, key: string) {
  return await ctx.db.query("researchReceipts").withIndex("by_user_and_key", q => q.eq("userId", userId).eq("key", key)).unique();
}

export const changeAction = defineUserMutation({
  path: "research/records:change",
  description:
    "Changes the person's research records: create, edit or delete a saved search, set or remove a query shortcut, rate a paper, or clear every saved search or every shortcut they have (a batch at a time; searches keep their revisions). Edits to a search show live on the person's open page and are kept as revisions. " +
    "A change that can be reversed returns `undo`: run this action with that command to put things back. It is refused if the record changed again in between. Making a search, changing its query or filters, a shortcut and a rating can be reversed; deleting, clearing, and changes to questions and answers can't.",
  args: { requestId: v.string(), command: commandValidator },
  returns: v.object({ undo: v.optional(v.object({ command: commandValidator })) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  retryKey: "requestId",
  // The receipt makes a retried request apply once, from the page or from the assistant. Its
  // undo went back with the first answer, so a retry's answer carries none.
  run: async (ctx, userId, args, author: Author) => {
    const key = `change:${args.requestId}`;
    if (await received(ctx, userId, key)) return {};
    const undo = await applyCommand(ctx, userId, args.command, author);
    await ctx.db.insert("researchReceipts", { userId, key });
    return undo ? { undo: { command: undo } } : {};
  },
});
export const change = accountMutation(changeAction);
export const changeForAssistant = assistantMutation(changeAction);

/**
 * Searches one clearing transaction deletes, each leaving a revision, and the bytes of them
 * it reads: deleting a search reads it a few times over and writes it once more.
 */
const CLEAR_BATCH = 25;
const CLEAR_BYTES = 2 * 1024 * 1024;

/**
 * Deletes a batch of the searches made up to `before`, the newest when they asked, and schedules
 * the next until none are left; one saved since stays. A search from before its history
 * had its own rows moves it as it goes, which can take a transaction by itself, so it's
 * deleted alone.
 */
async function clearBatch(ctx: MutationCtx, userId: Id<"users">, author: Author, before: number) {
  const batch = await ctx.db.query("searches").withIndex("by_user", q => q.eq("userId", userId).lte("_creationTime", before))
    .paginate({ cursor: null, numItems: CLEAR_BATCH, maximumBytesRead: CLEAR_BYTES });
  const old = batch.page.findIndex(search => search.data.queryHistory || search.data.questionHistory);
  const deleted = old === -1 ? batch.page : batch.page.slice(0, Math.max(1, old));
  for (const search of deleted) await applyCommand(ctx, userId, { kind: "deleteSearch", id: search.localId }, author);
  if (!batch.isDone || deleted.length < batch.page.length) await ctx.scheduler.runAfter(0, internal.research.records.clearSearchesBatch, { userId, author, before });
}

/** Carries on a sweep of a screening's rows for the removals they owe, a page at a time (./answers.ts). */
export const sweepAnswersBatch = internalMutation({
  args: { screeningId: v.id("screenings"), through: v.number(), cursor: v.string() },
  returns: v.null(),
  handler: async (ctx, { screeningId, through, cursor }) => {
    const screening = await ctx.db.get("screenings", screeningId);
    if (!screening) return null;
    const next = await sweepAnswers(ctx, screening, through, cursor);
    if (next.cursor !== null) await ctx.scheduler.runAfter(0, internal.research.records.sweepAnswersBatch, { screeningId, through, cursor: next.cursor });
    return null;
  },
});

/** Shortcuts one clearing transaction deletes, and the bytes of them it reads. */
const CLEAR_SHORTCUTS = 100;

/** Deletes a batch of the shortcuts made up to `before`, the newest when they asked, and schedules the next until none are left. */
async function clearShortcutBatch(ctx: MutationCtx, userId: Id<"users">, before: number) {
  const batch = await ctx.db.query("queryShortcuts").withIndex("by_user", q => q.eq("userId", userId).lte("_creationTime", before))
    .paginate({ cursor: null, numItems: CLEAR_SHORTCUTS, maximumBytesRead: CLEAR_BYTES });
  for (const shortcut of batch.page) await ctx.db.delete("queryShortcuts", shortcut._id);
  if (!batch.isDone) await ctx.scheduler.runAfter(0, internal.research.records.clearShortcutsBatch, { userId, before });
}

export const clearShortcutsBatch = internalMutation({
  args: { userId: v.id("users"), before: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, before }) => {
    await clearShortcutBatch(ctx, userId, before);
    return null;
  },
});

export const clearSearchesBatch = internalMutation({
  args: { userId: v.id("users"), author: v.union(v.literal("user"), v.literal("assistant")), before: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, author, before }) => {
    await clearBatch(ctx, userId, author, before);
    return null;
  },
});

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
