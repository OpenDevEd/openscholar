/**
 * Plan-06 — resumeExtraction public mutation behavior tests.
 *
 * Covers: restore-from-pausedFromStatus, credit pre-flight on
 * creditsExhausted, idempotent no-op on non-paused, ownership + mode
 * guards. Full end-to-end coverage is exercised by queue worker tests
 * and the resume requeue integration below.
 */

import { seedOrganizationFeatures } from "../../organizationFeatures.test-support";
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import {
  seedCreditsForTest,
} from "../../billing/billing.test-support";
import { setupExtractionPaperWorkpool } from "../queue/workpool.test-support";

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
    await seedOrganizationFeatures(ctx, [CLERK], {extraction: true});
    await seedCreditsForTest(ctx, {
      userId,
      free: opts.free ?? 0,
      paid: opts.paid ?? 100_000,
      now,
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
  /** How many questions the job asks; the creditsExhausted pre-flight
   *  checks the balance covers one paper's worth. */
  questions?: number;
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
      runEpoch: opts.runEpoch ?? 1,
      usePdfs: opts.usePdfs ?? false,
      pausedFromStatus: opts.pausedFromStatus,
      pausedAt: opts.jobStatus === "paused" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < (opts.questions ?? 0); i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: `q_${i}`,
        question: `Q ${i}?`,
        type: "string" as const,
        order: i,
        createdAt: now,
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
    setupExtractionPaperWorkpool(t);
    const userId = await seedUserAndCredits(t, { paid: 100_000 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      usePdfs: false,
      questions: 5,
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

  it("requeues non-terminal papers through the paper queue", async () => {
    const t = convexTest(schema);
    setupExtractionPaperWorkpool(t);
    const userId = await seedUserAndCredits(t);
    const jobId = await seedJob(t, userId, {
      jobStatus: "paused",
      pausedFromStatus: "extracting",
      runEpoch: 3,
    });
    const paperId = await t.run(async (ctx) => {
      return await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:resume_queue",
        title: "Resume Queue Paper",
        status: "pending" as const,
        processable: true,
      });
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    await auth.mutation(api.extraction.mutations.resume.resumeExtraction, {
      jobId,
    });

    await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      const queueRows = await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_paper_and_epoch_and_kind", (q) =>
          q.eq("paperId", paperId).eq("runEpoch", 4).eq("kind", "initial"),
        )
        .collect();
      const scheduledFunctions = await ctx.db.system
        .query("_scheduled_functions")
        .collect();

      expect(job?.status).toBe("extracting");
      expect(job?.runEpoch).toBe(4);
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].status).toBe("leased");
      expect(queueRows[0].workId).toBeDefined();
      expect(
        scheduledFunctions.some((sf) =>
          sf.name.includes("setupExtractionQueueJob"),
        ),
      ).toBe(false);
    });
  });
});

describe("resumeExtraction — credit pre-flight (creditsExhausted path)", () => {
  it("throws INSUFFICIENT_CREDITS when the balance cannot cover the next paper", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t, { paid: 0, free: 5 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      usePdfs: false,
      questions: 5,
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

  it("counts PDF indexing in the next paper's cost", async () => {
    const t = convexTest(schema);
    const userId = await seedUserAndCredits(t, { paid: 0, free: 0 });
    const jobId = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      usePdfs: true,
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
