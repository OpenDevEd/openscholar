import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { libraryCountRow } from "../library/counter";

/**
 * Gives every person a `libraryCounts` row from the count on their user row, so library saves
 * stop rewriting the user row every mutation of theirs reads (#383). A person who saved or
 * removed a paper since already has a row, and it is newer. Someone with no count yet gets
 * one from migrations/backfillLibraryCounters:backfillUsers first. Safe to run again.
 *
 *   npx convex run migrations/backfillLibraryCounters:backfillUsers
 *   npx convex run migrations/moveLibraryCounts:run '{"dryRun": true}'
 *   npx convex run migrations/moveLibraryCounts:run
 *   npx convex run migrations/moveLibraryCounts:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const moveUsers = migrations.define({
  table: "users",
  batchSize: 200,
  migrateOne: async (ctx, user) => {
    if (user.libraryItemCount === undefined || (await libraryCountRow(ctx, user._id))) return;
    await ctx.db.insert("libraryCounts", { userId: user._id, count: user.libraryItemCount });
  },
});

export const run = migrations.runner(internal.migrations.moveLibraryCounts.moveUsers);

/** A page of people without a count row. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("users").paginate({ cursor, numItems: 200 });
    const problems: string[] = [];
    for (const user of page.page) if (!(await libraryCountRow(ctx, user._id))) problems.push(`${user._id}: no library count row`);
    return { problems, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** People without a count row; empty when done. */
export const verify = internalAction({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx): Promise<string[]> => {
    const problems: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.moveLibraryCounts.verifyPage, { cursor });
      problems.push(...page.problems);
      if (page.isDone) return problems;
      cursor = page.continueCursor;
    }
  },
});
