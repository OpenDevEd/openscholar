/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * Plan-03 preflight credit check on startJob. Mirrors screening's preflight
 * at convex/screening/mutations.ts:93-108 but uses extraction's cost
 * estimator (lib/extraction/cost-estimate.ts) instead of the flat
 * ESTIMATED_CREDITS_PER_PAPER constant.
 */

const CLERK = "clerk_extraction_preflight";
const IDENTITY = {
  subject: CLERK,
  tokenIdentifier: `${CLERK}|test`,
};

const BUCKET_ITEM_HISTORY = {
  bucketKey: "history:W1",
  source: "history" as const,
  sourceRefId: "W1",
  title: "Paper One",
  authors: ["A"],
  openalexId: "W1",
  searchFilters: { limit: 1 },
};

async function seedUserFlagsAndCredits(
  t: ReturnType<typeof convexTest>,
  opts: { paid: number; free?: number } = { paid: 0 },
): Promise<{ userId: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "preflight@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.start",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: opts.free ?? 0,
      paidBalance: opts.paid,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return { userId };
  });
}

describe("startJob — pre-flight credit check", () => {
  it("throws INSUFFICIENT_CREDITS when totalAvailable < estimate.high; no job is inserted", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserFlagsAndCredits(t, { paid: 5 }); // way below
    const auth = t.withIdentity(IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Poor Job",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [
          { key: "q1", question: "What is the outcome?", type: "string" },
        ],
        usePdfs: false,
      }),
    ).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);

    // Verify no job row was inserted (all-or-nothing tx semantics).
    const jobs = await t.run((ctx) =>
      ctx.db
        .query("extractionJobs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(jobs).toHaveLength(0);
  });

  it("passes preflight and reaches workflow.start when balance >= estimate.high", async () => {
    // Per public-api-routing.test.ts:112-121, the workflow component is
    // not registered in convex-test; reaching workflow.start (which then
    // throws "Component 'workflow' is not registered") is proof the
    // mutation advanced past every pre-workflow step — including the
    // preflight gate and the extractionJobs insert.
    const t = convexTest(schema);
    await seedUserFlagsAndCredits(t, { paid: 100_000 });
    const auth = t.withIdentity(IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Rich Job",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [
          { key: "q1", question: "What is the outcome?", type: "string" },
          { key: "q2", question: "Second question?", type: "string" },
        ],
        usePdfs: false,
      }),
    ).rejects.toThrow(/workflow/i);
  });

  it("skips preflight when mode=chat (chat jobs don't consume LLM credits up-front)", async () => {
    const t = convexTest(schema);
    const { userId: _userId } = await seedUserFlagsAndCredits(t, { paid: 0 });

    // Enable the chat flag.
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", {
        key: "extraction.chat",
        enabled: true,
        minimumTier: 0,
        updatedAt: Date.now(),
      });
    });

    const auth = t.withIdentity(IDENTITY);
    const { jobId } = (await auth.mutation(api.extraction.mutations.startJob, {
      name: "Free chat",
      mode: "chat",
      bucketItems: [BUCKET_ITEM_HISTORY],
    })) as { jobId: Id<"extractionJobs"> };
    expect(jobId).toBeTruthy();
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.mode).toBe("chat");
    expect(job?.estimatedCredits).toBeUndefined();
  });

  it("zero questions short-circuits the preflight (estimator returns zero; insufficient balance still allowed)", async () => {
    const t = convexTest(schema);
    await seedUserFlagsAndCredits(t, { paid: 0 });
    const auth = t.withIdentity(IDENTITY);

    // Reaching workflow.start proves the preflight was skipped.
    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "No Qs",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [],
        usePdfs: false,
      }),
    ).rejects.toThrow(/workflow/i);
  });

  it("PDF-tier estimate is materially higher than abstract-tier for the same job shape", async () => {
    // Sanity check: usePdfs=true blocks at a higher threshold than
    // usePdfs=false, proving the estimator branch is exercised through
    // the mutation.
    const t = convexTest(schema);
    // Give just enough credits for the 1-paper / 2-question abstract-tier
    // estimate (≤ 24 under current constants) but not enough for the
    // PDF-tier estimate (≥ 100 under current constants).
    await seedUserFlagsAndCredits(t, { paid: 30 });
    const auth = t.withIdentity(IDENTITY);

    // Abstract-tier: passes preflight, reaches workflow.start.
    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Abstract",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [
          { key: "q1", question: "Q1?", type: "string" },
          { key: "q2", question: "Q2?", type: "string" },
        ],
        usePdfs: false,
      }),
    ).rejects.toThrow(/workflow/i);

    // PDF-tier: blocks on the same shape.
    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "PDFs",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [
          { key: "q1", question: "Q1?", type: "string" },
          { key: "q2", question: "Q2?", type: "string" },
        ],
        usePdfs: true,
      }),
    ).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);
  });
});
