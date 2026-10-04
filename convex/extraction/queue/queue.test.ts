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

  // #335, copied from Firecrawl's per-team concurrency: a person's papers at once across jobs.
  it("leases a person's second job only what their first leaves, under their plan's concurrency", async () => {
    const t = convexTest(schema);
    const first = await seedEligibleQueueJob(t, 4);
    const userId = await t.run(async (ctx) => (await ctx.db.get(first.jobId))!.userId);
    const second = await t.run(async (ctx) => {
      const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "extraction" as const, sourceType: "history" as const, status: "extracting" as const, runEpoch: 0, totalPapers: 2, name: "Second", createdAt: 2, updatedAt: 2 });
      const paperIds = [
        await ctx.db.insert("extractionPapers", { jobId, openalexId: "oa:second:0", title: "Second 0", status: "pending" as const, processable: true }),
        await ctx.db.insert("extractionPapers", { jobId, openalexId: "oa:second:1", title: "Second 1", status: "pending" as const, processable: true }),
      ];
      await ctx.db.insert("billingAccounts", { userId, plan: "free", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1, concurrency: 3 });
      return { jobId, paperIds };
    });
    const other = await seedEligibleQueueJob(t, 4);
    const lease = (jobId: Id<"extractionJobs">) =>
      t.mutation(internal.extraction.queue.mutations.leaseNextPaperQueueRows, { jobId, expectedEpoch: 0, paperConcurrency: 40, leaseOwner: "test-worker", leaseMs: 60_000 });
    for (const job of [first, second, other]) {
      await t.mutation(internal.extraction.queue.mutations.enqueueInitialPapersForJob, { jobId: job.jobId, paperIds: job.paperIds, expectedEpoch: 0, priority: 0 });
    }

    // The plan allows 3 at once: the first job takes them all, the second waits.
    expect((await lease(first.jobId)).leased).toHaveLength(3);
    expect((await lease(second.jobId)).leased).toHaveLength(0);
    // Another person's job isn't held back by this one's.
    expect((await lease(other.jobId)).leased).toHaveLength(4);
  });

  it("starts a person's held-back job when their first job's papers release, and never exceeds their limit across many jobs", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const first = await seedEligibleQueueJob(t, 3);
    const userId = await t.run(async (ctx) => (await ctx.db.get(first.jobId))!.userId);
    const more = await t.run(async (ctx) => {
      await ctx.db.insert("billingAccounts", { userId, plan: "free", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1, concurrency: 3 });
      const jobs: Array<{ jobId: Id<"extractionJobs">; paperIds: Array<Id<"extractionPapers">> }> = [];
      for (let j = 0; j < 12; j++) {
        const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "extraction" as const, sourceType: "history" as const, status: "extracting" as const, runEpoch: 0, totalPapers: 2, name: `Job ${j}`, createdAt: 2 + j, updatedAt: 2 + j });
        const paperIds = [0, 1].map(() => undefined) as unknown as Array<Id<"extractionPapers">>;
        for (let i = 0; i < 2; i++) paperIds[i] = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${j}:${i}`, title: `Job ${j} paper ${i}`, status: "pending" as const, processable: true });
        jobs.push({ jobId, paperIds });
      }
      return jobs;
    });
    for (const job of [first, ...more]) {
      await t.mutation(internal.extraction.queue.mutations.enqueueInitialPapersForJob, { jobId: job.jobId, paperIds: job.paperIds, expectedEpoch: 0, priority: 0 });
    }
    const dispatch = (jobId: Id<"extractionJobs">) =>
      t.mutation(internal.extraction.queue.mutations.dispatchPaperQueueWindow, { jobId, expectedEpoch: 0, paperConcurrency: 40, leaseOwner: "test", leaseMs: 60_000, questionConcurrency: 1, pdfEnabled: false });
    const held = () => t.run(async (ctx) => {
      const rows = await ctx.db.query("extractionPaperQueue").withIndex("by_user_and_status", (q) => q.eq("userId", userId).eq("status", "leased")).collect();
      return rows;
    });

    for (const job of [first, ...more]) await dispatch(job.jobId);
    // Thirteen jobs, a limit of 3: the first job holds all three.
    expect((await held()).map((row) => row.jobId)).toEqual([first.jobId, first.jobId, first.jobId]);

    const firstRows = await held();
    for (const row of firstRows) {
      await t.mutation(internal.extraction.queue.dispatcher.releasePaperQueueItem, { queueId: row._id, expectedEpoch: 0, status: "completed" });
    }
    await t.mutation(internal.extraction.queue.dispatcher.refill, { rows: firstRows.map((row) => row._id) });
    const after = await held();
    expect(after).toHaveLength(3);
    expect(after.every((row) => row.jobId !== first.jobId)).toBe(true);
  });

  it("gives freed capacity to the person's oldest job, and frees it when a job's run parks", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const older = await seedEligibleQueueJob(t, 2);
    const userId = await t.run(async (ctx) => (await ctx.db.get(older.jobId))!.userId);
    const newer = await t.run(async (ctx) => {
      await ctx.db.insert("billingAccounts", { userId, plan: "free", pastDue: false, balance: 0, purchased: 0, signupGranted: true, hasPaid: false, refreshedAt: 1, concurrency: 2 });
      const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "extraction" as const, sourceType: "history" as const, status: "extracting" as const, runEpoch: 0, totalPapers: 4, name: "Newer", createdAt: 9, updatedAt: 9 });
      const paperIds: Array<Id<"extractionPapers">> = [];
      for (let i = 0; i < 4; i++) paperIds.push(await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:newer:${i}`, title: `Newer ${i}`, status: "pending" as const, processable: true }));
      return { jobId, paperIds };
    });
    for (const job of [older, newer]) {
      await t.mutation(internal.extraction.queue.mutations.enqueueInitialPapersForJob, { jobId: job.jobId, paperIds: job.paperIds, expectedEpoch: 0, priority: 0 });
    }
    const leased = (jobId: Id<"extractionJobs">) =>
      t.run((ctx) => ctx.db.query("extractionPaperQueue").withIndex("by_job_and_status", (q) => q.eq("jobId", jobId).eq("status", "leased")).collect());
    // The newer job got the person's two slots first.
    await t.mutation(internal.extraction.queue.mutations.dispatchPaperQueueWindow, { jobId: newer.jobId, expectedEpoch: 0, paperConcurrency: 40, leaseOwner: "test", leaseMs: 60_000, questionConcurrency: 1, pdfEnabled: false });

    // One of the newer job's runs parks without a release: the older job gets that slot.
    const [parked, finishing] = await leased(newer.jobId);
    await t.mutation(internal.extraction.queue.mutations.updatePaperQueueStatus, { queueId: parked!._id, expectedEpoch: 0, status: "parked" });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const wake = scheduled.find((fn) => fn.name === "extraction/queue/dispatcher:wakePerson");
    expect(wake?.args[0]).toEqual({ userId });
    await t.mutation(internal.extraction.queue.dispatcher.wakePerson, { userId });
    expect(await leased(older.jobId)).toHaveLength(1);

    // Its other paper finishes: the freed slot goes to the older job, not back to the newer one.
    await t.mutation(internal.extraction.queue.dispatcher.releasePaperQueueItem, { queueId: finishing!._id, expectedEpoch: 0, status: "completed" });
    await t.mutation(internal.extraction.queue.dispatcher.refill, { rows: [finishing!._id] });
    expect(await leased(older.jobId)).toHaveLength(2);
    expect(await leased(newer.jobId)).toHaveLength(0);
  });
});
