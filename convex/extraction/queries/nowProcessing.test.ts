/**
 * Plan-07 — getNowProcessing behavior tests.
 *
 * Covers the three shapes from the plan's test plan:
 *   - 0 in-flight → null
 *   - 1 in-flight → that paper
 *   - 3 in-flight → earliest startedAt wins
 *
 * Plus the caller-safe invariant (unowned/missing job → null) matching
 * the queries/costs.ts pattern.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";

const CLERK_OWNER = "clerk_now_processing_owner";
const OWNER_IDENTITY = {
  tokenIdentifier: `https://test.clerk.local|${CLERK_OWNER}`,
  subject: CLERK_OWNER,
  issuer: "https://test.clerk.local",
};

async function seedJob(t: ReturnType<typeof convexTest>) {
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
      name: "Now Processing Test",
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 3,
      processedPapers: 0,
      failedPapers: 0,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId, now };
  });
}

describe("getNowProcessing", () => {
  it("returns null when zero papers are in the extracting state", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:pending",
        title: "Pending Paper",
        status: "pending" as const,
      });
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:done",
        title: "Done Paper",
        status: "completed" as const,
      });
    });
    const result = await t
      .withIdentity(OWNER_IDENTITY)
      .query(api.extraction.queries.nowProcessing.getNowProcessing, { jobId });
    expect(result).toBeNull();
  });

  it("returns the paper title when exactly one paper is in-flight", async () => {
    const t = convexTest(schema);
    const { jobId, now } = await seedJob(t);
    const paperId = await t.run(async (ctx) => {
      return await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:alpha",
        title: "Attention is all you need",
        status: "extracting" as const,
        startedAt: now,
      });
    });

    const result = await t
      .withIdentity(OWNER_IDENTITY)
      .query(api.extraction.queries.nowProcessing.getNowProcessing, { jobId });
    expect(result).toEqual({
      paperId,
      paperTitle: "Attention is all you need",
      startedAt: now,
    });
  });

  it("returns the earliest-started paper when 3 are in-flight concurrently", async () => {
    const t = convexTest(schema);
    const { jobId, now } = await seedJob(t);
    const earliestId = await t.run(async (ctx) => {
      // Oldest — this one must win. startedAt deltas are intentionally
      // tiny so the contract is about relative order, not magnitude.
      const earliest = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:early",
        title: "First In",
        status: "extracting" as const,
        startedAt: now - 1000,
      });
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:mid",
        title: "Middle",
        status: "extracting" as const,
        startedAt: now - 500,
      });
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:late",
        title: "Latest",
        status: "extracting" as const,
        startedAt: now,
      });
      return earliest;
    });

    const result = await t
      .withIdentity(OWNER_IDENTITY)
      .query(api.extraction.queries.nowProcessing.getNowProcessing, { jobId });
    expect(result).not.toBeNull();
    expect(result?.paperId).toBe(earliestId);
    expect(result?.paperTitle).toBe("First In");
    expect(result?.startedAt).toBe(now - 1000);
  });

  it("returns null for an unowned job (caller-safe; no existence leak)", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
      // Seed an in-flight paper so the null cannot be blamed on "0 rows".
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:hidden",
        title: "Should Not Leak",
        status: "extracting" as const,
      });
    });

    const foreign = t.withIdentity({
      tokenIdentifier: "https://test.clerk.local|clerk_other",
      subject: "clerk_other",
      issuer: "https://test.clerk.local",
    });
    const result = await foreign.query(
      api.extraction.queries.nowProcessing.getNowProcessing,
      { jobId },
    );
    expect(result).toBeNull();
  });
});
