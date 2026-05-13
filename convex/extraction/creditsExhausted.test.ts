/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupTransactionAggregates } from "../credits/aggregates.test-support";

/**
 * Plan-03 mid-run credits-exhaustion behaviour. Focuses on the
 * updateJobStatus internal mutation — the state-transition primitive that
 * the per-question worker (convex/extraction/workpoolActions.ts
 * extractOneQuestion) invokes from its catch site when recordOneAnswer's
 * deductCredits call throws AI_INSUFFICIENT_CREDITS.
 *
 * End-to-end tests on extractOneQuestion would require registering
 * workflow + rag + ai-model components; following the pattern in
 * public-api-routing.test.ts, we test the mutation primitive directly.
 */

const CLERK = "clerk_credits_exhausted";

async function seedJob(
  t: ReturnType<typeof convexTest>,
  status:
    | "pending"
    | "downloading_pdfs"
    | "indexing"
    | "extracting"
    | "creditsExhausted"
    | "completed"
    | "cancelled",
): Promise<{ userId: Id<"users">; jobId: Id<"extractionJobs"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "ce@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "J",
      sourceType: "history" as const,
      status,
      totalPapers: 3,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId };
  });
}

describe("updateJobStatus — creditsExhausted transition", () => {
  it("flips an extracting job to creditsExhausted and stamps the structured error", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId } = await seedJob(t, "extracting");

    await t.mutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "creditsExhausted",
      error: {
        code: "insufficient_credits",
        message: "Insufficient credits for AI operation",
        at: 1234567,
      },
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("creditsExhausted");
    expect(job?.error?.code).toBe("insufficient_credits");
    expect(job?.error?.message).toBe("Insufficient credits for AI operation");
    expect(job?.error?.at).toBe(1234567);
  });

  it("is idempotent: a second creditsExhausted transition is a no-op (OCC race tolerated)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId } = await seedJob(t, "extracting");

    await t.mutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "creditsExhausted",
      error: {
        code: "insufficient_credits",
        message: "first",
        at: 1,
      },
    });

    // Second call with a different error — should NOT overwrite, since
    // the job is already creditsExhausted.
    await t.mutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "creditsExhausted",
      error: {
        code: "insufficient_credits",
        message: "second",
        at: 2,
      },
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("creditsExhausted");
    // First stamp wins.
    expect(job?.error?.message).toBe("first");
    expect(job?.error?.at).toBe(1);
  });

  it("allows resume back to extracting from creditsExhausted (plan-06 precondition)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId } = await seedJob(t, "creditsExhausted");

    await t.mutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "extracting",
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("extracting");
  });

  it("rejects illegal resume: creditsExhausted → downloading_pdfs is not a valid transition", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId } = await seedJob(t, "creditsExhausted");

    await expect(
      t.mutation(internal.extraction.mutations.results.updateJobStatus, {
        jobId,
        status: "downloading_pdfs",
      }),
    ).rejects.toThrow(/invalid job status transition/);
  });

  it("treats a terminal job as sticky — creditsExhausted cannot roll back a completed job", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId } = await seedJob(t, "completed");

    await t.mutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "creditsExhausted",
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("completed");
  });
});
