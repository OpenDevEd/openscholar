"use node";

/**
 * Test helper functions - NO AUTH REQUIRED
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Get existing test user or create one
 */
export async function getOrCreateTestUser(ctx: MutationCtx): Promise<Doc<"users">> {
  // Look for existing test user
  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", "test@example.com"))
    .first();
  
  if (existingUser) {
    return existingUser;
  }
  
  // Create test user
  const userId = await ctx.db.insert("users", {
    clerkId: `test-clerk-${Date.now()}`,
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    state: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("Failed to create test user");
  }
  
  return user;
}

/**
 * Cleanup test data (optional)
 */
export async function cleanupTestData(ctx: MutationCtx, jobId: Id<"extractionJobs">): Promise<void> {
  // Get all papers for this job
  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();
  
  // Delete results and papers
  for (const paper of papers) {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect();
    
    for (const result of results) {
      await ctx.db.delete(result._id);
    }
    
    await ctx.db.delete(paper._id);
  }
  
  // Delete questions
  const questions = await ctx.db
    .query("extractionQuestions")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();
  
  for (const question of questions) {
    await ctx.db.delete(question._id);
  }
  
  // Delete job
  await ctx.db.delete(jobId);
}
