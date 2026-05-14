/**
 * Chunked-fanout TDD suite — plans/extraction-fanout-chunking/01.
 *
 * `launchPaperWorkflowsForJob` processes paperIds in CHUNK_SIZE slices.
 * Each invocation slices `paperIds.slice(offset, offset + CHUNK_SIZE)`
 * and schedules itself via `ctx.scheduler.runAfter(0, ...)` for the next
 * chunk until the list is exhausted. Idempotency is gated on
 * `paper.paperWorkflowId` + `paper.paperWorkflowEpoch` so a Convex
 * retry of a chunk does not double-start workflows for the same paper.
 *
 * These tests assert on DB-observable state (paper rows, scheduled
 * functions, ledger rows) only — never on call counts of workflow.start.
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";
import { setupAggregates } from "../../aggregates.test-support";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../../../credits/aggregates.test-support";
import { setupExtractionWorkflow } from "../../workflow.test-support";

const CHUNK_SIZE = 25;

async function seedJobAndPapers(
  t: ReturnType<typeof convexTest>,
  options: { paperCount: number; paidCredits?: number; runEpoch?: number },
) {
  const { paperCount, paidCredits = 100_000, runEpoch = 0 } = options;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `clerk_fanout_${now}`,
      email: "fanout@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await seedCreditsForTest(ctx, {
      userId,
      free: 0,
      paid: paidCredits,
      now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      runEpoch,
      totalPapers: paperCount,
      name: "Chunked Fanout Test",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "q1?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    const paperIds: Awaited<ReturnType<typeof ctx.db.insert>>[] = [];
    for (let i = 0; i < paperCount; i++) {
      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `oa:p${i}`,
        title: `Paper ${i}`,
        status: "pending" as const,
      });
      paperIds.push(paperId);
    }
    return {
      userId,
      jobId: jobId as typeof jobId,
      paperIds: paperIds as Array<(typeof paperIds)[number]>,
    };
  });
}

describe("launchPaperWorkflowsForJob — chunked fan-out", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("R1: processes only the first CHUNK_SIZE papers and queues the next chunk", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    setupExtractionWorkflow(t);

    const { jobId, paperIds } = await seedJobAndPapers(t, {
      paperCount: 60,
    });

    await t.mutation(
      internal.extraction.mutations.internal.fanout
        .launchPaperWorkflowsForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        pdfEnabled: false,
        questionConcurrency: 1,
      },
    );

    const firstChunk = await t.run((ctx) =>
      Promise.all(
        paperIds
          .slice(0, CHUNK_SIZE)
          .map((id) => ctx.db.get(id)),
      ),
    );
    for (const paper of firstChunk) {
      expect(paper?.paperWorkflowId).toBeDefined();
      expect(paper?.paperWorkflowEpoch).toBe(0);
    }

    const remaining = await t.run((ctx) =>
      Promise.all(
        paperIds.slice(CHUNK_SIZE).map((id) => ctx.db.get(id)),
      ),
    );
    for (const paper of remaining) {
      expect(paper?.paperWorkflowId).toBeUndefined();
      expect(paper?.paperWorkflowEpoch).toBeUndefined();
    }

    const queuedSelf = await t.run(async (ctx) => {
      const all = await ctx.db.system
        .query("_scheduled_functions")
        .collect();
      return all.filter((sf) =>
        sf.name.includes("launchPaperWorkflowsForJob"),
      );
    });
    expect(queuedSelf).toHaveLength(1);
    const nextChunkArgs = queuedSelf[0]?.args as
      | ReadonlyArray<{ offset?: number }>
      | undefined;
    expect(nextChunkArgs?.[0]?.offset).toBe(CHUNK_SIZE);
  });

  it("R2: scheduler chain unwinds to completion across all chunks", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    setupExtractionWorkflow(t);

    const { jobId, paperIds } = await seedJobAndPapers(t, {
      paperCount: 60,
    });

    // Seed the chain with the initial (offset-implicit) call.
    await t.mutation(
      internal.extraction.mutations.internal.fanout
        .launchPaperWorkflowsForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        pdfEnabled: false,
        questionConcurrency: 1,
      },
    );

    // Pump only the launch-chain entries. The workflow component
    // schedules its own work; intentionally ignoring those keeps the
    // test focused on the fan-out invariant and immune to action
    // implementations the convex-test runtime cannot execute.
    type LaunchArgs = {
      jobId: typeof jobId;
      paperIds: typeof paperIds;
      expectedEpoch: number;
      pdfEnabled: boolean;
      questionConcurrency: number;
      offset?: number;
    };
    const consumed = new Set<string>();
    const MAX_HOPS = 10;
    let hops = 0;
    while (hops < MAX_HOPS) {
      const next = await t.run(async (ctx) => {
        const all = await ctx.db.system
          .query("_scheduled_functions")
          .collect();
        return all.find(
          (sf) =>
            sf.name.includes("launchPaperWorkflowsForJob") &&
            !consumed.has(sf._id),
        );
      });
      if (!next) break;
      consumed.add(next._id);
      const launchArgs = (next.args as ReadonlyArray<unknown>)[0] as LaunchArgs;
      await t.mutation(
        internal.extraction.mutations.internal.fanout
          .launchPaperWorkflowsForJob,
        launchArgs,
      );
      hops++;
    }
    expect(hops).toBeLessThan(MAX_HOPS);

    const papers = await t.run((ctx) =>
      Promise.all(paperIds.map((id) => ctx.db.get(id))),
    );
    for (const paper of papers) {
      expect(paper?.paperWorkflowId).toBeDefined();
      expect(paper?.paperWorkflowEpoch).toBe(0);
    }

    const stillUnconsumed = await t.run(async (ctx) => {
      const all = await ctx.db.system
        .query("_scheduled_functions")
        .collect();
      return all.filter(
        (sf) =>
          sf.name.includes("launchPaperWorkflowsForJob") &&
          !consumed.has(sf._id),
      );
    });
    expect(stillUnconsumed).toHaveLength(0);
  });

  it("R3: launch idempotency on chunk retry — pre-launched papers keep their workflowId", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    setupExtractionWorkflow(t);

    const { jobId, paperIds } = await seedJobAndPapers(t, {
      paperCount: 25,
    });

    const STUB = "stub";
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        await ctx.db.patch(paperIds[i]!, {
          paperWorkflowId: STUB,
          paperWorkflowEpoch: 0,
        });
      }
    });

    await t.mutation(
      internal.extraction.mutations.internal.fanout
        .launchPaperWorkflowsForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        pdfEnabled: false,
        questionConcurrency: 1,
      },
    );

    const preLaunched = await t.run((ctx) =>
      Promise.all(paperIds.slice(0, 10).map((id) => ctx.db.get(id))),
    );
    for (const paper of preLaunched) {
      expect(paper?.paperWorkflowId).toBe(STUB);
      expect(paper?.paperWorkflowEpoch).toBe(0);
    }

    const freshlyLaunched = await t.run((ctx) =>
      Promise.all(paperIds.slice(10).map((id) => ctx.db.get(id))),
    );
    for (const paper of freshlyLaunched) {
      expect(paper?.paperWorkflowId).toBeDefined();
      expect(paper?.paperWorkflowId).not.toBe(STUB);
      expect(paper?.paperWorkflowEpoch).toBe(0);
    }
  });

  it("R4: resume invalidates prior-epoch launches and starts fresh workflows", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    setupExtractionWorkflow(t);

    const { jobId, paperIds } = await seedJobAndPapers(t, {
      paperCount: 25,
      runEpoch: 1,
    });

    const STALE = "stale";
    await t.run(async (ctx) => {
      for (const id of paperIds) {
        await ctx.db.patch(id, {
          paperWorkflowId: STALE,
          paperWorkflowEpoch: 0,
        });
      }
    });

    await t.mutation(
      internal.extraction.mutations.internal.fanout
        .launchPaperWorkflowsForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 1,
        pdfEnabled: false,
        questionConcurrency: 1,
      },
    );

    const papers = await t.run((ctx) =>
      Promise.all(paperIds.map((id) => ctx.db.get(id))),
    );
    for (const paper of papers) {
      expect(paper?.paperWorkflowId).toBeDefined();
      expect(paper?.paperWorkflowId).not.toBe(STALE);
      expect(paper?.paperWorkflowEpoch).toBe(1);
    }
  });
});
