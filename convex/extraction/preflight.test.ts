import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../credits/aggregates.test-support";

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
  searchFilters: {
    query: "Paper One",
    openAlexQuery: { sort: "relevance_score:desc" },
    limit: 1,
  },
};

const BUCKET_ITEM_HISTORY_200 = {
  ...BUCKET_ITEM_HISTORY,
  bucketKey: "history:W200",
  sourceRefId: "W200",
  searchFilters: {
    query: "Paper One",
    openAlexQuery: { sort: "relevance_score:desc" },
    limit: 200,
  },
};

async function seedUserFlagsAndCredits(
  t: ReturnType<typeof convexTest>,
  opts: { paid: number; free?: number } = { paid: 0 },
): Promise<{ userId: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await seedOrganizationFeatures(ctx, [CLERK], { extraction: true });
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
    await seedCreditsForTest(ctx, {
      userId,
      free: opts.free ?? 0,
      paid: opts.paid,
      now,
    });
    return { userId };
  });
}

async function expectQueueSetupScheduled(
  t: ReturnType<typeof convexTest>,
): Promise<void> {
  const scheduledSetupCount = await t.run(async (ctx) => {
    const scheduledFunctions = await ctx.db.system
      .query("_scheduled_functions")
      .collect();
    return scheduledFunctions.filter((sf) =>
      sf.name.includes("setupExtractionQueueJob"),
    ).length;
  });
  expect(scheduledSetupCount).toBeGreaterThan(0);
}

describe("startJob — pre-flight credit check", () => {
  it("throws INSUFFICIENT_CREDITS when totalAvailable < estimate.high; no job is inserted", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserFlagsAndCredits(t, { paid: 3 }); // way below new HIGH=5
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

  it("passes preflight and schedules queue setup when balance >= estimate.high", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await seedUserFlagsAndCredits(t, { paid: 100_000 });
    const auth = t.withIdentity(IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "Rich Job",
      mode: "extraction",
      bucketItems: [BUCKET_ITEM_HISTORY],
      questions: [
        { key: "q1", question: "What is the outcome?", type: "string" },
        { key: "q2", question: "Second question?", type: "string" },
      ],
      usePdfs: false,
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("pending");
    await expectQueueSetupScheduled(t);
  });

  it("counts saved-search history placeholders by expanded paper count, not row count", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    // 200 papers × 1 Q × ABSTRACT_Q_CREDIT_HIGH=5 = 1000 estimate. Seed
    // below that so the expanded count drives a real preflight block;
    // if the placeholder were counted as 1 row the estimate would be 5
    // and this would pass preflight.
    await seedUserFlagsAndCredits(t, { paid: 500 });
    const auth = t.withIdentity(IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Expanded History",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY_200],
        questions: [
          { key: "q1", question: "What is the outcome?", type: "string" },
        ],
        usePdfs: false,
      }),
    ).rejects.toThrow(/200 papers|INSUFFICIENT_CREDITS|credits/i);
  });

  it("skips preflight when mode=chat (chat jobs don't consume LLM credits up-front)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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
    setupTransactionAggregates(t);
    await seedUserFlagsAndCredits(t, { paid: 0 });
    const auth = t.withIdentity(IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "No Qs",
      mode: "extraction",
      bucketItems: [BUCKET_ITEM_HISTORY],
      questions: [],
      usePdfs: false,
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("pending");
    await expectQueueSetupScheduled(t);
  });

  it("PDF-tier estimate is materially higher than abstract-tier for the same job shape", async () => {
    // Sanity check: usePdfs=true blocks at a higher threshold than
    // usePdfs=false, proving the estimator branch is exercised through
    // the mutation.
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    // Give just enough credits for the 1-paper / 2-question abstract-tier
    // estimate (= 10 under current constants: 2 × ABSTRACT_Q_CREDIT_HIGH=5)
    // but not enough for the PDF-tier estimate (= 101.5 under current
    // constants: 1 × INDEX_PDF_CREDIT=1.5 + 2 × PDF_Q_CREDIT_HIGH=50).
    await seedUserFlagsAndCredits(t, { paid: 30 });
    const auth = t.withIdentity(IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "Abstract",
      mode: "extraction",
      bucketItems: [BUCKET_ITEM_HISTORY],
      questions: [
        { key: "q1", question: "Q1?", type: "string" },
        { key: "q2", question: "Q2?", type: "string" },
      ],
      usePdfs: false,
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("pending");
    await expectQueueSetupScheduled(t);

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
