import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { setupExtractionPaperWorkpool } from "./workpool.test-support";
import { fakeAutumn, installFakeAutumn, seedCreditsForTest } from "../../billing/billing.test-support";

async function seedLeasedPaperQueueItem(
  t: ReturnType<typeof convexTest>,
  jobStatus: "extracting" | "paused" | "creditsExhausted" | "cancelled",
): Promise<{
  jobId: Id<"extractionJobs">;
  queueId: Id<"extractionPaperQueue">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_worker_${now}`,
      email: "worker@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: jobStatus,
      runEpoch: 0,
      totalPapers: 1,
      name: "Worker Test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:worker",
      title: "Worker Paper",
      status: "pending" as const,
      processable: true,
    });
    const queueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "leased" as const,
      priority: 0,
      attempt: 0,
      leaseOwner: "test-worker",
      leasedAt: now,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, queueId };
  });
}

async function seedLeasedUnprocessablePaper(
  t: ReturnType<typeof convexTest>,
): Promise<{
  paperId: Id<"extractionPapers">;
  queueId: Id<"extractionPaperQueue">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_worker_unprocessable_${now}`,
      email: "worker-unprocessable@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      runEpoch: 0,
      totalPapers: 1,
      name: "Worker Unprocessable Test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:worker-unprocessable",
      title: "Worker Unprocessable Paper",
      status: "pending" as const,
      processable: true,
    });
    const queueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "leased" as const,
      priority: 0,
      attempt: 0,
      leaseOwner: "test-worker",
      leasedAt: now,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    return { paperId, queueId };
  });
}

async function seedAlreadyAnsweredPaper(
  t: ReturnType<typeof convexTest>,
  opts: { credits?: number; answered?: boolean } = {},
): Promise<{
  userId: Id<"users">;
  jobId: Id<"extractionJobs">;
  paperId: Id<"extractionPapers">;
  queueId: Id<"extractionPaperQueue">;
}> {
  const { credits = 100_000, answered = true } = opts;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_worker_answered_${now}`,
      email: "worker-answered@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await seedCreditsForTest(ctx, { userId, paid: credits, now });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      runEpoch: 0,
      totalPapers: 1,
      name: "Worker Answered Test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:worker-answered",
      title: "Worker Answered Paper",
      status: "pending" as const,
      processable: true,
      abstract:
        "This abstract is long enough to pass the extraction processability gate for worker tests.",
      isIndexed: true,
      indexingBilled: true,
    });
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What was studied?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    if (answered) {
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: "q1",
        answer: "Already answered",
        citations: [],
        citationStatus: "grounded" as const,
        status: "completed" as const,
        billed: true,
        attemptCount: 1,
        creditsUsed: 0,
        processedAt: now,
      });
    }
    const queueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "leased" as const,
      priority: 0,
      attempt: 0,
      leaseOwner: "test-worker",
      leasedAt: now,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId, paperId, queueId };
  });
}

async function seedQueueRefillJob(
  t: ReturnType<typeof convexTest>,
): Promise<{
  completedPaperId: Id<"extractionPapers">;
  completedQueueId: Id<"extractionPaperQueue">;
  activeQueueId: Id<"extractionPaperQueue">;
  pendingQueueId: Id<"extractionPaperQueue">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_worker_refill_${now}`,
      email: "worker-refill@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await seedCreditsForTest(ctx, { userId, paid: 100_000, now });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      runEpoch: 0,
      totalPapers: 3,
      name: "Worker Refill Test",
      createdAt: now,
      updatedAt: now,
    });

    const completedPaperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:worker-refill-completed",
      title: "Worker Refill Completed Paper",
      status: "pending" as const,
      processable: true,
      abstract:
        "This abstract is long enough to pass the extraction processability gate for queue refill tests.",
      isIndexed: true,
      indexingBilled: true,
    });
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What was studied?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    await ctx.db.insert("extractionResults", {
      jobId,
      paperId: completedPaperId,
      questionKey: "q1",
      answer: "Already answered",
      citations: [],
      citationStatus: "grounded" as const,
      status: "completed" as const,
      billed: true,
      attemptCount: 1,
      creditsUsed: 0,
      processedAt: now,
    });

    const activePaperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:worker-refill-active",
      title: "Worker Refill Active Paper",
      status: "extracting" as const,
      processable: true,
    });
    const pendingPaperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:worker-refill-pending",
      title: "Worker Refill Pending Paper",
      status: "pending" as const,
      processable: true,
    });

    const completedQueueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId: completedPaperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "leased" as const,
      priority: 0,
      attempt: 0,
      leaseOwner: "test-worker",
      leasedAt: now,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const activeQueueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId: activePaperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "running" as const,
      priority: 0,
      attempt: 0,
      leaseOwner: "test-active",
      leasedAt: now,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const pendingQueueId = await ctx.db.insert("extractionPaperQueue", {
      jobId,
      userId,
      paperId: pendingPaperId,
      runEpoch: 0,
      kind: "initial" as const,
      status: "pending" as const,
      priority: 0,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      completedPaperId,
      completedQueueId,
      activeQueueId,
      pendingQueueId,
    };
  });
}

