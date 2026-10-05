import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
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
): Promise<{ userId: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await seedOrganizationFeatures(ctx, [TEST_CLERK], { extraction: true });
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: TEST_CLERK,
      email: "full-flow@test.com",
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
    await ctx.db.insert("featureFlags", {
      key: "extraction.pdf",
      enabled: false,
      updatedAt: now,
    });

    await seedCreditsForTest(ctx, {
      userId,
      paid: STARTING_CREDITS,
      now,
    });
    return { userId };
  });
}

describe("extraction full flow with mocked provider I/O", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockProviderGenerate.mockClear();
    networkFetch.mockClear();
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch(networkFetch));
    previousEnv.posthogKey = process.env.POSTHOG_KEY;
    previousEnv.nextPublicPosthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  afterEach(() => {
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

  it("runs a multi-question job through queue/workpool, settles one paper charge, and never calls a provider network", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { userId } = await seedUserFlagsAndCredits(t);
    const auth = t.withIdentity(TEST_IDENTITY);
    expect(fakeAutumn.balance(userId)).toBe(STARTING_CREDITS);

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
      const [papers, results, queueRows, usage] = await Promise.all([
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
          .query("billingUsage")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .collect(),
      ]);
      return { papers, results, queueRows, usage };
    });

    expect(state.papers).toHaveLength(1);
    expect(state.papers[0].status).toBe("completed");
    expect(state.papers[0].creditsUsed).toBe(EXPECTED_ACTUAL_CREDITS);

    expect(state.results).toHaveLength(EXPECTED_QUESTION_COUNT);
    expect(
      state.results
        .map((result) => ({
          questionKey: result.questionKey,
          answer: result.answer,
          confidence: result.confidence,
          modelConfidence: result.modelConfidence,
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
        modelConfidence: 0.92,
        citationStatus: "best_effort",
        status: "completed",
        billed: true,
        creditsUsed: EXPECTED_ACTUAL_CREDITS_PER_QUESTION,
        pdfContentUsed: false,
      },
      {
        questionKey: "sample_size",
        answer: "Mocked extraction answer",
        confidence: 0.92,
        modelConfidence: 0.92,
        citationStatus: "best_effort",
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

    expect(
      state.usage.map((row) => ({ kind: row.kind, credits: row.credits })),
    ).toEqual([{ kind: "extraction", credits: EXPECTED_ACTUAL_CREDITS }]);
    expect(fakeAutumn.balance(userId)).toBe(
      STARTING_CREDITS - EXPECTED_ACTUAL_CREDITS,
    );
    expect(fakeAutumn.locks.size).toBe(0);
  });
  it("holds the figure an extraction started from a chat was approved up to, charges its papers under it, and confirms it once with their sum", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { userId } = await seedUserFlagsAndCredits(t);
    const abstract = "This abstract is intentionally long enough to be processed without a PDF. It states the intervention improved retention and gives the mocked extraction flow source material.";
    // Two saved papers in a collection: the set the assistant names.
    const collectionId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("collections", { userId, name: "Trials", itemCount: 2, createdAt: now, updatedAt: now });
      for (const n of [1, 2]) {
        const libraryItemId = await ctx.db.insert("libraryItems", { userId, openalexId: `https://openalex.org/W${n}`, title: `Trial ${n}`, authors: ["Fixture Author"], abstract, searchableText: `Trial ${n}`, savedAt: now + n, updatedAt: now });
        await ctx.db.insert("libraryItemCollections", { userId, collectionId: id, libraryItemId, assignedAt: now + n });
      }
      return id;
    });
    const calls = (path: string) => fakeAutumn.calls.filter((call) => call.path === path);

    // As the assistant runs it once the person has said yes to "up to 20 credits": two papers, two questions, five a question at most.
    const { jobId } = await t.action(internal.extraction.start.extractForAssistant, {
      userId,
      approved: true,
      approvedCredits: 20,
      name: "Trials, from a chat",
      set: { kind: "collection", collectionId },
      first: 1,
      last: 2,
      questions: [{ question: "What was the main finding?", type: "string" }, { question: "What sample size was reported?", type: "string" }],
    });
    // The figure is held, and nothing else: the job's papers hold nothing of their own.
    expect(calls("balances.check").map((call) => (call.body as { required_balance: number }).required_balance)).toEqual([20]);

    // The job runs over the next minutes. Time isn't jumped to the end of the hold, a day away: left standing that long, it settles itself.
    for (let second = 0; second < 600; second += 1) {
      vi.advanceTimersByTime(1_000);
      await t.finishInProgressScheduledFunctions();
    }

    const state = await t.run(async (ctx) => ({
      job: await ctx.db.get("extractionJobs", jobId),
      papers: await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect(),
      usage: await ctx.db.query("billingUsage").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect(),
      holds: await ctx.db.query("billingHolds").collect(),
    }));
    expect(state.job).toMatchObject({ status: "completed", spendCap: 20 });
    expect(state.papers.map((paper) => paper.status)).toEqual(["completed", "completed"]);
    // Each paper is on the ledger, under the job's hold. Autumn was charged once, for both, when the job ended.
    expect(state.usage.map((row) => ({ credits: row.credits, under: row.under }))).toEqual([1, 2].map(() => ({ credits: EXPECTED_ACTUAL_CREDITS, under: state.job!.spendHold })));
    expect(calls("balances.check")).toHaveLength(1);
    expect(calls("balances.track")).toHaveLength(0);
    expect(calls("balances.finalize").map((call) => call.body)).toEqual([{ lock_id: state.job!.spendHold, action: "confirm", override_value: 2 * EXPECTED_ACTUAL_CREDITS }]);
    expect(fakeAutumn.balance(userId)).toBe(STARTING_CREDITS - 2 * EXPECTED_ACTUAL_CREDITS);
    expect(fakeAutumn.locks.size).toBe(0);
    expect(state.holds).toEqual([]);
  });
});
