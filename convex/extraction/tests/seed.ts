import type { convexTest } from "convex-test";
import type { Id } from "../../_generated/dataModel";

/**
 * Seed a full extraction job graph across active child tables.
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
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      name: "Test Job",
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

    const sourceId = await ctx.db.insert("extractionJobSources", {
      jobId,
      position: 0,
      bucketKey: "history:test1",
      source: "history" as const,
      sourceRefId: "oa:test1",
      title: "Test Paper",
      authors: ["Test Author"],
      year: 2024,
      openalexId: "oa:test1",
    });

    const chatPaperId = await ctx.db.insert("chatPapers", {
      jobId,
      sourceId,
      included: true,
    });

    const chatSourceEventId = await ctx.db.insert("chatSourceEvents", {
      jobId,
      threadId: "thread_test",
      kind: "sources_updated" as const,
      boundaryOrder: 1,
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

    const queueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "pending" as const,
      priority: 0,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });

    const paperErrorId = await ctx.db.insert("extractionPaperErrors", {
      jobId,
      paperId,
      attempt: 1,
      at: now,
      code: "extraction_failed" as const,
      message: "Synthetic extraction error",
    });

    return {
      userId,
      jobId,
      paperId,
      questionId,
      sourceId,
      chatPaperId,
      chatSourceEventId,
      resultId,
      evidenceUnitId,
      queueId,
      paperErrorId,
      hasStorageId: !!storageId,
    };
  });
}

export const SEED_CLERK_ID = "clerk_cascade_test";
export const SEED_IDENTITY = {
  subject: SEED_CLERK_ID,
  tokenIdentifier: `${SEED_CLERK_ID}|test`,
};
