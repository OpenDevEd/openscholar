import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { adminText, jobText, searchText, shortcutText, withText } from "../lib/searchText";

/**
 * Gives rows from before the lists searched by index the text their search matches (#636):
 * saved searches, bookmarks, extraction jobs and admins. Rows written since get it from their
 * triggers (lib/searchText.ts). Safe to run again.
 *
 *   npx convex run migrations/searchText:run
 *   npx convex run migrations/searchText:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

type Table = "searches" | "queryShortcuts" | "extractionJobs" | "admins";
/** The text a row should have, fitted to its size as a write fits it. */
async function expected<T extends Table>(ctx: QueryCtx, table: T, row: Doc<T>) {
  const { _id, _creationTime, searchText: _was, ...fields } = row as Doc<T> & { searchText?: string };
  const text =
    table === "searches" ? searchText((row as unknown as Doc<"searches">).data)
    : table === "queryShortcuts" ? shortcutText((row as unknown as Doc<"queryShortcuts">).data)
    : table === "extractionJobs" ? jobText(row as unknown as Doc<"extractionJobs">)
    : await adminText(ctx, row as unknown as Doc<"admins">);
  return withText(fields, text).searchText;
}

const fill = <T extends Table>(table: T) => async (ctx: QueryCtx, row: Doc<T>) => {
  const text = await expected(ctx, table, row);
  return row.searchText === text ? undefined : ({ searchText: text } as never);
};

// A search, bookmark or job can be most of a MiB, read again by its trigger: a few a batch stay inside 16 MiB.
export const searches = migrations.define({ table: "searches", batchSize: 5, migrateOne: fill("searches") });
export const shortcuts = migrations.define({ table: "queryShortcuts", batchSize: 5, migrateOne: fill("queryShortcuts") });
export const jobs = migrations.define({ table: "extractionJobs", batchSize: 5, migrateOne: fill("extractionJobs") });
export const admins = migrations.define({ table: "admins", migrateOne: fill("admins") });

export const run = migrations.runner([internal.migrations.searchText.searches, internal.migrations.searchText.shortcuts, internal.migrations.searchText.jobs, internal.migrations.searchText.admins]);

const tableValidator = v.union(v.literal("searches"), v.literal("queryShortcuts"), v.literal("extractionJobs"), v.literal("admins"));

/** Rows on one page of `table` whose search text isn't what it should be. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 5 });
    let wrong = 0;
    for (const row of page.page) if (row.searchText !== (await expected(ctx, table, row as never))) wrong++;
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many rows `verifyPage` finds wrong across the tables; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["searches", "queryShortcuts", "extractionJobs", "admins"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.searchText.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
