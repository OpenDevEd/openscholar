import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { identityFromStored } from "../lib/paperRef";

/**
 * Gives every saved paper, removed paper and screened or extracted paper kept before papers were
 * named by their source its identity (plans/evidence-library-sources): its key, its source and its
 * cross-references, read from the ID it was stored under, its DOI and its PDF address. A row whose
 * ID names no paper is left as it was and counted by `verify`. Safe to run again.
 *
 *   npx convex run migrations/paperIdentity:run '{"dryRun": true}'
 *   npx convex run migrations/paperIdentity:run
 *   npx convex run migrations/paperIdentity:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const papers = migrations.define({
  table: "libraryItems",
  batchSize: 100,
  migrateOne: (_ctx, item) => (item.paperKey === undefined ? identityFromStored(item) : undefined),
});

export const removals = migrations.define({
  table: "libraryRemovals",
  batchSize: 100,
  migrateOne: (_ctx, row) => {
    if (row.item.paperKey !== undefined) return;
    const identity = identityFromStored(row.item);
    return "paperKey" in identity ? { item: { ...row.item, ...identity } } : undefined;
  },
});

// Screened and extracted papers hold their abstracts: smaller steps.
export const screened = migrations.define({
  table: "screeningResults",
  batchSize: 50,
  migrateOne: (_ctx, result) => (result.paperKey === undefined ? identityFromStored(result) : undefined),
});

export const extracted = migrations.define({
  table: "extractionPapers",
  batchSize: 50,
  migrateOne: (_ctx, paper) => (paper.paperKey === undefined ? identityFromStored(paper) : undefined),
});

export const run = migrations.runner([
  internal.migrations.paperIdentity.papers,
  internal.migrations.paperIdentity.removals,
  internal.migrations.paperIdentity.screened,
  internal.migrations.paperIdentity.extracted,
]);

const TABLE = v.union(v.literal("libraryItems"), v.literal("libraryRemovals"), v.literal("screeningResults"), v.literal("extractionPapers"));
const PAGE = 200;

/** One page of a table: rows still without an identity, and of those, rows whose ID names no paper (a sample of their IDs). */
export const verifyPage = internalQuery({
  args: { table: TABLE, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ left: v.number(), unplaced: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: PAGE });
    const stored = page.page.map((row) => ("item" in row ? row.item : row));
    const left = stored.filter((row) => row.paperKey === undefined);
    const unplaced = left.filter((row) => !("paperKey" in identityFromStored(row))).map((row) => row.openalexId);
    return { left: left.length, unplaced, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Saved papers of one workspace that share a key: one paper saved twice under two forms of its ID. Read in key order. */
export const duplicatesPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), last: v.union(v.string(), v.null()) },
  returns: v.object({ duplicates: v.array(v.string()), last: v.union(v.string(), v.null()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("libraryItems").withIndex("by_workspace_paperKey").paginate({ cursor: args.cursor, numItems: PAGE });
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

/** What is still left: per table, rows without an identity and how many of them name no paper; and duplicate saved papers. All zero when done. */
export const verify = internalAction({
  args: {},
  returns: v.object({ libraryItems: tableReport, libraryRemovals: tableReport, screeningResults: tableReport, extractionPapers: tableReport, duplicates: v.array(v.string()) }),
  handler: async (ctx) => {
    const report = async (table: "libraryItems" | "libraryRemovals" | "screeningResults" | "extractionPapers") => {
      const totals = { left: 0, unplaced: 0, sample: [] as string[] };
      for (let cursor: string | null = null; ;) {
        const page: { left: number; unplaced: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.paperIdentity.verifyPage, { table, cursor });
        totals.left += page.left;
        totals.unplaced += page.unplaced.length;
        totals.sample.push(...page.unplaced.slice(0, Math.max(0, 10 - totals.sample.length)));
        if (page.isDone) return totals;
        cursor = page.continueCursor;
      }
    };
    const duplicates: string[] = [];
    for (let cursor: string | null = null, last: string | null = null; ;) {
      const page: { duplicates: string[]; last: string | null; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.paperIdentity.duplicatesPage, { cursor, last });
      duplicates.push(...page.duplicates);
      if (page.isDone) break;
      cursor = page.continueCursor;
      last = page.last;
    }
    return {
      libraryItems: await report("libraryItems"),
      libraryRemovals: await report("libraryRemovals"),
      screeningResults: await report("screeningResults"),
      extractionPapers: await report("extractionPapers"),
      duplicates,
    };
  },
});
