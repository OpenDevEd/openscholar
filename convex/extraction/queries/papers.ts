/**
 * Paper-scoped queries, grouped under queries/papers.ts. Each function is
 * addressed by the short name in this module — e.g.
 * `api.extraction.queries.papers.results` / `…papers.pdfUrl` for the
 * public ones, `internal.extraction.queries.papers.{byId,resultsInternal}`
 * for the internals.
 */

import { query, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedPaper } from "../access";
import { getFlag, requireFeature } from "../../featureFlags/guard";
import { extractionPaperValidator, extractionResultValidator, paperResultsValidator } from "../validators";

export const results = query({
  args: { paperId: v.id("extractionPapers") },
  returns: statusResultValidator({
    paper: extractionPaperValidator,
    results: paperResultsValidator,
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedPaper(ctx, args.paperId);
    if (access.status !== "ok") return access;
    const { paper } = access;
    await requireFeature(ctx, "extraction.enabled");

    const rows = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    return ok({ paper, results: rows });
  },
});

export const pdfUrl = query({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      pdfUrl: v.union(v.string(), v.null()),
    }),
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") }),
  ),
  handler: async (ctx, args) => {
    const access = await resolveOwnedPaper(ctx, args.paperId);
    if (access.status !== "ok") return access;

    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
    if (!pdfEnabled) return ok({ pdfUrl: null });

    const { paper } = access;
    let pdfUrlValue: string | null = null;
    if (paper.storageId) {
      pdfUrlValue = await ctx.storage.getUrl(paper.storageId);
    } else {
      pdfUrlValue = paper.pdfUrl || null;
    }
    return ok({ pdfUrl: pdfUrlValue });
  },
});

export const resultsInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  returns: v.array(extractionResultValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
  },
});

export const byId = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(v.null(), extractionPaperValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get("extractionPapers", args.paperId);
  },
});
