import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { identityFromStored } from "../lib/paperRef";
import { toPaperKey } from "../../lib/papers/paper-ref";
import { removeCollectionMembership } from "../library/collectionMembership";
import { libraryCountRow } from "../library/counter";
import { freshStep, purgeScreeningJob } from "../workspaces/purge";

/**
 * Gives every saved paper, removed paper and screened or extracted paper kept before papers were
 * named by their source its identity (plans/evidence-library-sources): its key, its source and its
 * cross-references, read from the ID it was stored under, its DOI and its PDF address. A row whose
 * ID names no paper is left as it was and counted by `verify`. Then ratings move to the paper's key,
 * and undos the assistant keeps name the paper as the library's actions now take it. Safe to run again.
 *
 *   npx convex run migrations/paperIdentity:run '{"dryRun": true}'
 *   npx convex run migrations/paperIdentity:run
 *   npx convex run migrations/paperIdentity:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// A saved paper keeps its whole OpenAlex record (`paperData`): one a step.
export const papers = migrations.define({
  table: "libraryItems",
  batchSize: 1,
  migrateOne: (_ctx, item) => (item.paperKey === undefined ? identityFromStored(item) : undefined),
});

export const removals = migrations.define({
  table: "libraryRemovals",
  batchSize: 1,
  migrateOne: (_ctx, row) => {
    if (row.item.paperKey !== undefined) return;
    const identity = identityFromStored(row.item);
    return "paperKey" in identity ? { item: { ...row.item, ...identity } } : undefined;
  },
});

// Screened and extracted papers hold their abstracts.
export const screened = migrations.define({
  table: "screeningResults",
  batchSize: 20,
  migrateOne: (_ctx, result) => (result.paperKey === undefined ? identityFromStored(result) : undefined),
});

export const extracted = migrations.define({
  table: "extractionPapers",
  batchSize: 20,
  migrateOne: (_ctx, paper) => (paper.paperKey === undefined ? identityFromStored(paper) : undefined),
});

// A rating kept under a paper's OpenAlex address moves to its key. One given again since, under the key, is the person's rating now.
export const ratings = migrations.define({
  table: "ratings",
  migrateOne: async (ctx, row) => {
    const key = toPaperKey(row.paperId);
    if (!key || key === row.paperId) return;
    const since = await ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", row.userId).eq("collectionId", row.collectionId).eq("paperId", key)).unique();
    if (since) await ctx.db.delete("ratings", row._id);
    else return { paperId: key };
  },
});

// The library's actions whose arguments named a paper `openalexId`, and now name it `paper`; putting one in a collection names it inside `paper`.
const NAMED = new Set(["library/mutations:saveToLibrary", "library/mutations:removeFromLibrary", "library/mutations:setLibraryRating"]);
const IN_COLLECTION = "library/mutations:setPaperInCollection";
type Args = Record<string, unknown>;
const renamed = ({ openalexId, ...rest }: Args): Args => ({ paper: openalexId, ...rest });
const named = (args: Args) => typeof args.openalexId === "string";

/** One action's arguments with the paper named as the action now takes it, or null when they need no change. */
export function paperArgs(path: string, args: Args): Args | null {
  if (NAMED.has(path)) return named(args) ? renamed(args) : null;
  if (path !== IN_COLLECTION) return null;
  const paper = args.paper as Args | undefined;
  return paper && named(paper) ? { ...args, paper: renamed(paper) } : null;
}

