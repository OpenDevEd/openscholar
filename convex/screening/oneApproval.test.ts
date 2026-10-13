import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { setupScreeningWorkpool } from "./workpool.test-support";
import { madeBy } from "../workspaces/actor.test-support";
import { personalWorkspaceOf } from "../workspaces/personal";
import { paperOf } from "../lib/paperRef.test-support";

// Each paper answered for 1 credit's worth of tokens.
vi.mock("../../lib/ai/core/batch", () => ({
  processScreeningBatch: async ({ papers }: { papers: Array<{ id: string }> }) => ({
    results: Object.fromEntries(papers.map((paper) => [paper.id, { responses: { "Is this relevant?": true }, confidences: { "Is this relevant?": 0.9 }, confidence: 0.9 }])),
    usages: [{ inputTokens: 100, outputTokens: 10 }],
    trackingByItemId: {},
    errors: [],
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("runs a request as one job under the one figure the person approved: one hold, charged once, and one end told to the chat", async () => {
  fakeAutumn.reset();
  vi.stubGlobal("fetch", fakeAutumnFetch());
  vi.useFakeTimers();
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const { userId, collectionId, threadId, stepId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "clerk_one_approval", email: "one@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    await seedCreditsForTest(ctx, { userId, free: 100 });
    const collectionId = await ctx.db.insert("collections", { ...(await madeBy(ctx, userId)), name: "Trials", sortName: ("Trials").toLowerCase(), itemCount: 2, createdAt: 1, updatedAt: 1 });
    for (const n of [1, 2]) {
      const libraryItemId = await ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), ...paperOf(`https://openalex.org/W${n}`), title: `Trial ${n}`, authors: [], abstract: "An abstract.", searchableText: `Trial ${n}`, savedAt: n, updatedAt: 1 });
      await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId, assignedAt: n });
    }
    // The chat and the step of its reply that started the screening.
    const threadId = await ctx.db.insert("assistantThreads", { ...(await madeBy(ctx, userId)), title: "Screening", agentThreadId: "agent", lastMessageAt: 1, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "assistant.enabled", enabled: true, updatedAt: 1 });
    const stepId = await ctx.db.insert("assistantSteps", { threadId, workspaceId: (await ctx.db.get("assistantThreads", threadId))!.workspaceId, order: 0, userId, toolCallId: "screen", path: "screening/start:screen", input: "{}", status: "running", startedAt: 1 });
    return { userId, collectionId, threadId, stepId };
  });
  const calls = (path: string) => fakeAutumn.calls.filter((call) => call.path === path);

  // As the assistant runs it once the person has said yes to "up to 10 credits" for both papers.
  const started = await t.action(internal.screening.start.screenForAssistant, {
    userId, approved: true, approvedCredits: 10, fromStep: stepId,
    set: { kind: "collection", collectionId }, first: 1, last: 2,
    questions: [{ key: "q1", question: "Is this relevant?" }],
    scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], minimumScore: 1, starThresholds: [{ minScore: 0, stars: 1 }] },
    saveTo: { kind: "none" },
  });
  // The step ends with what the action returned: the job.
  await t.run(async (ctx) => {
    await ctx.db.patch("assistantSteps", stepId, { status: "done", endedAt: 2 });
    await ctx.db.insert("assistantStepResults", { stepId, threadId, result: JSON.stringify(started) });
  });
  for (let second = 0; second < 240; second += 1) {
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
  }

  const jobs = await t.run(async (ctx) => { const workspaceId = await personalWorkspaceOf(ctx, userId); return ctx.db.query("screeningJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("asc").take(5); });
  // One job for the whole request, done.
  expect(jobs.map(({ status, first, last, totalPapers }) => ({ status, first, last, totalPapers }))).toEqual([{ status: "completed", first: 1, last: 2, totalPapers: 2 }]);
  expect(jobs[0]).toMatchObject({ spendCap: 10, chatStep: stepId });
  // Held once, charged once for both papers when the job ended, and the hold is gone.
  expect(calls("balances.check").map((call) => (call.body as { required_balance: number }).required_balance)).toEqual([10]);
  expect(calls("balances.finalize").map((call) => call.body)).toEqual([{ lock_id: jobs[0].spendHold, action: "confirm", override_value: 2 }]);
  expect(fakeAutumn.balance(userId)).toBe(98);
  expect(await t.run((ctx) => ctx.db.query("billingHolds").collect())).toEqual([]);
  // Its card: both papers, against the 10 approved.
  const card = await t.withIdentity({ subject: "clerk_one_approval" }).query(api.assistant.jobs.card, { threadId, stepId });
  expect(card?.card).toMatchObject({ kind: "screening", jobId: jobs[0]._id, status: "completed", total: 2, credits: 2, cap: 10 });
  // The chat hears the job ended, once.
  expect((await t.run((ctx) => ctx.db.query("assistantJobEnds").collect())).map(({ jobId, status }) => ({ jobId, status }))).toEqual([{ jobId: jobs[0]._id, status: "completed" }]);
  // Its dock row went when it ended.
  expect(await t.run((ctx) => ctx.db.query("assistantJobs").collect())).toEqual([]);
});
