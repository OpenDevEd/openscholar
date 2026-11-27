import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { reviewersOf } from "../screening/dealing";

/**
 * Brings screenings saved before people came first under the rules as they are now (lib/screening/rules.ts `settle`):
 * "first vote decides" puts one person on each paper, and a paper a model settled before its person voted, or that the
 * models alone carried against every person under "most agree", is settled again on its votes. Papers held through a
 * change of settings keep their result, and no model is sent to read anything: nothing is spent. Run once per deployment:
 *   npx convex run migrations/screeningPeopleFirst:run
 * Idempotent; each batch schedules the next.
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ narrowed: v.number(), rechecked: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningJobs").paginate({ numItems: 50, cursor: cursor ?? null });
    let [narrowed, rechecked] = [0, 0];
    for (const job of page.page) {
      const rule = job.rule;
      if (!rule || rule.settle === "all") continue;
      if (rule.settle === "one" && rule.each !== 1) {
        await ctx.db.patch("screeningJobs", job._id, { rule: { ...rule, each: 1 } });
        narrowed++;
      }
      const reviewers = await reviewersOf(ctx, job._id);
      if (!reviewers.some((one) => one.kind === "person") || !reviewers.some((one) => one.kind === "model")) continue;
      await ctx.scheduler.runAfter(0, internal.screening.settings.follow, { jobId: job._id, cursor: null, results: ["waiting", "conflict", "include", "maybe", "exclude"], recheck: false, stricter: [], reread: false });
      rechecked++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.screeningPeopleFirst.run, { cursor: page.continueCursor });
    return { narrowed, rechecked, isDone: page.isDone };
  },
});
