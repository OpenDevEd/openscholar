import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  seedCreditsForTest,
} from "../billing/billing.test-support";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { extractionPaperCredits } from "../../lib/pricing";

/**
 * The credit check on startJob: the most the job costs on the model its extractions run on
 * (lib/pricing/estimate.ts), against the balance.
 */

/** The model a person who picked none runs on, at GPT-6 Luna's price, and Claude Sonnet's. */
const LUNA = { input: 0.1, output: 0.5 };
const SONNET = { input: 2, output: 10 };
const perPaper = (questions: number, pdf = false, price = LUNA) =>
  extractionPaperCredits({ model: price }, Array.from({ length: questions }, () => ({ type: "string" })), pdf);

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
      libraryItemCount: 0,
      clerkId: CLERK,
      email: "preflight@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.start",
      enabled: true,
      updatedAt: now,
    });
    await seedCreditsForTest(ctx, {
      userId,
      free: opts.free ?? 0,
      paid: opts.paid,
      now,
    });
    await ctx.db.insert("models", { modelId: SERVER_MODEL_SLUG, name: "Server model", provider: "test", inputPricePerMillion: LUNA.input, outputPricePerMillion: LUNA.output, costMarkup: 1.3, isServed: true, sortOrder: 1, supportedParameters: ["structured_outputs"], syncedAt: 1, createdAt: 1, updatedAt: 1 });
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
  it("throws INSUFFICIENT_CREDITS when the balance is below the most the job costs; no job is inserted", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserFlagsAndCredits(t, { paid: perPaper(1) - 1 });
    const auth = t.withIdentity(IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Poor Job",
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

  it("passes preflight and schedules queue setup when the balance covers the most the job costs", async () => {
    const t = convexTest(schema);
    await seedUserFlagsAndCredits(t, { paid: 100_000 });
    const auth = t.withIdentity(IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "Rich Job",
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
    // Enough for far more than one paper and less than 200: counted as one row, the
    // placeholder would pass.
    await seedUserFlagsAndCredits(t, { paid: 100 * perPaper(1) });
    const auth = t.withIdentity(IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Expanded History",
        bucketItems: [BUCKET_ITEM_HISTORY_200],
        questions: [
          { key: "q1", question: "What is the outcome?", type: "string" },
        ],
        usePdfs: false,
      }),
    ).rejects.toThrow(/200 papers|INSUFFICIENT_CREDITS|credits/i);
  });

  it("zero questions short-circuits the preflight (estimator returns zero; insufficient balance still allowed)", async () => {
    const t = convexTest(schema);
    await seedUserFlagsAndCredits(t, { paid: 0 });
    const auth = t.withIdentity(IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "No Qs",
      bucketItems: [BUCKET_ITEM_HISTORY],
      questions: [],
      usePdfs: false,
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("pending");
    await expectQueueSetupScheduled(t);
  });

  it("PDF-tier estimate is materially higher than abstract-tier for the same job shape", async () => {
    // Just enough for the one paper's two questions from its abstract, not from its PDF.
    const t = convexTest(schema);
    await seedUserFlagsAndCredits(t, { paid: perPaper(2) });
    const auth = t.withIdentity(IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "Abstract",
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
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [
          { key: "q1", question: "Q1?", type: "string" },
          { key: "q2", question: "Q2?", type: "string" },
        ],
        usePdfs: true,
      }),
    ).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);
  });

  it("holds the job to the price of the model it runs on", async () => {
    // Enough for a paper on GPT-6 Luna, a fraction of one on Claude Sonnet.
    const t = convexTest(schema);
    await seedUserFlagsAndCredits(t, { paid: perPaper(1) });
    const auth = t.withIdentity(IDENTITY);
    const start = () =>
      auth.mutation(api.extraction.mutations.startJob, {
        name: "One paper",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [{ key: "q1", question: "What is the outcome?", type: "string" }],
        usePdfs: false,
      });
    await expect(start()).resolves.toMatchObject({ jobId: expect.any(String) });

    await t.run(async (ctx) => {
      const model = (await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique())!;
      await ctx.db.patch("models", model._id, { inputPricePerMillion: SONNET.input, outputPricePerMillion: SONNET.output });
    });
    expect(perPaper(1, false, SONNET)).toBeGreaterThan(perPaper(1));
    await expect(start()).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);
  });
});
