// The extraction worker: a paper's run releases its own queue row; the worker refills the
// job's window once per batch and finishes the job when nothing is left to run.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { EXTRACTION_PAPER_CONCURRENCY } from "../../../lib/extraction/limits";
import { setupExtractionPaperWorkpool } from "./workpool.test-support";
import { markPaperTerminalTx } from "../paperLifecycle";

// The worker schedules its runs on whichever timers are active when rows are released.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type PaperState = { paper: "pending" | "extracting" | "completed" | "failed"; queue: "pending" | "running" | "completed" };

async function seedJob(t: ReturnType<typeof convexTest>, papers: PaperState[]) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { clerkId: `clerk_${now}_${Math.random()}`, email: "x@test", state: "active", createdAt: now, updatedAt: now });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId, mode: "extraction", sourceType: "history", status: "extracting", runEpoch: 0, totalPapers: papers.length, name: "Dispatch", createdAt: now, updatedAt: now,
    });
    const queueIds: Id<"extractionPaperQueue">[] = [];
    for (const [i, state] of papers.entries()) {
      const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${i}`, title: `Paper ${i}`, status: state.paper, processable: true, abstract: "An abstract long enough to pass the processability gate for the dispatch tests." });
      queueIds.push(await ctx.db.insert("extractionPaperQueue", { jobId, userId, paperId, runEpoch: 0, kind: "initial", status: state.queue, priority: 0, attempt: 0, createdAt: now + i, updatedAt: now + i }));
    }
    return { jobId, queueIds };
  });
}

describe("extraction worker", () => {
  it("refills a job's window once for papers finishing together, up to its concurrency", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const running = Array.from({ length: EXTRACTION_PAPER_CONCURRENCY }, () => ({ paper: "extracting" as const, queue: "running" as const }));
    const waiting = Array.from({ length: 10 }, () => ({ paper: "pending" as const, queue: "pending" as const }));
    const { queueIds } = await seedJob(t, [...running, ...waiting]);
    const finished = queueIds.slice(0, 3);
    for (const queueId of finished) {
      await t.mutation(internal.extraction.queue.dispatcher.releasePaperQueueItem, { queueId, expectedEpoch: 0, status: "completed" });
    }

    await t.mutation(internal.extraction.queue.dispatcher.refill, { rows: finished });

    const rows = await t.run((ctx) => Promise.all(queueIds.map((id) => ctx.db.get(id))));
    expect(rows.filter((row) => row?.status === "leased")).toHaveLength(3);
    expect(rows.filter((row) => row?.status === "running")).toHaveLength(EXTRACTION_PAPER_CONCURRENCY - 3);
    expect(rows.filter((row) => row?.releasedAt !== undefined)).toHaveLength(0);
  });

  it("finishes the job once its last paper's row is released, through the queue", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { jobId, queueIds } = await seedJob(t, [
      { paper: "completed", queue: "completed" },
      { paper: "failed", queue: "completed" },
      { paper: "completed", queue: "running" },
    ]);

    await t.mutation(internal.extraction.queue.dispatcher.releasePaperQueueItem, { queueId: queueIds[2]!, expectedEpoch: 0, status: "completed" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("completed");
  });

  it("leaves the job extracting while a paper is still running", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { jobId, queueIds } = await seedJob(t, [
      { paper: "completed", queue: "running" },
      { paper: "extracting", queue: "running" },
    ]);

    await t.mutation(internal.extraction.queue.dispatcher.releasePaperQueueItem, { queueId: queueIds[0]!, expectedEpoch: 0, status: "completed" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("extracting");
  });
});

describe("a run that stops after finishing its paper", () => {
  it("still hands back its slot and finishes the job: the paper's row is released as the paper finishes", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { jobId, queueIds } = await seedJob(t, [
      { paper: "completed", queue: "completed" },
      { paper: "extracting", queue: "running" },
    ]);
    const paperId = (await t.run((ctx) => ctx.db.get(queueIds[1]!)))!.paperId;
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionQuestions", { jobId, key: "q1", question: "What was studied?", type: "string", order: 0, createdAt: 1 });
      await ctx.db.insert("extractionResults", {
        jobId, paperId, questionKey: "q1", answer: "Tutoring", citations: [], citationStatus: "grounded", status: "completed", billed: true, attemptCount: 1, creditsUsed: 1, processedAt: 1,
      });
    });

    // The run finishes its paper and stops before releasing its row.
    await t.mutation(internal.extraction.mutations.results.finalizePaper, { paperId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.run((ctx) => ctx.db.get(queueIds[1]!)))?.status).toBe("completed");
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("completed");
  });
});

describe("a refill batch", () => {
  it("finishes 50 jobs released in one batch within Convex's limits", async () => {
    const t = convexTest({ schema, transactionLimits: true });
    setupExtractionPaperWorkpool(t);
    const released: Id<"extractionPaperQueue">[] = [];
    for (let j = 0; j < 50; j++) {
      const { queueIds } = await seedJob(t, [
        { paper: "completed", queue: "running" },
        { paper: "failed", queue: "completed" },
      ]);
      await t.mutation(internal.extraction.queue.dispatcher.releasePaperQueueItem, { queueId: queueIds[0]!, expectedEpoch: 0, status: "completed" });
      released.push(queueIds[0]!);
    }

    await t.mutation(internal.extraction.queue.dispatcher.refill, { rows: released });

    const jobs = await t.run((ctx) => ctx.db.query("extractionJobs").collect());
    expect(jobs.filter((job) => job.status === "completed")).toHaveLength(50);
  }, 300_000);
});

describe("a paper with many queue rows from earlier runs", () => {
  it("has its current row released as it finishes", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { jobId, queueIds } = await seedJob(t, [{ paper: "extracting", queue: "running" }]);
    const current = (await t.run((ctx) => ctx.db.get(queueIds[0]!)))!;
    await t.run(async (ctx) => {
      await ctx.db.patch(queueIds[0]!, { runEpoch: 30 });
      await ctx.db.patch(jobId, { runEpoch: 30 });
      for (let epoch = 0; epoch < 25; epoch++) {
        await ctx.db.insert("extractionPaperQueue", { ...current, _id: undefined, _creationTime: undefined, runEpoch: epoch, status: "completed" } as never);
      }
    });

    await t.run((ctx) => markPaperTerminalTx(ctx, current.paperId, "completed"));

    expect((await t.run((ctx) => ctx.db.get(queueIds[0]!)))?.status).toBe("completed");
  });
});
