/**
 * Plan-07 — getMixedSuccessSummary behavior tests.
 *
 * Seeds mixed-code failures under a job and asserts grouping +
 * retryability flow through the pure summarizer correctly. The
 * summarizer itself is covered in lib/extraction/failures-summary.test.ts;
 * here we pin the Convex wiring: indexed read, taxonomy-sourced flags,
 * and the caller-safe zero shell.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";

const CLERK_OWNER = "clerk_mixed_success_owner";
const OWNER_IDENTITY = {
  tokenIdentifier: `https://test.clerk.local|${CLERK_OWNER}`,
  subject: CLERK_OWNER,
  issuer: "https://test.clerk.local",
};

async function seedJobWithErrors(
  t: ReturnType<typeof convexTest>,
  codes: Array<
    | "rate_limit"
    | "network"
    | "pdf_invalid"
    | "moderation"
    | "context_too_long"
    | "auth"
  >,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK_OWNER,
      email: "owner@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Mixed Success Test",
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:mixed",
      title: "Mixed Paper",
      status: "completed" as const,
    });
    let attempt = 0;
    for (const code of codes) {
      attempt += 1;
      await ctx.db.insert("extractionPaperErrors", {
        paperId,
        jobId,
        attempt,
        at: now + attempt,
        code,
        message: `${code} failure`,
      });
    }
    return { userId, jobId, paperId };
  });
}

describe("getMixedSuccessSummary", () => {
  it("returns zeros for a job with no error rows and no result rows", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithErrors(t, []);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.query(
      api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary,
      { jobId },
    );
    expect(result).toEqual({
      total: 0,
      byCode: [],
      answeredTotal: 0,
      totalQuestions: 0,
    });
  });

  it("groups by code with counts sorted desc, carrying retryable flags from taxonomy", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithErrors(t, [
      "rate_limit",
      "rate_limit",
      "rate_limit",
      "rate_limit",
      "rate_limit", // 5 retryable
      "pdf_invalid",
      "pdf_invalid",
      "pdf_invalid", // 3 permanent
      "moderation", // 1 permanent
    ]);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.query(
      api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary,
      { jobId },
    );
    expect(result.total).toBe(9);
    // Sorted count-desc: rate_limit (5) → pdf_invalid (3) → moderation (1).
    expect(result.byCode).toEqual([
      { code: "rate_limit", count: 5, retryable: true },
      { code: "pdf_invalid", count: 3, retryable: false },
      { code: "moderation", count: 1, retryable: false },
    ]);
  });

  it("reports answeredTotal and totalQuestions from extractionResults rows", async () => {
    const t = convexTest(schema);
    const { jobId, paperId } = await seedJobWithErrors(t, []);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: `q_ok_${i}`,
          answer: "A",
          citations: [],
          citationStatus: "grounded" as const,
          status: "completed" as const,
          billed: true,
          processedAt: now,
        });
      }
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: `q_fail_${i}`,
          answer: null,
          citations: [],
          citationStatus: "extraction_error" as const,
          status: "failed" as const,
          billed: false,
          processedAt: now,
        });
      }
    });

    const auth = t.withIdentity(OWNER_IDENTITY);
    const result = await auth.query(
      api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary,
      { jobId },
    );
    expect(result.answeredTotal).toBe(7);
    expect(result.totalQuestions).toBe(10);
  });

  it("returns zeros for an unowned job (caller-safe)", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithErrors(t, ["rate_limit"]);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_mixed_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });

    const foreign = t.withIdentity({
      tokenIdentifier: "https://test.clerk.local|clerk_mixed_other",
      subject: "clerk_mixed_other",
      issuer: "https://test.clerk.local",
    });
    const result = await foreign.query(
      api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary,
      { jobId },
    );
    expect(result).toEqual({
      total: 0,
      byCode: [],
      answeredTotal: 0,
      totalQuestions: 0,
    });
  });
});
