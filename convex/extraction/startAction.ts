"use node";

/**
 * Start Extraction Action
 * Handles the full job creation and paper fetching in an action
 * This works around the mutation limitation of not being able to call actions
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export const startExtractionAction = action({
  args: {
    name: v.string(),
    sourceType: v.union(v.literal("history"), v.literal("zotero")),
    sourceHistoryId: v.optional(v.string()),
    searchFilters: v.optional(v.record(v.string(), v.any())),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    // Hardcoded user ID for testing (seikirin.tempest@gmail.com)
    const userId = "k57bnmn34g37j7w6ke84r7stmn8089x9" as Id<"users">;

    // Create job via existing mutation using string path
    const jobId = await ctx.runMutation(
      "extraction/mutations:createJobDirect" as any,
      {
        userId,
        name: args.name,
        sourceType: args.sourceType,
        searchFilters: args.searchFilters,
      }
    );

    // Create question records
    for (let i = 0; i < args.questions.length; i++) {
      await ctx.runMutation(
        internal.extraction.mutations.createQuestionDirect,
        {
          jobId,
          key: args.questions[i].key,
          question: args.questions[i].question,
          type: args.questions[i].type,
          description: args.questions[i].description,
          order: i,
        }
      );
    }

    // Update job status to downloading_pdfs
    await ctx.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
    });

    // Fetch papers from OpenAlex
    if (args.searchFilters) {
      try {
        const papers = await ctx.runAction(
          internal.extraction.actions.fetchPapersFromHistory,
          {
            searchFilters: args.searchFilters,
            userId,
          }
        );

        // Create paper records
        await ctx.runMutation(
          internal.extraction.mutations.createPaperRecords,
          {
            jobId,
            papers,
          }
        );

        // Update job with total
        await ctx.runMutation(internal.extraction.mutations.updateJobStatus, {
          jobId,
          status: "downloading_pdfs",
          totalPapers: papers.length,
        });
      } catch (error) {
        console.error("Failed to fetch papers:", error);
        await ctx.runMutation(internal.extraction.mutations.updateJobStatus, {
          jobId,
          status: "failed",
        });
      }
    }

    return { jobId };
  },
});
