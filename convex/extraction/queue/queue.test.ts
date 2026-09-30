import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { setupExtractionPaperWorkpool } from "./workpool.test-support";

async function seedQueueJob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_queue_${now}`,
      email: "queue@test.com",
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
      totalPapers: 4,
      name: "Queue Test",
      createdAt: now,
      updatedAt: now,
    });

    const eligible = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:eligible",
      title: "Eligible",
      status: "pending" as const,
      processable: true,
    });
    const nonProcessable = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:non-processable",
      title: "Non-processable",
      status: "pending" as const,
      processable: false,
    });
    const terminal = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:terminal",
      title: "Terminal",
      status: "completed" as const,
      processable: true,
    });
    const billed = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:billed",
      title: "Billed",
      status: "pending" as const,
      processable: true,
      questionsBilled: true,
    });

    return {
      jobId,
      paperIds: [eligible, nonProcessable, terminal, billed] as Array<
        Id<"extractionPapers">
      >,
      eligible,
    };
  });
}

async function seedEligibleQueueJob(
  t: ReturnType<typeof convexTest>,
  paperCount: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_queue_many_${now}`,
      email: "queue-many@test.com",
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
      totalPapers: paperCount,
      name: "Queue Many Test",
      createdAt: now,
      updatedAt: now,
    });

    const paperIds: Array<Id<"extractionPapers">> = [];
    for (let index = 0; index < paperCount; index += 1) {
      paperIds.push(
        await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:eligible:${index}`,
          title: `Eligible ${index}`,
          status: "pending" as const,
          processable: true,
        }),
      );
    }

    return { jobId, paperIds };
  });
}

async function seedRetryQueueJob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: `clerk_queue_retry_${now}`,
      email: "queue-retry@test.com",
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
      name: "Queue Retry Test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:retry",
      title: "Retry",
      status: "extracting" as const,
      processable: true,
      questionsBilled: true,
    });
    return { jobId, paperId };
  });
}

describe("extraction paper queue", () => {
  it("enqueues only eligible initial papers for the current epoch", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds, eligible } = await seedQueueJob(t);

    const result = await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    expect(result).toEqual({
      enqueued: 1,
      existing: 0,
      skipped: 3,
    });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_epoch_and_status", (q) =>
          q.eq("jobId", jobId).eq("runEpoch", 0).eq("status", "pending"),
        )
        .collect();
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId,
      paperId: eligible,
      kind: "initial",
      status: "pending",
      priority: 0,
      attempt: 0,
    });
  });

  it("does not duplicate existing initial rows for the same epoch", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedQueueJob(t);

    await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    const second = await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    expect(second).toEqual({
      enqueued: 0,
      existing: 1,
      skipped: 3,
    });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_epoch_and_status", (q) =>
          q.eq("jobId", jobId).eq("runEpoch", 0).eq("status", "pending"),
        )
        .collect();
    });
    expect(rows).toHaveLength(1);
  });

  it("creates fresh rows for a new epoch without mutating stale rows", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedQueueJob(t);

    await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { runEpoch: 1, updatedAt: Date.now() });
    });

    const secondEpoch = await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 1,
        priority: 0,
      },
    );

    expect(secondEpoch).toEqual({
      enqueued: 1,
      existing: 0,
      skipped: 3,
    });

    const rowsByEpoch = await t.run(async (ctx) => {
      const all = await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_status", (q) =>
          q.eq("jobId", jobId).eq("status", "pending"),
        )
        .collect();
      return all.reduce<Record<number, number>>((counts, row) => {
        counts[row.runEpoch] = (counts[row.runEpoch] ?? 0) + 1;
        return counts;
      }, {});
    });

    expect(rowsByEpoch).toEqual({ 0: 1, 1: 1 });
  });

  it("leases only the available current-epoch capacity", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedEligibleQueueJob(t, 4);

    await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    const firstLease = await t.mutation(
      internal.extraction.queue.mutations.leaseNextPaperQueueRows,
      {
        jobId,
        expectedEpoch: 0,
        paperConcurrency: 2,
        leaseOwner: "test-worker",
        leaseMs: 60_000,
      },
    );
    expect(firstLease.leased).toHaveLength(2);
    expect(firstLease.activeCount).toBe(0);
    expect(firstLease.capacity).toBe(2);

    const secondLease = await t.mutation(
      internal.extraction.queue.mutations.leaseNextPaperQueueRows,
      {
        jobId,
        expectedEpoch: 0,
        paperConcurrency: 2,
        leaseOwner: "test-worker",
        leaseMs: 60_000,
      },
    );
    expect(secondLease.leased).toHaveLength(0);
    expect(secondLease.activeCount).toBe(2);
    expect(secondLease.capacity).toBe(0);

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_epoch_and_status", (q) =>
          q.eq("jobId", jobId).eq("runEpoch", 0).eq("status", "leased"),
        )
        .collect();
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.leaseOwner === "test-worker")).toBe(true);
  });

  it("opens capacity when a leased row reaches a terminal queue status", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedEligibleQueueJob(t, 4);

    await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    const firstLease = await t.mutation(
      internal.extraction.queue.mutations.leaseNextPaperQueueRows,
      {
        jobId,
        expectedEpoch: 0,
        paperConcurrency: 2,
        leaseOwner: "test-worker",
        leaseMs: 60_000,
      },
    );

    await t.mutation(
      internal.extraction.queue.mutations.updatePaperQueueStatus,
      {
        queueId: firstLease.leased[0],
        expectedEpoch: 0,
        status: "completed",
      },
    );

    const nextLease = await t.mutation(
      internal.extraction.queue.mutations.leaseNextPaperQueueRows,
      {
        jobId,
        expectedEpoch: 0,
        paperConcurrency: 2,
        leaseOwner: "test-worker",
        leaseMs: 60_000,
      },
    );

    expect(nextLease.activeCount).toBe(1);
    expect(nextLease.capacity).toBe(1);
    expect(nextLease.leased).toHaveLength(1);

    const completed = await t.run((ctx) => ctx.db.get(firstLease.leased[0]));
    expect(completed?.status).toBe("completed");
  });

  it("enqueues retry rows with exact question keys without colliding with initial rows", async () => {
    const t = convexTest(schema);
    const { jobId, paperId } = await seedRetryQueueJob(t);

    const initial = await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds: [paperId],
        expectedEpoch: 0,
        priority: 0,
      },
    );
    expect(initial.enqueued).toBe(0);

    const retry = await t.mutation(
      internal.extraction.queue.mutations.enqueueRetryPapersForJob,
      {
        jobId,
        expectedEpoch: 0,
        retryPapers: [{ paperId, questionKeys: ["q1", "q2"] }],
        priority: -10,
      },
    );

    expect(retry).toEqual({
      enqueued: 1,
      existing: 0,
      skipped: 0,
    });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_paper_and_epoch_and_kind", (q) =>
          q.eq("paperId", paperId).eq("runEpoch", 0).eq("kind", "retry"),
        )
        .collect();
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId,
      paperId,
      kind: "retry",
      status: "pending",
      priority: -10,
      questionKeys: ["q1", "q2"],
    });
  });

  it("dispatches leased rows into the extraction paper workpool and stores work ids", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const { jobId, paperIds } = await seedEligibleQueueJob(t, 3);

    await t.mutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds,
        expectedEpoch: 0,
        priority: 0,
      },
    );

    const dispatch = await t.mutation(
      internal.extraction.queue.mutations.dispatchPaperQueueWindow,
      {
        jobId,
        expectedEpoch: 0,
        paperConcurrency: 2,
        leaseOwner: "test-dispatcher",
        leaseMs: 60_000,
        questionConcurrency: 1,
        pdfEnabled: false,
      },
    );

    expect(dispatch).toEqual({
      activeCount: 0,
      capacity: 2,
      dispatched: 2,
    });

    const leasedRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_epoch_and_status", (q) =>
          q.eq("jobId", jobId).eq("runEpoch", 0).eq("status", "leased"),
        )
        .collect();
    });

    expect(leasedRows).toHaveLength(2);
    expect(leasedRows.every((row) => row.workId !== undefined)).toBe(true);
  });
});
