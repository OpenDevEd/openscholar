import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { listCounts, organizationLibrariesOf, uncounted } from "../lib/listCounts";

/**
 * Counts the libraries each organization had before the library list paged (#423), so the
 * list totals from a kept count (lib/listCounts.ts). A library made or deleted since is
 * counted by its trigger, and one is counted once however often this runs.
 *
 *   npx convex run migrations/pagedLibraryList:run '{"dryRun": true}'
 *   npx convex run migrations/pagedLibraryList:run
 *   npx convex run migrations/pagedLibraryList:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const libraries = migrations.define({
  table: "evidenceLibraries",
  batchSize: 50,
  migrateOne: async (ctx, library) => {
    await listCounts.insertIfDoesNotExist(ctx, { namespace: organizationLibrariesOf(library.organizationId), key: null, id: library._id });
  },
});

export const run = migrations.runner(internal.migrations.pagedLibraryList.libraries);

/** Libraries on one page that their organization's count leaves out. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("evidenceLibraries").paginate({ cursor, numItems: 100 });
    return { wrong: await uncounted(ctx, page.page, (library) => organizationLibrariesOf(library.organizationId)), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many libraries their organization's count leaves out, a page at a time; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedLibraryList.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
