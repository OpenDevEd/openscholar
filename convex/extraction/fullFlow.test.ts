/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest } from "../credits/aggregates.test-support";
import { setupAggregates } from "./aggregates.test-support";
import { setupExtractionPaperWorkpool } from "./queue/workpool.test-support";

const {
  mockProviderGenerate,
  networkFetch,
  previousEnv,
} = vi.hoisted(() => ({
  mockProviderGenerate: vi.fn(() => undefined),
  networkFetch: vi.fn(async () => {
    throw new Error("Unexpected network fetch in extraction full-flow test");
  }),
  previousEnv: {
    creditsPerUsd: undefined as string | undefined,
    posthogKey: undefined as string | undefined,
    nextPublicPosthogKey: undefined as string | undefined,
  },
}));

// The extraction run path resolves its model+pricing through the shared chat
// resolver now (per-user server model). Mock that to the deterministic fixture.
vi.mock("../chat/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chat/provider")>();
  const { MockLanguageModelV3 } = await import("ai/test");

  return {
    ...actual,
    resolveOpenRouterModel: async () => ({
      modelSlug: "mock/extraction-model",
      pricing: { input: 0.1, output: 0.1 },
      model: new MockLanguageModelV3({
        provider: "mock-extraction-provider",
        modelId: "mock-extraction-model",
        doGenerate: async () => {
          mockProviderGenerate();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  answer: "Mocked extraction answer",
                  confidence: 0.92,
                  reasoning: "Deterministic fixture from the mocked provider.",
                  supportEvidenceIds: [],
                }),
              },
            ],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: {
              inputTokens: {
                total: 1_000,
                noCache: 1_000,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 500,
                text: 500,
                reasoning: undefined,
              },
            },
            warnings: [],
          };
        },
      }),
    }),
  };
});

const TEST_CLERK = "clerk_extraction_full_flow";
const TEST_IDENTITY = {
  subject: TEST_CLERK,
  tokenIdentifier: `${TEST_CLERK}|test`,
};
const STARTING_CREDITS = 100_000;
const EXPECTED_ACTUAL_CREDITS_PER_QUESTION = 2;
const EXPECTED_QUESTION_COUNT = 2;
const EXPECTED_ACTUAL_CREDITS =
  EXPECTED_ACTUAL_CREDITS_PER_QUESTION * EXPECTED_QUESTION_COUNT;

async function seedUserFlagsAndCredits(
  t: ReturnType<typeof convexTest>,
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: TEST_CLERK,
      email: "full-flow@test.com",
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
    await ctx.db.insert("featureFlags", {
      key: "extraction.pdf",
      enabled: false,
      minimumTier: 0,
      updatedAt: now,
    });

    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      paid: STARTING_CREDITS,
      now,
    });
    return { userId, creditsId };
  });
}

