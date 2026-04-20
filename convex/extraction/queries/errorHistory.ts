/**
 * Plan-07 — paginated error history per paper.
 *
 * Reads the append-only `extractionPaperErrors` table via the
 * `by_paper` index, newest-first. Feeds the expandable error-history
 * panel on the job detail page. Bounded pagination (plan 07 caps the
 * inline display at ~10 and relies on the cursor for deeper scroll).
 *
 * Caller-safe: returns an empty paginated shell for unowned / missing
 * papers, matching the queries/costs.ts pattern so nothing leaks
 * through the query channel.
 */

import { query } from "../../_generated/server";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { resolveOwnedPaper } from "../access";
import { extractionPaperErrorValidator } from "../validators";

const paginatedErrorsValidator = paginationResultValidator(
  extractionPaperErrorValidator,
);

export const listPaperErrors = query({
  args: {
    paperId: v.id("extractionPapers"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginatedErrorsValidator,
  handler: async (ctx, args) => {
    const access = await resolveOwnedPaper(ctx, args.paperId);
    if (access.status !== "ok") {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        splitCursor: null,
        pageStatus: null,
      };
    }

    return await ctx.db
      .query("extractionPaperErrors")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
