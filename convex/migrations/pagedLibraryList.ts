import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { listCounts } from "../lib/listCounts";

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
    const kept = page.page.filter((namespace) => namespace?.startsWith("workspaceLibraries:") || namespace?.startsWith("libraryVersions:"));
    const counts = await listCounts.countBatch(ctx, kept.map((namespace) => ({ namespace })));
    for (const [at, namespace] of kept.entries()) if (counts[at] > 0) await listCounts.clear(ctx, { namespace });
    return { isDone: page.isDone, cursor: page.cursor };
  },
});

/**
 * Forgets the counts kept from the library tables, and answers once every one is forgotten:
 * for a deployment whose libraries were replaced without their triggers, as CI's test backend
 * is before every run (.github/workflows/ci.yml). New libraries are counted by their triggers,
 * and `migrations/pagedLibraryVersions:run` counts what is there again.
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
