/**
 * Plan-06 — resumeExtraction public mutation behavior tests.
 *
 * Covers: restore-from-pausedFromStatus, credit pre-flight on
 * creditsExhausted, idempotent no-op on non-paused, ownership + mode
 * guards. Seeded jobs deliberately omit `workflowId` — the sendEvent
 * call is skipped, and the mutation exercises only the DB decision +
 * patch surface. Full end-to-end coverage including the workflow gate
 * is exercised by the integration smoke (task #12).
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";

const CLERK = "clerk_resume_owner";
const OWNER_IDENTITY = {
  subject: CLERK,
  tokenIdentifier: `${CLERK}|test`,
};

async function seedUserAndCredits(
  t: ReturnType<typeof convexTest>,
  opts: { paid?: number; free?: number } = {},
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "resume@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: opts.free ?? 0,
      paidBalance: opts.paid ?? 100_000,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return userId;
  });
}

type ResumeSeedOpts = {
  jobStatus:
    | "paused"
    | "creditsExhausted"
    | "extracting"
    | "completed"
    | "failed"
    | "cancelled";
  pausedFromStatus?:
    | "pending"
    | "downloading_pdfs"
    | "indexing"
    | "extracting";
  usePdfs?: boolean;
  /** How many pending (non-completed, non-billed) result rows to seed.
   *  Used by the creditsExhausted pre-flight to size the estimate. */
  remainingQuestions?: number;
  /** Whether seeded papers count as "unindexed" (indexingBilled !== true). */
  unindexedPapers?: number;
  runEpoch?: number;
};

async function seedJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  opts: ResumeSeedOpts,
): Promise<Id<"extractionJobs">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Resume Test Job",
      sourceType: "history" as const,
      status: opts.jobStatus,
      totalPapers: 10,
      processedPapers: 2,
      failedPapers: 0,
      runEpoch: opts.runEpoch ?? 1,
      usePdfs: opts.usePdfs ?? false,
      pausedFromStatus: opts.pausedFromStatus,
      pausedAt: opts.jobStatus === "paused" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    const rq = opts.remainingQuestions ?? 0;
    for (let i = 0; i < rq; i++) {
      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `oa:resume_${i}`,
        title: `Paper ${i}`,
        status: "extracting" as const,
        indexingBilled: true,
        ragEntryId: `rag:${i}`,
        isIndexed: true,
      });
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: `q_${i}`,
        answer: null,
        citations: [],
        citationStatus: "extraction_error" as const,
        status: "pending" as const,
        billed: false,
        attemptCount: 0,
        processedAt: now,
      });
    }

    const up = opts.unindexedPapers ?? 0;
    for (let i = 0; i < up; i++) {
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `oa:unindexed_${i}`,
        title: `Unindexed ${i}`,
        status: "pending" as const,
        indexingBilled: false,
      });
    }

    return jobId;
  });
}

describe("resumeExtraction — happy paths", () => {
  it("resumes 'paused' back to the captured pausedFromStatus", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      pausedFromStatus: "downloading_pdfs",
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(result).toEqual({ resumed: true });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("downloading_pdfs");
    expect(job?.pausedAt).toBeUndefined();
    expect(job?.pausedFromStatus).toBeUndefined();
    expect(job?.error).toBeUndefined();
    expect(job?.runEpoch).toBe(2);
  });

  it("falls back to 'extracting' when pausedFromStatus is missing", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      // pausedFromStatus intentionally unset (legacy row simulation)
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(result.resumed).toBe(true);

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("extracting");
    expect(job?.runEpoch).toBe(2);
  });

  it("resumes 'creditsExhausted' to 'extracting' when balance covers the estimate", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t, { paid: 100_000 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      usePdfs: false,
      remainingQuestions: 5, // 5 × 5 (ABSTRACT_Q_CREDIT_HIGH) = 25
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(result.resumed).toBe(true);

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("extracting");
    expect(job?.runEpoch).toBe(2);
  });
});

describe("resumeExtraction — credit pre-flight (creditsExhausted path)", () => {
  it("throws INSUFFICIENT_CREDITS when balance < estimate.high", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t, { paid: 0, free: 5 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      usePdfs: false,
      // 5 remaining × 12 (high) = 60 needed, balance 5 → throw.
      remainingQuestions: 5,
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.resume.resumeExtraction, {
        jobId,
      }),
    ).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);

    // State unchanged.
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("creditsExhausted");
  });

  it("includes indexing cost for unindexed PDF-tier papers in the preflight", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t, { paid: 0, free: 0 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      usePdfs: true, // PDF tier — indexing is billed
      remainingQuestions: 0,
      unindexedPapers: 1, // 1.5 credits of indexing alone
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.resume.resumeExtraction, {
        jobId,
      }),
    ).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);
  });

  it("ignores balance on user-paused jobs (pause is not a credit state)", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t, { paid: 0, free: 0 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      pausedFromStatus: "extracting",
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(result.resumed).toBe(true);
  });
});

describe("resumeExtraction — idempotency + refusals", () => {
  it("returns resumed:false with reason 'not_paused' on an already-running job", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, { jobStatus: "extracting" });
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(result).toEqual({ resumed: false, reason: "not_paused" });
  });

  it("double-resume is a no-op — second call returns not_paused", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      pausedFromStatus: "indexing",
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    const first = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(first.resumed).toBe(true);

    const second = await auth.mutation(
      api.extraction.mutations.resume.resumeExtraction,
      { jobId },
    );
    expect(second).toEqual({ resumed: false, reason: "not_paused" });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "returns not_paused on terminal status '%s'",
    async (status) => {
      const t = convexTest(schema);
      const userId = await seedUserAndCredits(t);
      const jobId = await seedJob(t, userId, { jobStatus: status });
      const auth = t.withIdentity(OWNER_IDENTITY);
      const result = await auth.mutation(
        api.extraction.mutations.resume.resumeExtraction,
        { jobId },
      );
      expect(result).toEqual({ resumed: false, reason: "not_paused" });
    },
  );
});

describe("resumeExtraction — auth + mode guards", () => {
  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      pausedFromStatus: "extracting",
    });
    await expect(
      t.mutation(api.extraction.mutations.resume.resumeExtraction, { jobId }),
    ).rejects.toThrow();
  });

  it("rejects foreign users with NOT_FOUND shape", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      pausedFromStatus: "extracting",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_resume_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });
    const foreign = t.withIdentity({
      subject: "clerk_resume_other",
      tokenIdentifier: "clerk_resume_other|test",
    });
    await expect(
      foreign.mutation(api.extraction.mutations.resume.resumeExtraction, {
        jobId,
      }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("rejects resume on chat-mode jobs", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t);
    const jobId = await t.run((ctx) =>
      ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat" as const,
        name: "Chat Job",
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const auth = t.withIdentity(OWNER_IDENTITY);
    await expect(
      auth.mutation(api.extraction.mutations.resume.resumeExtraction, { jobId }),
    ).rejects.toThrow(/extraction/i);
  });
});
