/**
 * Plan-05 — getRetryableSummary behavior tests.
 *
 * Seeds a job with mixed result rows (8 completed, 2 rate_limit,
 * 1 network, 1 pdf_invalid, 1 moderation) and asserts the query
 * returns the summarizer's classification under an authed identity,
 * plus zero-returns for cross-tenant and anonymous callers.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";

const CLERK_OWNER = "clerk_retry_summary_owner";
const OWNER_IDENTITY = {
  tokenIdentifier: `https://test.clerk.local|${CLERK_OWNER}`,
  subject: CLERK_OWNER,
  issuer: "https://test.clerk.local",
};

async function seedJobWithMixedFailures(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: CLERK_OWNER,
      email: "retry@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Retry Summary Test",
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:retry1",
      title: "Paper 1",
      status: "completed" as const,
    });
    // 8 completed results (billed, happy path).
    for (let i = 0; i < 8; i++) {
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: `q_completed_${i}`,
        answer: "A",
        citations: [],
        citationStatus: "grounded" as const,
        status: "completed" as const,
        billed: true,
        attemptCount: 1,
        processedAt: now,
      });
    }
    // 2 rate_limit failures — retryable.
    for (let i = 0; i < 2; i++) {
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: `q_rate_${i}`,
        answer: null,
        citations: [],
        citationStatus: "extraction_error" as const,
        status: "failed" as const,
        billed: false,
        attemptCount: 1,
        lastError: { code: "rate_limit" as const, message: "429", at: now },
        processedAt: now,
      });
    }
    // 1 network failure — retryable.
    await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: "q_network",
      answer: null,
      citations: [],
      citationStatus: "extraction_error" as const,
      status: "failed" as const,
      billed: false,
      attemptCount: 1,
      lastError: { code: "network" as const, message: "fetch failed", at: now },
      processedAt: now,
    });
    // 1 pdf_invalid — permanent.
    await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: "q_pdf",
      answer: null,
      citations: [],
      citationStatus: "extraction_error" as const,
      status: "failed" as const,
      billed: false,
      attemptCount: 1,
      lastError: { code: "pdf_invalid" as const, message: "corrupt", at: now },
      processedAt: now,
    });
    // 1 moderation — permanent.
    await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: "q_mod",
      answer: null,
      citations: [],
      citationStatus: "extraction_error" as const,
      status: "failed" as const,
      billed: false,
      attemptCount: 1,
      lastError: { code: "moderation" as const, message: "flagged", at: now },
      processedAt: now,
    });
    return { userId, jobId, paperId };
  });
}

describe("getRetryableSummary", () => {
  it("classifies mixed failures into retryable/permanent with breakdown", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithMixedFailures(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const summary = await auth.query(
      api.extraction.queries.retry.getRetryableSummary,
      { jobId },
    );
    expect(summary).toEqual({
      retryableCount: 3, // 2× rate_limit + 1× network
      permanentCount: 2, // pdf_invalid + moderation
      permanentBreakdown: { pdf_invalid: 1, moderation: 1 },
    });
  });

  it("returns zeros for a job the caller does not own (no existence leak)", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithMixedFailures(t);
    // Seed a foreign user so the identity is valid-but-not-owner.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "clerk_retry_summary_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });
    const foreign = t.withIdentity({
      tokenIdentifier: "https://test.clerk.local|clerk_retry_summary_other",
      subject: "clerk_retry_summary_other",
      issuer: "https://test.clerk.local",
    });
    const summary = await foreign.query(
      api.extraction.queries.retry.getRetryableSummary,
      { jobId },
    );
    expect(summary).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("returns zeros for an unauthenticated caller", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithMixedFailures(t);
    const summary = await t.query(
      api.extraction.queries.retry.getRetryableSummary,
      { jobId },
    );
    expect(summary).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("returns zeros for a job with no failures (retryable=0, permanent=0)", async () => {
    const t = convexTest(schema);
    const { jobId } = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: CLERK_OWNER,
        email: "retry@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        name: "Clean job",
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 1,
        usePdfs: false,
        createdAt: now,
        updatedAt: now,
      });
      const paperId: Id<"extractionPapers"> = await ctx.db.insert(
        "extractionPapers",
        {
          jobId,
          openalexId: "oa:clean",
          title: "Clean Paper",
          status: "completed" as const,
        },
      );
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: "q1",
        answer: "yes",
        citations: [],
        citationStatus: "grounded" as const,
        status: "completed" as const,
        billed: true,
        processedAt: now,
      });
      return { jobId };
    });
    const auth = t.withIdentity(OWNER_IDENTITY);
    const summary = await auth.query(
      api.extraction.queries.retry.getRetryableSummary,
      { jobId },
    );
    expect(summary).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });
});
