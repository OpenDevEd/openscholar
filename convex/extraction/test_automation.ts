"use node";

/**
 * SIMPLE Automated PDF extraction test
 * Single self-contained action
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { workflow } from "../workflow";
import type { Id } from "../_generated/dataModel";
import { assertNonProd } from "../lib/assertNonProd";

/**
 * Internal action to trigger an immediate PDF extraction test run.
 *
 * Access: Internal only (internalAction) -- not exposed to clients.
 */
export const runPdfTestNow = internalAction({
  args: {},
  handler: async (ctx): Promise<{
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

    // 1. Get first user using internal query
    const userId = await ctx.runQuery(internal.extraction.test_automation_internal.getFirstUserId, {});
    if (!userId) {
      throw new Error("No users found");
    }
    const user = await ctx.runQuery(internal.users.internal.getUserById, {
      userId
    });
    
    if (!user) {
      throw new Error("No users found");
    }

    // 2. Create job using internal mutation
    const jobId = await ctx.runMutation(internal.extraction.test_automation_internal.createTestJob, {
      userId: user._id,
    });

    // 3. Start workflow
    await workflow.start(ctx, internal.extraction.workflow.runExtractionWorkflow, {
      jobId,
    });

    // 4. Poll for results
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 10000));
      
      const status = await ctx.runQuery(internal.extraction.test_automation_internal.getJobStatus, { jobId });

      if (status.completed >= 3 || status.status === "completed") {
        break;
      }
    }
    
    // 5. Get final results
    const results = await ctx.runQuery(internal.extraction.test_automation_internal.getJobResults, { jobId });
    
    if (results.indexed === 0) {
      throw new Error("No indexed papers");
    }
    if (results.pdfContentUsed === 0) {
      throw new Error("No PDF content used");
    }
    
    return {
      success: results.withPdf > 0 && results.indexed > 0 && results.pdfContentUsed > 0,
      jobId,
      results,
    };
  },
});
