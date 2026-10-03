import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedUserAndJob(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId,
      email: `${clerkId}@test.com`,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 1,
      name: `Job ${clerkId}`,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: `oa:${clerkId}`,
      title: `Paper for ${clerkId}`,
      status: "downloading" as const,
      workId: `work_${clerkId}`,
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
      leaseOwner: `worker_${clerkId}`,
      leasedAt: now,
      leaseExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId, paperId, queueId, clerkId };
  });
}

describe("cancelExtraction scope", () => {
  it("cancelling job A does not touch job B's workpool items or status", async () => {
    const t = convexTest(schema);
    const a = await seedUserAndJob(t, "alice");
    const b = await seedUserAndJob(t, "bob");

    // Alice cancels her job
    const aliceIdentity = {
      subject: "alice",
      tokenIdentifier: "alice|test",
    };
    const aliceT = t.withIdentity(aliceIdentity);
    const res = await aliceT.mutation(
      api.extraction.mutations.cancelExtraction,
      {
        jobId: a.jobId,
      },
    );
    expect(res.success).toBe(true);

    await t.run(async (ctx) => {
      const jobA = await ctx.db.get("extractionJobs", a.jobId);
      expect(jobA?.status).toBe("cancelled");

      const jobB = await ctx.db.get("extractionJobs", b.jobId);
      expect(jobB?.status).toBe("extracting");

      const paperA = await ctx.db.get("extractionPapers", a.paperId);
      expect(paperA?.status).toBe("downloading");

      const paperB = await ctx.db.get("extractionPapers", b.paperId);
      expect(paperB?.status).toBe("downloading");
      expect(paperB?.workId).toBe("work_bob");

      const queueA = await ctx.db.get(a.queueId);
      expect(queueA?.status).toBe("cancelled");
      expect(queueA?.leaseOwner).toBeUndefined();

      const queueB = await ctx.db.get(b.queueId);
      expect(queueB?.status).toBe("leased");
      expect(queueB?.leaseOwner).toBe("worker_bob");
    });
  });

  it("cancelling a job without auth as non-owner returns NOT_FOUND", async () => {
    const t = convexTest(schema);
    const a = await seedUserAndJob(t, "alice");

    const mallory = t.withIdentity({
      subject: "mallory",
      tokenIdentifier: "mallory|test",
    });
    // Mallory has no user row; even if she did, she doesn't own the job.
    await expect(
      mallory.mutation(api.extraction.mutations.cancelExtraction, {
        jobId: a.jobId,
      }),
    ).rejects.toThrow();
  });

  it("cancelling an already-terminal job is idempotent", async () => {
    const t = convexTest(schema);
    const a = await seedUserAndJob(t, "alice");
    await t.run((ctx) =>
      ctx.db.patch("extractionJobs", a.jobId, { status: "completed" }),
    );

    const aliceT = t.withIdentity({
      subject: "alice",
      tokenIdentifier: "alice|test",
    });
    const res = await aliceT.mutation(
      api.extraction.mutations.cancelExtraction,
      {
        jobId: a.jobId,
      },
    );
    expect(res.success).toBe(true);
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", a.jobId));
    expect(job?.status).toBe("completed");
  });
});

describe("cancelling a job with more queue rows than one transaction takes (#427)", () => {
  it("cancels every row that could still run, a batch at a time, and leaves finished ones", async () => {
    const t = convexTest(schema);
    const { jobId, userId, paperId, clerkId } = await seedUserAndJob(t, "carol");
    // Left by several pauses and resumes: 600 pending rows across epochs, and some already done.
    for (let start = 0; start < 600; start += 200) {
      await t.run(async (ctx) => {
        for (let i = start; i < start + 200; i++) {
          await ctx.db.insert("extractionPaperQueue", { jobId, userId, paperId, runEpoch: i % 3, kind: "initial", status: "pending", priority: 0, attempt: 0, createdAt: i, updatedAt: i });
        }
      });
    }
    await t.run((ctx) => ctx.db.insert("extractionPaperQueue", { jobId, userId, paperId, runEpoch: 0, kind: "initial", status: "completed", priority: 0, attempt: 0, createdAt: 1, updatedAt: 1 }));

    await t.withIdentity({ subject: clerkId, tokenIdentifier: `${clerkId}|test` }).mutation(api.extraction.mutations.cancelExtraction, { jobId });
    await t.finishAllScheduledFunctions(() => {});

    const statuses = await t.run(async (ctx) => {
      const counts: Record<string, number> = {};
      for (const status of ["pending", "leased", "running", "parked", "cancelled", "completed"] as const) {
        counts[status] = (await ctx.db.query("extractionPaperQueue").withIndex("by_job_and_status", (q) => q.eq("jobId", jobId).eq("status", status)).take(1000)).length;
      }
      return counts;
    });
    expect(statuses).toEqual({ pending: 0, leased: 0, running: 0, parked: 0, cancelled: 601, completed: 1 });
  });
});
