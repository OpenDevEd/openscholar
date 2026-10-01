import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { moveSearchHistory } from "../research/records";

/**
 * Moves every saved search's query and question history into searchHistory rows, keeping
 * only its summary on the search (#354). A search being edited moves itself first, so
 * this reaches the rest; one search per transaction. Revisions keep the history they
 * were saved with. Safe to run again.
 *
 *   npx convex run migrations/moveSearchHistory:run '{"dryRun": true}'
 *   npx convex run migrations/moveSearchHistory:run
 *   npx convex run migrations/moveSearchHistory:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const moveSearches = migrations.define({
  table: "searches",
  batchSize: 1,
  migrateOne: async (ctx, search) => {
    await moveSearchHistory(ctx, search._id);
  },
});

export const run = migrations.runner(internal.migrations.moveSearchHistory.moveSearches);

/**
 * One search's check for `verify`: it holds no history arrays, and its summary counts its
 * rows: at most the counted rows plus one are read.
 */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("searches").paginate({ cursor, numItems: 1 });
    const problems: string[] = [];
    for (const search of page.page) {
      if (search.data.queryHistory || search.data.questionHistory) { problems.push(`${search.data.id}: still holds its history`); continue; }
      for (const [kind, expected] of [["query", search.data.queryHistoryCount ?? -1], ["question", search.data.questionCount ?? -1]] as const) {
        const rows = await ctx.db.query("searchHistory").withIndex("by_search_and_kind_and_position", (q) => q.eq("searchId", search._id).eq("kind", kind)).take(expected + 1);
        if (rows.length !== expected) problems.push(`${search.data.id}: ${expected} ${kind} entries counted, ${rows.length}${rows.length > expected ? "+" : ""} saved`);
      }
    }
    return { problems, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Searches whose history isn't moved or doesn't match its counts; empty when done. */
export const verify = internalAction({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx): Promise<string[]> => {
    const problems: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.moveSearchHistory.verifyPage, { cursor });
      problems.push(...page.problems);
      if (page.isDone) return problems;
      cursor = page.continueCursor;
    }
  },
});
