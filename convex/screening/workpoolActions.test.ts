// A Screen all paper holds no credits: it runs while the cached balance has some and is
// charged afterwards. While its charge can't reach Autumn, the job's next papers stop.
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { insertJob } from "./createJob.test-support";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";

vi.mock("../../lib/ai/core/batch", () => ({
  processScreeningBatch: async ({ papers }: { papers: Array<{ id: string }> }) => ({
    results: Object.fromEntries(papers.map((paper) => [paper.id, { responses: { "Is this relevant?": true }, confidences: { "Is this relevant?": 0.9 }, confidence: 0.9 }])),
    usages: [{ inputTokens: 100, outputTokens: 10 }],
    trackingByItemId: {},
    errors: [],
  }),
}));

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "clerk_bulk", email: "bulk@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId, free: 100 });
    const jobId = await insertJob(ctx, {
      userId, status: "processing", totalPapers: 2,
      questions: [{ key: "q1", question: "Is this relevant?" }],
      scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }] },
      createdAt: 1, updatedAt: 1,
    });
    const paper = (i: number) => ctx.db.insert("screeningResults", { jobId, openalexId: `https://openalex.org/W${i}`, title: `Paper ${i}`, abstract: "An abstract.", status: "processing", createdAt: 1 });
    return { userId, jobId, first: await paper(1), second: await paper(2) };
  });
}

describe("charging a Screen all paper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("charges it with one track and no hold", async () => {
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { userId, jobId, first } = await seed(t);

    await t.action(internal.screening.workpoolActions.screenPaperAction, { jobId, resultId: first });

    expect(fakeAutumn.calls.map((call) => call.path).filter((path) => path.startsWith("balances."))).toEqual(["balances.track"]);
    expect(fakeAutumn.balance(userId)).toBe(99);
  });

  it("stops the job's next papers while its charge can't reach Autumn", async () => {
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { jobId, first, second } = await seed(t);
    fakeAutumn.failNext = "balances.track";

    await t.action(internal.screening.workpoolActions.screenPaperAction, { jobId, resultId: first });
    expect(await t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())?.balance)).toBe(0);

    await expect(t.action(internal.screening.workpoolActions.screenPaperAction, { jobId, resultId: second })).rejects.toThrow(/INSUFFICIENT_CREDITS/);
    expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.status).toBe("creditsExhausted");
  });

  it("fails the paper when the job's model was retired since, as before", async () => {
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    const { jobId, first } = await seed(t);
    await t.run(async (ctx) => {
      const modelId = await ctx.db.insert("models", {
        modelId: "openai/retired", name: "Retired", provider: "openai", isServed: true,
        inputPricePerMillion: 1, outputPricePerMillion: 1, costMarkup: 1.3, sortOrder: 0, syncedAt: 1, retiredAt: 1, createdAt: 1, updatedAt: 1,
      });
      await ctx.db.patch("screeningJobs", jobId, { serverModelId: modelId });
    });

    await expect(t.action(internal.screening.workpoolActions.screenPaperAction, { jobId, resultId: first })).rejects.toThrow(/VALIDATION_ERROR/);
    expect(fakeAutumn.calls).toHaveLength(0);
  });
});
