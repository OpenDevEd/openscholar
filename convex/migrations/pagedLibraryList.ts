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

/**
 * One page of the counts kept from the library tables, forgotten. A count already at zero is
 * left alone: clearing a count makes it again under a new ID, which a later page would meet
 * and clear again without end.
 */
export const resetPage = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await listCounts.paginateNamespaces(ctx, cursor, 100);
    const kept = page.page.filter((namespace) => namespace?.startsWith("organizationLibraries:") || namespace?.startsWith("libraryVersions:"));
    const counts = await listCounts.countBatch(ctx, kept.map((namespace) => ({ namespace })));
    for (const [at, namespace] of kept.entries()) if (counts[at] > 0) await listCounts.clear(ctx, { namespace });
    return { isDone: page.isDone, cursor: page.cursor };
  },
});

/**
 * Forgets the counts kept from the library tables, and answers once every one is forgotten:
 * for a deployment whose libraries were replaced without their triggers, as CI's test backend
 * is before every run (.github/workflows/ci.yml). `run`, and
 * `migrations/pagedLibraryVersions:run`, count what is there again.
 */
export const reset = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    for (let cursor: string | undefined; ;) {
      const page: { isDone: boolean; cursor: string } = await ctx.runMutation(internal.migrations.pagedLibraryList.resetPage, { cursor });
      if (page.isDone) return null;
      cursor = page.cursor;
    }
  },
});
