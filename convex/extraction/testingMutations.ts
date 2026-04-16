// convex/extraction/testingMutations.ts
// Phase 105 D-09: companion internalMutation for `seedCompletedJob`.
// Lives in a separate file (no `"use node"`) because mutations cannot be
// defined in a Node runtime module — see `testing.ts` for rationale.
//
// REQUIRES `E2E_CLERK_USER_EMAIL` env var — no fallback to "first user in
// table" so the seed can never attach data to the wrong user.

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ulid } from "ulid";

/** Triple-condition dev guard mirroring convex/lib/env.ts requireAppUrl. */
function assertDevEnvironment(): void {
  const isLocalhost = process.env.CONVEX_CLOUD_URL?.includes("localhost") === true;
  const isDev = process.env.NODE_ENV === "development";
  const explicitlyAllowed = process.env.ALLOW_TEST_SEEDING === "true";
  if (!isLocalhost && !isDev && !explicitlyAllowed) {
    throw new Error(
      "seedCompletedJob is dev/test only. Set ALLOW_TEST_SEEDING=true in Convex env to bypass.",
    );
  }
}

export const insertSeededJob = internalMutation({
  args: {
    paperCount: v.number(),
    questionCount: v.number(),
    // Accepted and echoed for forward-compat, but not persisted -- the current
    // `extractionJobs` schema defines no `title` field. If the schema adds
    // `title` later, include it in the insert below.
    title: v.string(),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, { paperCount, questionCount }): Promise<Id<"extractionJobs">> => {
    // Defense in depth: even though the action layer guards, a misconfigured
    // deployment that calls this mutation directly (e.g. via a future internal
    // function) still enforces the dev gate.
    assertDevEnvironment();

    const testEmail = process.env.E2E_CLERK_USER_EMAIL;
    if (!testEmail) {
      throw new Error(
        "insertSeededJob: E2E_CLERK_USER_EMAIL env var required.",
      );
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", testEmail))
      .first();

    if (!user) {
      throw new Error(
        `insertSeededJob: no user found for E2E_CLERK_USER_EMAIL=${testEmail}. Sign in once before seeding.`,
      );
    }

    const now = Date.now();
    const traceId = ulid();

    const questions = Array.from({ length: questionCount }).map((_, i) => ({
      key: `q${i}`,
      question: `Test question ${i}?`,
      expectedType: "text",
    }));

    // `extractionJobs` schema has NO `title` field. `status: "completed"` with
    // processedPapers == totalPapers so the UI treats this as a finished job.
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      status: "completed",
      totalPapers: paperCount,
      processedPapers: paperCount,
      failedPapers: 0,
      questions,
      traceId,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      tier: "auto",
    });

    // Insert papers. `doi` is `v.optional(v.string())` — use `undefined`
    // (not `null`) when absent.
    const paperIds: Id<"extractionPapers">[] = [];
    for (let i = 0; i < paperCount; i++) {
      const doi = i % 2 === 0 ? undefined : `10.1234/seeded.${i}`;
      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `W9999${i}`,
        title: `Seeded Paper ${i}`,
        doi,
        status: "completed",
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
      paperIds.push(paperId);
    }

    // Mirror createExtractionJob: separate extractionQuestions rows.
    for (const q of questions) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: q.key,
        question: q.question,
        expectedType: q.expectedType,
        createdAt: now,
      });
    }

    // Insert results. Schema uses `questionId` (not `questionKey`);
    // `confidence` is a literal union "high" | "medium" | "low";
    // evidence is flat fields, not an array. `parsingSource` must be a valid
    // parsingSourceValidator literal — use "abstract_only" since seeded data
    // has no real body text.
    for (let i = 0; i < paperIds.length; i++) {
      for (const q of questions) {
        const quoteText = `seeded evidence span for E2E assertion (paper ${i}, ${q.key})`;
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId: paperIds[i],
          questionId: q.key,
          answer: `Seeded answer to ${q.question} for paper ${i}`,
          confidence: "high",
          evidenceQuote: quoteText,
          evidenceSourceId: `W9999${i}`,
          evidenceStartChar: 0,
          evidenceEndChar: quoteText.length,
          reasoning: `Seeded reasoning for ${q.key}.`,
          modelUsed: "test-seed",
          parsingSource: "abstract_only",
          createdAt: now,
        });
      }
    }

    return jobId;
  },
});
