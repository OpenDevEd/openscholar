import type { convexTest } from "convex-test";
import type { Id } from "../../_generated/dataModel";

/**
 * Seed a full extraction job graph across all 9 child tables.
 * Returns all IDs for verification. Used by cascade-delete tests AND the
 * SN-3 queries-e2e pin-test.
 *
 * The seeded user has clerkId "clerk_cascade_test"; drive authenticated
 * queries with `t.withIdentity({ subject: "clerk_cascade_test",
 * tokenIdentifier: "clerk_cascade_test|test" })`.
 */
export async function seedFullJobGraph(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_cascade_test",
      email: "cascade@test.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      processedPapers: 1,
      failedPapers: 0,
      name: "Test Job",
      createdAt: now,
      updatedAt: now,
    });

    const baselineJobId = await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      processedPapers: 1,
      failedPapers: 0,
      name: "Baseline Job",
      createdAt: now,
      updatedAt: now,
    });

    const questionId = await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "Test question?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });

    let storageId: Id<"_storage"> | undefined = undefined;
    try {
      storageId = await ctx.storage.store(new Blob(["test pdf content"]));
    } catch {
      // ctx.storage.store may not be available in convex-test;
      // cascade handles missing storage gracefully via try/catch
    }

    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:test1",
      title: "Test Paper",
      status: "completed" as const,
      processable: true,
      ...(storageId ? { storageId } : {}),
    });

    const resultId = await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: "q1",
      answer: "Test answer",
      citations: [],
      citationStatus: "grounded" as const,
      processedAt: now,
    });

    const reviewId = await ctx.db.insert("extractionResultReviews", {
      jobId,
      paperId,
      resultId,
      questionKey: "q1",
      state: "unreviewed" as const,
      createdAt: now,
      updatedAt: now,
    });

    const evidenceUnitId = await ctx.db.insert("extractionEvidenceUnits", {
      jobId,
      paperId,
      evidenceId: "ev1",
      page: 1,
      charRange: [0, 100],
      text: "Evidence text",
      tokens: ["evidence", "text"],
      anchorConfidence: 0.95,
      source: "pdf",
      createdAt: now,
    });

    const savedViewId = await ctx.db.insert("extractionSavedViews", {
      jobId,
      userId,
      name: "Test View",
      filters: {
        searchQuery: "",
        confidenceRange: [0, 1],
        statusFilters: [],
      },
      createdAt: now,
      updatedAt: now,
    });

    const snapshotId = await ctx.db.insert("extractionReportSnapshots", {
      jobId,
      userId,
      name: "Test Report",
      scope: {},
      sections: [],
      metrics: {
        totalPapers: 1,
        answeredRate: 1,
        groundedRate: 1,
        bestEffortRate: 0,
      },
      generatedAt: now,
      createdAt: now,
    });

    const runDiffId = await ctx.db.insert("extractionRunDiffs", {
      jobId,
      baselineJobId,
      userId,
      summary: {
        newAnswers: 0,
        changedAnswers: 0,
        removedAnswers: 0,
        confidenceShifts: 0,
        newlyInsufficientEvidence: 0,
        totalCompared: 1,
      },
      changes: [],
      generatedAt: now,
      createdAt: now,
    });

    return {
      userId,
      jobId,
      baselineJobId,
      paperId,
      questionId,
      resultId,
      reviewId,
      evidenceUnitId,
      savedViewId,
      snapshotId,
      runDiffId,
      hasStorageId: !!storageId,
    };
  });
}

export const SEED_CLERK_ID = "clerk_cascade_test";
export const SEED_IDENTITY = {
  subject: SEED_CLERK_ID,
  tokenIdentifier: `${SEED_CLERK_ID}|test`,
};
