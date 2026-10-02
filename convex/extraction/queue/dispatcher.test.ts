// The extraction worker: a paper's run releases its own queue row; the worker refills the
// job's window once per batch and finishes the job when nothing is left to run.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { EXTRACTION_PAPER_CONCURRENCY } from "../../../lib/extraction/limits";
import { setupExtractionPaperWorkpool } from "./workpool.test-support";

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
