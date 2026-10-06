import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { writeAnswerRows } from "../extraction/listProjection";
import { MAX_QUESTIONS_PER_JOB } from "../extraction/validators";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Writes the answer rows (extraction/validators.ts extractionAnswerRowFields) of papers that
// finished before they were kept, from the paper's saved answers. Safe to repeat: a row that
// already matches isn't written again. One paper per transaction keeps its answers in bounds.
export const papers = migrations.define({
  table: "extractionPapers",
  batchSize: 1,
  migrateOne: async (ctx, paper) => {
    const results = await ctx.db.query("extractionResults").withIndex("by_paper", (q) => q.eq("paperId", paper._id)).take(MAX_QUESTIONS_PER_JOB);
    await writeAnswerRows(ctx, paper, results, paper.avgConfidence ?? 0);
  },
});

export const run = migrations.runner(internal.migrations.extractionAnswers.papers);
