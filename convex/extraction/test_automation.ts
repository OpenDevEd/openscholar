"use node";

/**
 * SIMPLE Automated PDF extraction test
 * Single self-contained action
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workflow } from "../workflow";

export const runPdfTestNow = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("\n🚀 STARTING PDF EXTRACTION TEST\n");
    
    // 1. Get first user using internal query
    const user = await ctx.runQuery(internal.users.internal.getUserById, {
      userId: await ctx.runQuery(internal.extraction.test_automation_internal.getFirstUserId, {})
    });
    
    if (!user) {
      throw new Error("No users found");
    }
    console.log(`✓ User: ${user._id}`);
    
    // 2. Create job using internal mutation
    const jobId = await ctx.runMutation(internal.extraction.test_automation_internal.createTestJob, {
      userId: user._id,
    });
    console.log(`✓ Job: ${jobId}`);
    
    // 3. Start workflow
    await workflow.start(ctx, internal.extraction.workflow.runExtractionWorkflow, {
      jobId,
      userId: user._id,
    });
    console.log(`✓ Workflow started`);
    
    // 4. Poll for results
    console.log("\n⏳ Waiting for papers to process...\n");
    
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 10000));
      
      const status = await ctx.runQuery(internal.extraction.test_automation_internal.getJobStatus, { jobId });
      console.log(`[${i+1}/30] Papers: ${status.total} | Done: ${status.completed} | PDF: ${status.withPdf}`);
      
      if (status.completed >= 3 || status.status === "completed") {
        break;
      }
    }
    
    // 5. Get final results
    const results = await ctx.runQuery(internal.extraction.test_automation_internal.getJobResults, { jobId });
    
    console.log("\n" + "=".repeat(50));
    console.log("RESULTS");
    console.log("=".repeat(50));
    console.log(`Total: ${results.total}`);
    console.log(`Completed: ${results.completed}`);
    console.log(`With PDF: ${results.withPdf}`);
    console.log(`Success Rate: ${results.withPdf > 0 ? '✅ PASS' : '❌ FAIL'}`);
    
    return {
      success: results.withPdf > 0,
      jobId,
      results,
    };
  },
});
