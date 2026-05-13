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
    return { userId, jobId, paperId, clerkId };
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
    const res = await aliceT.mutation(api.extraction.mutations.cancelExtraction, {
      jobId: a.jobId,
    });
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
    const res = await aliceT.mutation(api.extraction.mutations.cancelExtraction, {
      jobId: a.jobId,
    });
    expect(res.success).toBe(true);
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", a.jobId));
    expect(job?.status).toBe("completed");
  });
});