describe("extraction full flow with mocked provider I/O", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockProviderGenerate.mockClear();
    networkFetch.mockClear();
    vi.stubGlobal("fetch", networkFetch);
    previousEnv.creditsPerUsd = process.env.CREDITS_PER_USD;
    previousEnv.posthogKey = process.env.POSTHOG_KEY;
    previousEnv.nextPublicPosthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    process.env.CREDITS_PER_USD = "10000";
    delete process.env.POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  afterEach(() => {
    if (previousEnv.creditsPerUsd === undefined) {
      delete process.env.CREDITS_PER_USD;
    } else {
      process.env.CREDITS_PER_USD = previousEnv.creditsPerUsd;
    }
    if (previousEnv.posthogKey === undefined) {
      delete process.env.POSTHOG_KEY;
    } else {
      process.env.POSTHOG_KEY = previousEnv.posthogKey;
    }
    if (previousEnv.nextPublicPosthogKey === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = previousEnv.nextPublicPosthogKey;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs a multi-question job through queue/workpool, settles one paper debit, and never calls a provider network", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    setupExtractionPaperWorkpool(t);
    await seedUserFlagsAndCredits(t);
    const auth = t.withIdentity(TEST_IDENTITY);

    const beforeBalance = await auth.query(api.credits.queries.getMyBalance);
    expect(beforeBalance?.total).toBe(STARTING_CREDITS);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "Full Flow E2E",
      mode: "extraction",
      bucketItems: [
        {
          bucketKey: "upload:full-flow-paper",
          source: "upload",
          sourceRefId: "full-flow-paper",
          title: "Abstract-only paper",
          authors: ["Fixture Author"],
          year: 2024,
          openalexId: "full-flow-paper",
          abstract:
            "This abstract is intentionally long enough to be processed without a PDF. It states the intervention improved retention and gives the mocked extraction flow source material.",
        },
      ],
      questions: [
        {
          key: "main_finding",
          question: "What was the main finding?",
          type: "string",
        },
        {
          key: "sample_size",
          question: "What sample size was reported?",
          type: "string",
        },
      ],
      usePdfs: false,
    });

    await t.finishAllScheduledFunctions(vi.runOnlyPendingTimers.bind(vi));
    await t.finishAllScheduledFunctions(vi.runOnlyPendingTimers.bind(vi));

    const progress = await auth.query(
      api.extraction.queries.subscribeToJobProgress,
      { jobId },
    );
    expect(progress.status).toBe("ok");
    if (progress.status !== "ok") throw new Error("unexpected query status");
    expect(progress.job.status).toBe("completed");
    expect(progress.totalPapers).toBe(1);
    expect(progress.processedPapers).toBe(1);
    expect(progress.failedPapers).toBe(0);

    const state = await t.run(async (ctx) => {
      const [papers, results, queueRows, transactions] = await Promise.all([
        ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .collect(),
        ctx.db
          .query("extractionResults")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .collect(),
        ctx.db
          .query("extractionPaperQueue")
          .withIndex("by_job_and_status", (q) =>
            q.eq("jobId", jobId).eq("status", "completed"),
          )
          .collect(),
        ctx.db
          .query("creditTransactions")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .collect(),
      ]);
      return { papers, results, queueRows, transactions };
    });

    expect(state.papers).toHaveLength(1);
    expect(state.papers[0].status).toBe("completed");
    expect(state.papers[0].questionsBilled).toBe(true);
    expect(state.papers[0].admittedEstimateCredits).toBeUndefined();
    expect(state.papers[0].admittedRunEpoch).toBeUndefined();
    expect(state.papers[0].creditsUsed).toBe(EXPECTED_ACTUAL_CREDITS);

    expect(state.results).toHaveLength(EXPECTED_QUESTION_COUNT);
    expect(
      state.results
        .map((result) => ({
          questionKey: result.questionKey,
          answer: result.answer,
          confidence: result.confidence,
          citationStatus: result.citationStatus,
          status: result.status,
          billed: result.billed,
          creditsUsed: result.creditsUsed,
          pdfContentUsed: result.pdfContentUsed,
        }))
        .sort((a, b) => a.questionKey.localeCompare(b.questionKey)),
    ).toEqual([
      {
        questionKey: "main_finding",
        answer: "Mocked extraction answer",
        confidence: 0.92,
        citationStatus: "grounded",
        status: "completed",
        billed: true,
        creditsUsed: EXPECTED_ACTUAL_CREDITS_PER_QUESTION,
        pdfContentUsed: false,
      },
      {
        questionKey: "sample_size",
        answer: "Mocked extraction answer",
        confidence: 0.92,
        citationStatus: "grounded",
        status: "completed",
        billed: true,
        creditsUsed: EXPECTED_ACTUAL_CREDITS_PER_QUESTION,
        pdfContentUsed: false,
      },
    ]);

    expect(state.queueRows).toHaveLength(1);
    expect(state.queueRows[0].status).toBe("completed");

    expect(mockProviderGenerate).toHaveBeenCalledTimes(EXPECTED_QUESTION_COUNT);
    expect(networkFetch).not.toHaveBeenCalled();

    const transactionSummary = state.transactions
      .map((row) => ({
        type: row.type,
        amount: row.amount,
        billingType: row.billingType,
      }))
      .sort((a, b) => a.type.localeCompare(b.type));
    expect(transactionSummary).toEqual([
      {
        type: "usage",
        amount: -EXPECTED_ACTUAL_CREDITS,
        billingType: "extraction_llm",
      },
    ]);

    const afterBalance = await auth.query(api.credits.queries.getMyBalance);
    expect(afterBalance?.total).toBe(
      STARTING_CREDITS - EXPECTED_ACTUAL_CREDITS,
    );
  });
});
