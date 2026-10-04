import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { libraryVersionList, listCounts, uncounted } from "../lib/listCounts";

/**
 * Counts the versions libraries had before their Versions section paged (#423), so the
 * section totals its list from a kept count (lib/listCounts.ts). An operation recorded since
 * is counted by its trigger, and one is counted once however often this runs.
 *
 *   npx convex run migrations/pagedLibraryVersions:run '{"dryRun": true}'
 *   npx convex run migrations/pagedLibraryVersions:run
 *   npx convex run migrations/pagedLibraryVersions:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// A small batch: an operation carries its receipt and configuration issues.
export const operations = migrations.define({
  table: "evidenceLibraryConfigOperations",
  batchSize: 25,
  migrateOne: async (ctx, operation) => {
    const list = libraryVersionList(operation);
    if (list !== null) await listCounts.insertIfDoesNotExist(ctx, { namespace: list, key: null, id: operation._id });
  },
});

export const run = migrations.runner(internal.migrations.pagedLibraryVersions.operations);

/** Versions on one page of operations that their library's list doesn't count. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("evidenceLibraryConfigOperations").paginate({ cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 });
    return { wrong: await uncounted(ctx, page.page, libraryVersionList), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many versions their library's list doesn't count, a page at a time; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedLibraryVersions.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
