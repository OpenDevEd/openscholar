"use node";

/**
 * Node-runtime test runner for the PDF extraction pipeline.
 * Starts a fresh job, polls until completion, and asserts that the
 * pipeline produced indexed papers with PDF-grounded answers.
 */

import { internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { assertNonProd } from "../../lib/assertNonProd";

export const runPdfTestNow = internalAction({
  args: {},
  returns: v.object({
    success: v.boolean(),
    jobId: v.id("extractionJobs"),
    results: v.object({
      total: v.number(),
      completed: v.number(),
      failed: v.number(),
      withPdf: v.number(),
      indexed: v.number(),
      pdfContentUsed: v.number(),
    }),
  }),
  handler: async (
    ctx,
  ): Promise<{
    success: boolean;
    jobId: Id<"extractionJobs">;
    results: {
      total: number;
      completed: number;
      failed: number;
      withPdf: number;
      indexed: number;
      pdfContentUsed: number;
    };
  }> => {
    assertNonProd();

    const { jobId } = await ctx.runMutation(
      internal.extraction.tests.fixtures.createTestJob,
      {
        name: `PDF Test ${Date.now()}`,
        bucketItems: [
          {
            bucketKey: "history:pdf-test",
            source: "history",
            sourceRefId: "pdf-test",
            title: "desert climate africa",
            authors: [],
            searchFilters: {
              query: "desert climate africa",
              yearRange: [2015, 2024],
              sortBy: "relevance",
            },
          },
        ],
        questions: [
          {
            key: "method",
            question: "What methodology was used?",
            type: "string",
          },
          {
            key: "sample",
            question: "What was the sample size?",
            type: "string",
          },
        ],
        start: true,
      },
    );

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const status = await ctx.runQuery(
        internal.extraction.tests.fixtures.getTestJobResults,
        { jobId },
      );
      if (status.completed >= 3 || status.status === "completed") break;
    }

    const results = await ctx.runQuery(
      internal.extraction.tests.fixtures.getTestJobResults,
      { jobId },
    );

    if (results.indexed === 0) throw new Error("No indexed papers");
    if (results.pdfContentUsed === 0) throw new Error("No PDF content used");

    return {
      success:
        results.withPdf > 0 &&
        results.indexed > 0 &&
        results.pdfContentUsed > 0,
      jobId,
      results: {
        total: results.total,
        completed: results.completed,
        failed: results.failed,
        withPdf: results.withPdf,
        indexed: results.indexed,
        pdfContentUsed: results.pdfContentUsed,
      },
    };
  },
});
