// A Screen all paper holds no credits: it runs while the cached balance has some and is
// charged afterwards. While its charge can't reach Autumn, the job's next papers stop.
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { insertJob } from "./createJob.test-support";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import { setupScreeningWorkpool } from "./workpool.test-support";

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

  it("reads no more papers once a job has spent what it may, keeps the one already being read, and ends as stopped at its limit", async () => {
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const { userId, jobId, first, second } = await seed(t);
    // The assistant started it with the person's yes to 3 credits.
    await t.run(async (ctx) => ctx.db.patch("screeningJobs", jobId, { spendCap: 3 }));
    const counted = (credits: number) => t.run(async (ctx) => ctx.db.patch("screeningJobProgress", (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())!._id, { credits }));
    const complete = (resultId: typeof first, returnValue: Record<string, unknown>) =>
      t.mutation(internal.screening.mutations.handleScreeningComplete, { workId: "work", context: { jobId, resultId }, result: { kind: "success", returnValue } });

    // Under it, a paper is read and charged as any other.
    await counted(2);
    const read = await t.action(internal.screening.workpoolActions.screenPaperAction, { jobId, resultId: second });
    expect(read).not.toHaveProperty("capped");
    expect(fakeAutumn.balance(userId)).toBe(99);
    // Once its counted papers have cost that much, the next to come up isn't read, and costs nothing.
    await counted(3);
    const calls = fakeAutumn.calls.length;
    const notRead = await t.action(internal.screening.workpoolActions.screenPaperAction, { jobId, resultId: first });
    expect(notRead).toMatchObject({ capped: true });
    expect(fakeAutumn.calls).toHaveLength(calls);
    // The job runs on until the paper the model was already reading is done: that one is paid for, and its answers are kept.
    expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ status: "processing", capped: true });
    vi.useFakeTimers();
    await complete(first, notRead);
    await complete(second, read);
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();
    const rows = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(5));
    expect(Object.fromEntries(rows.map((row) => [row._id, row.status]))).toEqual({ [first]: "skipped", [second]: "completed" });
    expect(rows.find((row) => row._id === second)).toMatchObject({ outcome: "included" });
    // It ends as a job that stopped at its limit, with credits still to the person's name.
    expect(await t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ status: "creditsExhausted", capped: true });
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
