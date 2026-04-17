/**
 * Evidence-unit mutation. The indexing step (runs in a workpool action)
 * produces an array of evidence units per paper; this mutation replaces
 * the previous set atomically so a re-index leaves no orphans and the
 * MAX_EVIDENCE_UNITS_PER_PAPER cardinality bound is enforced.
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { MAX_EVIDENCE_UNITS_PER_PAPER } from "../../lib/queryBounds";

export const replacePaperEvidenceUnits = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    units: v.array(
      v.object({
        evidenceId: v.string(),
        page: v.number(),
        charRange: v.array(v.number()),
        text: v.string(),
        section: v.optional(v.string()),
        tokens: v.array(v.string()),
        anchorConfidence: v.number(),
        source: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;

    const existing = await ctx.db
      .query("extractionEvidenceUnits")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .take(MAX_EVIDENCE_UNITS_PER_PAPER);

    for (const row of existing) {
      await ctx.db.delete("extractionEvidenceUnits", row._id);
    }

    for (const unit of args.units) {
      await ctx.db.insert("extractionEvidenceUnits", {
        jobId: paper.jobId,
        paperId: args.paperId,
        evidenceId: unit.evidenceId,
        page: unit.page,
        charRange: unit.charRange,
        text: unit.text,
        section: unit.section,
        tokens: unit.tokens,
        anchorConfidence: unit.anchorConfidence,
        source: unit.source,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});
