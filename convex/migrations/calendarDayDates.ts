import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { calendarDay } from "../../lib/research/records";
import type { Doc } from "../_generated/dataModel";

/**
 * Saved searches kept a picked date range as the browser's local midnights, as instants,
 * so the server (in UTC) and a browser in another timezone read different days. They now
 * keep calendar days (`calendarDay` in lib/research/records.ts); this rewrites the instants
 * in searches and their revisions. Run once per deployment:
 *   npx convex run migrations/calendarDayDates:run '{"table":"searches"}'
 *   npx convex run migrations/calendarDayDates:run '{"table":"searchRevisions"}'
 * Idempotent; each batch schedules the next.
 */
export const run = internalMutation({
  args: { table: v.union(v.literal("searches"), v.literal("searchRevisions")), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ rewritten: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ numItems: 100, cursor: cursor ?? null });
    let rewritten = 0;
    for (const row of page.page as Array<Doc<"searches"> | Doc<"searchRevisions">>) {
      const range = row.data.dateRange;
      if (!range) continue;
      const days = { ...(range.from ? { from: calendarDay(range.from) } : {}), ...(range.to ? { to: calendarDay(range.to) } : {}) };
      if (days.from === range.from && days.to === range.to) continue;
      await ctx.db.patch(row._id, { data: { ...row.data, dateRange: days } });
      rewritten++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.calendarDayDates.run, { table, cursor: page.continueCursor });
    return { rewritten, isDone: page.isDone };
  },
});
