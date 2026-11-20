import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../lib/functions";
import { fileOut } from "../../lib/reports/report";

/**
 * Stores again every report file not out for everyone (a draft's, a private or embargoed one, a withdrawn one), so
 * the file store addresses its owners' pages handed out before app/api/reports/files stop working. Run once per
 * deployment, after the functions that keep those addresses to themselves are deployed:
 *   npx convex run migrations/rotateKeptFiles:run
 * Safe to run again: it only gives the files new addresses once more.
 */
export const run = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let rotated = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { ids: Array<Id<"reports">>; next: string | null } = await ctx.runQuery(internal.migrations.rotateKeptFiles.held, { cursor });
      for (const reportId of page.ids) {
        await ctx.runAction(internal.reports.files.rotate, { reportId });
        rotated++;
      }
      if (page.next === null) return rotated;
      cursor = page.next;
    }
  },
});

export const held = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ ids: v.array(v.id("reports")), next: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("reports").paginate({ cursor, numItems: 100 });
    return { ids: page.page.filter((report) => (report.pdf || report.cover) && !fileOut(report)).map((report) => report._id), next: page.isDone ? null : page.continueCursor };
  },
});