/** Stored arguments, as JSON, moved by `paperArgs`; a bulk change's are a list. Undefined when nothing changes. */
function movedJson(path: string, json: string): string | undefined {
  let read: unknown;
  try {
    read = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (Array.isArray(read)) {
    const each = read.map((args: Args) => paperArgs(path, args));
    return each.some(Boolean) ? JSON.stringify(each.map((moved, at) => moved ?? read[at])) : undefined;
  }
  const moved = read && typeof read === "object" ? paperArgs(path, read as Args) : null;
  return moved ? JSON.stringify(moved) : undefined;
}

export const stepUndos = migrations.define({
  table: "assistantSteps",
  migrateOne: (_ctx, step) => {
    const undo = step.undo && movedJson(step.undo.path, step.undo.args);
    // A call still waiting for the person runs from its arguments.
    const input = step.status === "asking" || step.status === "allowed" ? movedJson(step.path, step.input) : undefined;
    if (!undo && !input) return;
    return { ...(undo ? { undo: { path: step.undo!.path, args: undo } } : {}), ...(input ? { input } : {}) };
  },
});

export const bulkUndos = migrations.define({
  table: "assistantStepUndos",
  migrateOne: (_ctx, row) => {
    const args = movedJson(row.path, row.args);
    return args ? { args } : undefined;
  },
});

export const run = migrations.runner([
  internal.migrations.paperIdentity.papers,
  internal.migrations.paperIdentity.removals,
  internal.migrations.paperIdentity.screened,
  internal.migrations.paperIdentity.extracted,
  internal.migrations.paperIdentity.ratings,
  internal.migrations.paperIdentity.stepUndos,
  internal.migrations.paperIdentity.bulkUndos,
]);

/**
 * Narrowing (1c): a row whose ID names no paper is a test fixture with a made-up ID (`verify` lists them; on shared dev
 * all belong to test accounts). It goes, with what hangs on it, so every row has a key before the key is required.
 * Then the old `openalexId` field goes from every row that has its key.
 *
 *   npx convex run migrations/paperIdentity:narrow '{"dryRun": true}'
 *   npx convex run migrations/paperIdentity:narrow
 *   npx convex run migrations/paperIdentity:verify
 */
// What one fixture paper holds at most: its collection places.
const FIXTURE_ROWS = 100;

// A saved paper goes as removing it does: out of its collections and its library's count.
export const dropUnplacedPapers = migrations.define({
  table: "libraryItems",
  batchSize: 1,
  migrateOne: async (ctx, item) => {
    if (item.paperKey !== undefined) return;
    for (const place of await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", item._id)).take(FIXTURE_ROWS)) await removeCollectionMembership(ctx, place);
    await ctx.db.delete("libraryItems", item._id);
    const counted = await libraryCountRow(ctx, item.workspaceId);
    if (counted) await ctx.db.patch("libraryCounts", counted._id, { count: Math.max(0, counted.count - 1) });
  },
});

// A removed paper's snapshot goes as it does when its undo expires, with the places it kept.
export const dropUnplacedRemovals = migrations.define({
  table: "libraryRemovals",
  batchSize: 1,
  migrateOne: async (ctx, row) => {
    if (row.item.paperKey === undefined) await ctx.scheduler.runAfter(0, internal.library.mutations.forgetRemoval, { removalId: row._id });
  },
});

export const dropUnplacedRatings = migrations.define({
  table: "ratings",
  migrateOne: async (ctx, row) => {
    if (toPaperKey(row.paperId) !== row.paperId) await ctx.db.delete("ratings", row._id);
  },
});

// A screened fixture goes with its whole job, as a purge deletes one, so no tally counts a paper the job no longer has.
export const dropUnplacedScreened = migrations.define({
  table: "screeningResults",
  batchSize: 1,
  migrateOne: async (ctx, result) => {
    if (result.paperKey !== undefined) return;
    const job = await ctx.db.get("screeningJobs", result.jobId);
    if (!job) return void (await ctx.db.delete("screeningResults", result._id));
    if (!(await purgeScreeningJob(ctx, freshStep(), job))) throw new Error(`Screening job ${job._id} is too large to delete in one step.`);
  },
});

// An extracted fixture goes with its whole job, as deleting an extraction does, queue, errors and tallies with it.
export const dropUnplacedExtracted = migrations.define({
  table: "extractionPapers",
  batchSize: 20,
  migrateOne: async (ctx, paper) => {
    if (paper.paperKey === undefined) await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.admin.deleteExtractionInternal, { jobId: paper.jobId });
  },
});

export const forgetPaperIds = migrations.define({
  table: "libraryItems",
  batchSize: 1,
  migrateOne: (_ctx, item) => (item.openalexId !== undefined ? { openalexId: undefined } : undefined),
});

export const forgetRemovedIds = migrations.define({
  table: "libraryRemovals",
  batchSize: 1,
  migrateOne: (_ctx, row) => {
    // One without a key keeps its only ID until dropUnplacedRemovals' deletion takes it.
    if (row.item.openalexId === undefined || row.item.paperKey === undefined) return;
    const { openalexId: _gone, ...item } = row.item;
    return { item };
  },
});

export const forgetScreenedIds = migrations.define({
  table: "screeningResults",
  batchSize: 20,
  migrateOne: (_ctx, result) => (result.openalexId !== undefined ? { openalexId: undefined } : undefined),
});

export const forgetExtractedIds = migrations.define({
  table: "extractionPapers",
  batchSize: 20,
  migrateOne: (_ctx, paper) => (paper.openalexId !== undefined && paper.paperKey !== undefined ? { openalexId: undefined } : undefined),
});

export const narrow = migrations.runner([
  internal.migrations.paperIdentity.dropUnplacedPapers,
  internal.migrations.paperIdentity.dropUnplacedRemovals,
  internal.migrations.paperIdentity.dropUnplacedRatings,
  internal.migrations.paperIdentity.dropUnplacedScreened,
  internal.migrations.paperIdentity.dropUnplacedExtracted,
  internal.migrations.paperIdentity.forgetPaperIds,
  internal.migrations.paperIdentity.forgetRemovedIds,
  internal.migrations.paperIdentity.forgetScreenedIds,
  internal.migrations.paperIdentity.forgetExtractedIds,
]);

const TABLE = v.union(v.literal("libraryItems"), v.literal("libraryRemovals"), v.literal("screeningResults"), v.literal("extractionPapers"), v.literal("ratings"));
const PAGE = 200;
// A page stops early rather than read past this: saved papers can be large.
const PAGE_BYTES = 4 * 1024 * 1024;
const SAMPLE = 20;

/** One page of a table: rows still without an identity (ratings: not under a key), and of those, rows whose ID names no paper (a sample of their IDs). */
export const verifyPage = internalQuery({
  args: { table: TABLE, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ left: v.number(), unplaced: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: PAGE, maximumBytesRead: PAGE_BYTES });
    if (table === "ratings") {
      const ids = (page.page as Doc<"ratings">[]).map((row) => row.paperId).filter((id) => toPaperKey(id) !== id);
      return { left: ids.length, unplaced: ids.filter((id) => !toPaperKey(id)), isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const stored = (page.page as Array<Doc<"libraryItems" | "libraryRemovals" | "screeningResults" | "extractionPapers">>).map((row) => ("item" in row ? row.item : row));
    const left = stored.filter((row) => row.paperKey === undefined);
    const unplaced = left.filter((row) => !("paperKey" in identityFromStored(row))).map((row) => row.openalexId ?? "");
    return { left: left.length, unplaced, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Saved papers of one workspace that share a key: one paper saved twice under two forms of its ID. Read in key order. */
export const duplicatesPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), last: v.union(v.string(), v.null()) },
  returns: v.object({ duplicates: v.array(v.string()), last: v.union(v.string(), v.null()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("libraryItems").withIndex("by_workspace_paperKey").paginate({ cursor: args.cursor, numItems: PAGE, maximumBytesRead: PAGE_BYTES });
    const duplicates: string[] = [];
    let last = args.last;
    for (const item of page.page) {
      if (item.paperKey === undefined) continue;
      const at = `${item.workspaceId}|${item.paperKey}`;
      if (at === last) duplicates.push(at);
      last = at;
    }
    return { duplicates, last, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

const tableReport = v.object({ left: v.number(), unplaced: v.number(), sample: v.array(v.string()) });

/**
 * What is still left: per table, rows without an identity and how many of them name no paper; and how many
 * papers a workspace saved twice, with a sample (`duplicatesPage` lists them all). All zero when done.
 */
export const verify = internalAction({
  args: {},
  returns: v.object({ libraryItems: tableReport, libraryRemovals: tableReport, screeningResults: tableReport, extractionPapers: tableReport, ratings: tableReport, duplicates: v.object({ count: v.number(), sample: v.array(v.string()) }) }),
  handler: async (ctx) => {
    const report = async (table: "libraryItems" | "libraryRemovals" | "screeningResults" | "extractionPapers" | "ratings") => {
      const totals = { left: 0, unplaced: 0, sample: [] as string[] };
      for (let cursor: string | null = null; ;) {
        const page: { left: number; unplaced: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.paperIdentity.verifyPage, { table, cursor });
        totals.left += page.left;
        totals.unplaced += page.unplaced.length;
        totals.sample.push(...page.unplaced.slice(0, Math.max(0, SAMPLE - totals.sample.length)));
        if (page.isDone) return totals;
        cursor = page.continueCursor;
      }
    };
    const duplicates = { count: 0, sample: [] as string[] };
    for (let cursor: string | null = null, last: string | null = null; ;) {
      const page: { duplicates: string[]; last: string | null; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.paperIdentity.duplicatesPage, { cursor, last });
      duplicates.count += page.duplicates.length;
      duplicates.sample.push(...page.duplicates.slice(0, Math.max(0, SAMPLE - duplicates.sample.length)));
      if (page.isDone) break;
      cursor = page.continueCursor;
      last = page.last;
    }
    return {
      libraryItems: await report("libraryItems"),
      libraryRemovals: await report("libraryRemovals"),
      screeningResults: await report("screeningResults"),
      extractionPapers: await report("extractionPapers"),
      ratings: await report("ratings"),
      duplicates,
    };
  },
});