describe("extraction paper queue worker", () => {
  beforeEach(() => installFakeAutumn());
  afterEach(() => vi.unstubAllGlobals());

  it("pauses the job and parks the paper when its credits can't be reserved", async () => {
    const t = convexTest(schema);
    const { userId, jobId, paperId, queueId } = await seedAlreadyAnsweredPaper(t, {
      credits: 2,
      answered: false,
    });

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId,
      expectedEpoch: 0,
      paperConcurrency: 1,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const [job, paper, queueRow, results] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(jobId),
        ctx.db.get(paperId),
        ctx.db.get(queueId),
        ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paperId))
          .collect(),
      ]),
    );
    expect(job?.status).toBe("creditsExhausted");
    expect(job?.error?.code).toBe("insufficient_credits");
    expect(queueRow?.status).toBe("parked");
    expect(paper?.status).toBe("pending");
    expect(results).toHaveLength(0);
    expect(fakeAutumn.balance(userId)).toBe(2);
    expect(fakeAutumn.locks.size).toBe(0);
  });

  it("stops a job at the credits it was allowed, taking nothing more for the paper, and gives its hold back when nothing was spent under it", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    const { userId, jobId, paperId, queueId } = await seedAlreadyAnsweredPaper(t, { credits: 1_000, answered: false });
    // Approved up to 3 credits from a chat, and held: one question holds 5 at most, so there's no room for this paper.
    await t.mutation(internal.billing.charge.hold, { userId, chargeId: "extraction-job:1", credits: 3, expiresAt: Date.now() + 86_400_000, spend: true });
    await fetch("https://autumn.test/v1/balances.check", { method: "POST", body: JSON.stringify({ customer_id: userId, feature_id: "credits", required_balance: 3, lock: { enabled: true, lock_id: "extraction-job:1", expires_at: Date.now() + 86_400_000 } }) });
    await t.run((ctx) => ctx.db.patch(jobId, { spendHold: "extraction-job:1", spendCap: 3 }));

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, { queueId, expectedEpoch: 0, paperConcurrency: 1, questionConcurrency: 1, pdfEnabled: false });

    const [job, paper, queueRow] = await t.run((ctx) => Promise.all([ctx.db.get(jobId), ctx.db.get(paperId), ctx.db.get(queueId)]));
    expect(job).toMatchObject({ status: "creditsExhausted", error: { message: expect.stringContaining("3 credits it was allowed") } });
    expect(queueRow?.status).toBe("parked");
    expect(paper?.status).toBe("pending");
    // The paper held nothing of its own: the one hold is the job's.
    expect(fakeAutumn.calls.filter((call) => call.path === "balances.check")).toHaveLength(1);

    // The job stopped, so its hold is settled: nothing was spent under it, and the person has their credits back.
    await t.finishAllScheduledFunctions(vi.runOnlyPendingTimers.bind(vi));
    expect(fakeAutumn.locks.size).toBe(0);
    expect(fakeAutumn.balance(userId)).toBe(1_000);
    expect(await t.run((ctx) => ctx.db.query("billingHolds").collect())).toEqual([]);
    vi.useRealTimers();
  });

  it("stops a job whose hold no longer stands, as one that outlasted it, and doesn't charge its papers past what was approved", async () => {
    const t = convexTest(schema);
    const { userId, jobId, queueId } = await seedAlreadyAnsweredPaper(t, { credits: 1_000, answered: false });
    // Its hold is gone, and it has the balance for the paper: it stops all the same, until the person carries it on.
    await t.run((ctx) => ctx.db.patch(jobId, { spendHold: "extraction-job:1", spendCap: 3 }));

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, { queueId, expectedEpoch: 0, paperConcurrency: 1, questionConcurrency: 1, pdfEnabled: false });

    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ status: "creditsExhausted", error: { message: expect.stringContaining("no longer held") } });
    expect(fakeAutumn.balance(userId)).toBe(1_000);
    expect(fakeAutumn.calls.filter((call) => call.path === "balances.check")).toHaveLength(0);
  });

  it("marks a leased item cancelled when the job is already cancelled", async () => {
    const t = convexTest(schema);
    const { queueId } = await seedLeasedPaperQueueItem(t, "cancelled");

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId,
      expectedEpoch: 0,
      paperConcurrency: 1,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const queueRow = await t.run((ctx) => ctx.db.get(queueId));
    expect(queueRow?.status).toBe("cancelled");
    expect(queueRow?.leaseOwner).toBeUndefined();
  });

  it("parks a leased item when the job is paused", async () => {
    const t = convexTest(schema);
    const { queueId } = await seedLeasedPaperQueueItem(t, "paused");

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId,
      expectedEpoch: 0,
      paperConcurrency: 1,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const queueRow = await t.run((ctx) => ctx.db.get(queueId));
    expect(queueRow?.status).toBe("parked");
    expect(queueRow?.leaseOwner).toBeUndefined();
  });

  it("parks a leased item when the job is credits exhausted", async () => {
    const t = convexTest(schema);
    const { queueId } = await seedLeasedPaperQueueItem(t, "creditsExhausted");

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId,
      expectedEpoch: 0,
      paperConcurrency: 1,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const queueRow = await t.run((ctx) => ctx.db.get(queueId));
    expect(queueRow?.status).toBe("parked");
    expect(queueRow?.leaseOwner).toBeUndefined();
  });

  it("marks an unprocessable paper download_failed and completes the queue item", async () => {
    const t = convexTest(schema);
    const { paperId, queueId } = await seedLeasedUnprocessablePaper(t);

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId,
      expectedEpoch: 0,
      paperConcurrency: 1,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const [paper, queueRow] = await t.run(async (ctx) => {
      return await Promise.all([ctx.db.get(paperId), ctx.db.get(queueId)]);
    });
    expect(paper?.status).toBe("download_failed");
    expect(paper?.lastError?.code).toBe("pdf_invalid");
    expect(queueRow?.status).toBe("completed");
    expect(queueRow?.leaseOwner).toBeUndefined();
  });

  it("finalizes an already answered paper without re-running question work", async () => {
    const t = convexTest(schema);
    const { paperId, queueId } = await seedAlreadyAnsweredPaper(t);

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId,
      expectedEpoch: 0,
      paperConcurrency: 1,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const [paper, queueRow, results] = await t.run(async (ctx) => {
      return await Promise.all([
        ctx.db.get(paperId),
        ctx.db.get(queueId),
        ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paperId))
          .collect(),
      ]);
    });

    expect(paper?.status).toBe("completed");
    expect(queueRow?.status).toBe("completed");
    expect(queueRow?.leaseOwner).toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("Already answered");
  });

  it("releases its row to the extraction worker, which dispatches the next pending paper", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const {
      completedPaperId,
      completedQueueId,
      activeQueueId,
      pendingQueueId,
    } = await seedQueueRefillJob(t);

    await t.action(internal.extraction.paperWorker.runPaperQueueItem, {
      queueId: completedQueueId,
      expectedEpoch: 0,
      paperConcurrency: 2,
      questionConcurrency: 1,
      pdfEnabled: false,
    });

    const [paper, completedQueue, activeQueue, pendingQueue] = await t.run(
      async (ctx) => {
        return await Promise.all([
          ctx.db.get(completedPaperId),
          ctx.db.get(completedQueueId),
          ctx.db.get(activeQueueId),
          ctx.db.get(pendingQueueId),
        ]);
      },
    );

    expect(paper?.status).toBe("completed");
    expect(completedQueue?.status).toBe("completed");
    // Released to the worker, which hasn't run: the window is as it was.
    expect(completedQueue?.releasedAt).toBeDefined();
    expect(activeQueue?.status).toBe("running");
    expect(pendingQueue?.status).toBe("pending");

    // The worker's batch: one refill for the job.
    await t.mutation(internal.extraction.queue.dispatcher.refill, { rows: [completedQueueId] });
    const [released, refilled] = await t.run((ctx) => Promise.all([ctx.db.get(completedQueueId), ctx.db.get(pendingQueueId)]));
    expect(released?.releasedAt).toBeUndefined();
    expect(refilled?.status).toBe("leased");
    expect(refilled?.workId).toBeDefined();
    expect(refilled?.leaseOwner).toContain("refill:");
  });
});
