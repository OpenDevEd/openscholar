import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { paperSearchProjection } from "../extraction/listProjection";
import { MAX_QUESTIONS_PER_JOB } from "../extraction/validators";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Rebuild only derived search fields from the current saved paper and answers.
// One paper per transaction keeps its full set of answers within read limits.
export const papers = migrations.define({
  table: "extractionPapers",
  batchSize: 1,
  migrateOne: async (ctx, paper) => {
    const results = await ctx.db.query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .take(MAX_QUESTIONS_PER_JOB);
    const projection = await paperSearchProjection(paper, results);
    if (paper.sortTitle === projection.sortTitle &&
        paper.searchText === projection.searchText &&
        JSON.stringify(paper.questionAnswerTokens) === JSON.stringify(projection.questionAnswerTokens)) return;
    return projection;
  },
});

export const run = migrations.runner(internal.migrations.extractionSearch.papers);
