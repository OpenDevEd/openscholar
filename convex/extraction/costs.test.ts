/**
 * The job cost badge reads creditsAgg, which every settled charge against the
 * job feeds (convex/billing/charge.ts recordUsage). Deleting the job clears it.
 */

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { creditsAgg } from "./aggregates";

const CLERK_ID = "clerk_job_costs";

async function seedJob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: CLERK_ID,
      email: "job-costs@test.local",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 1,
      name: "Job cost fixture",
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId };
  });
}

async function charge(
  t: ReturnType<typeof convexTest>,
  args: { userId: Id<"users">; jobId: Id<"extractionJobs">; chargeId: string; credits: number },
) {
  return await t.mutation(internal.billing.charge.recordUsage, {
    ...args,
    kind: "extraction",
    description: "Extraction (2 questions)",
    createdAt: Date.now(),
  });
}

const jobCost = (t: ReturnType<typeof convexTest>, jobId: Id<"extractionJobs">) =>
  t
    .withIdentity({ tokenIdentifier: CLERK_ID, subject: CLERK_ID, issuer: "test" })
    .query(api.extraction.queries.costs.getJobCost, { jobId });

describe("job credit totals", () => {
  it("adds every settled charge against the job, counting a repeated charge once", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId, jobId } = await seedJob(t);

    expect(await charge(t, { userId, jobId, chargeId: "extraction:a", credits: 7 })).toBe(true);
    expect(await charge(t, { userId, jobId, chargeId: "extraction:b", credits: 5 })).toBe(true);
    expect(await charge(t, { userId, jobId, chargeId: "extraction:a", credits: 7 })).toBe(false);
    // The ledger worker adds them, a moment after.
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    expect((await jobCost(t, jobId)).total).toBe(12);
  });

  it("clears the total when the job is deleted, and keeps it clear of charges counted after", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId, jobId } = await seedJob(t);
    await charge(t, { userId, jobId, chargeId: "extraction:a", credits: 7 });
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    // A charge the worker hasn't counted when the job goes.
    await charge(t, { userId, jobId, chargeId: "extraction:b", credits: 5 });

    await t.mutation(internal.extraction.mutations.internal.admin.deleteExtractionInternal, {
      jobId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    expect(await t.run((ctx) => creditsAgg.sum(ctx, { namespace: jobId }))).toBe(0);
  });
});
