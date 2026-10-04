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
 *
 * Someone `verify` still lists had no count when the run reached them: count them with
 * backfillUsers, then run again from the start, which a finished run only does with `reset`:
 *
 *   npx convex run migrations/moveLibraryCounts:run '{"reset": true}'
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

/** How many people have no count row, with the first few of them; `missing` is 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.object({ missing: v.number(), sample: v.array(v.string()) }),
  handler: async (ctx): Promise<{ missing: number; sample: string[] }> => {
    let missing = 0;
    const sample: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.moveLibraryCounts.verifyPage, { cursor });
      missing += page.problems.length;
      sample.push(...page.problems.slice(0, 20 - sample.length));
      if (page.isDone) return { missing, sample };
      cursor = page.continueCursor;
    }
  },
});
