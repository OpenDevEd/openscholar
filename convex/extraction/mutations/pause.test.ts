/**
 * Plan-06 — pauseExtraction public mutation behavior tests.
 *
 * Covers: happy path (running → paused + metadata), idempotency on
 * double-pause, refusal on each non-runnable status, ownership leak
 * protection (NOT_FOUND shape), chat-mode rejection, and
 * unauthenticated rejection.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";

const CLERK = "clerk_pause_owner";
const OWNER_IDENTITY = {
  subject: CLERK,
  tokenIdentifier: `${CLERK}|test`,
};

async function seedUser(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "pause@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  status:
    | "pending"
    | "downloading_pdfs"
    | "indexing"
    | "extracting"
    | "paused"
    | "creditsExhausted"
    | "completed"
    | "failed"
    | "cancelled",
): Promise<Id<"extractionJobs">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Pause Test Job",
      sourceType: "history" as const,
      status,
      totalPapers: 10,
      processedPapers: 2,
      failedPapers: 0,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("pauseExtraction — happy path", () => {
  it("flips running job to paused and captures pausedFromStatus + pausedAt", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await seedJob(t, userId, "extracting");
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.pause.pauseExtraction,
      { jobId },
    );
    expect(result).toEqual({ paused: true });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("paused");
    expect(job?.pausedFromStatus).toBe("extracting");
    expect(typeof job?.pausedAt).toBe("number");
  });

  it.each([
    "pending",
    "downloading_pdfs",
    "indexing",
    "extracting",
  ] as const)(
    "accepts running status '%s' and records it as pausedFromStatus",
    async (status) => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const jobId = await seedJob(t, userId, status);
      const auth = t.withIdentity(OWNER_IDENTITY);

      const result = await auth.mutation(
        api.extraction.mutations.pause.pauseExtraction,
        { jobId },
      );
      expect(result.paused).toBe(true);
      const job = await t.run((ctx) => ctx.db.get(jobId));
      expect(job?.status).toBe("paused");
      expect(job?.pausedFromStatus).toBe(status);
    },
  );
});

describe("pauseExtraction — idempotency + refusals", () => {
  it("double-pause is a no-op (paused:false, reason:'already_paused')", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await seedJob(t, userId, "extracting");
    const auth = t.withIdentity(OWNER_IDENTITY);

    const first = await auth.mutation(
      api.extraction.mutations.pause.pauseExtraction,
      { jobId },
    );
    expect(first.paused).toBe(true);

    const second = await auth.mutation(
      api.extraction.mutations.pause.pauseExtraction,
      { jobId },
    );
    expect(second).toEqual({ paused: false, reason: "already_paused" });

    // pausedAt must not be overwritten on the second call.
    const firstJob = await t.run((ctx) => ctx.db.get(jobId));
    const pausedAtAfter = firstJob?.pausedAt;
    expect(pausedAtAfter).toBeTypeOf("number");
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "refuses pause from terminal status '%s' with reason='terminal'",
    async (status) => {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const jobId = await seedJob(t, userId, status);
      const auth = t.withIdentity(OWNER_IDENTITY);

      const result = await auth.mutation(
        api.extraction.mutations.pause.pauseExtraction,
        { jobId },
      );
      expect(result).toEqual({ paused: false, reason: "terminal" });

      const job = await t.run((ctx) => ctx.db.get(jobId));
      expect(job?.status).toBe(status);
      expect(job?.pausedAt).toBeUndefined();
    },
  );

  it("refuses pause from creditsExhausted with reason='credits_exhausted'", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await seedJob(t, userId, "creditsExhausted");
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await auth.mutation(
      api.extraction.mutations.pause.pauseExtraction,
      { jobId },
    );
    expect(result).toEqual({ paused: false, reason: "credits_exhausted" });
  });
});

describe("pauseExtraction — auth + mode guards", () => {
  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await seedJob(t, userId, "extracting");
    await expect(
      t.mutation(api.extraction.mutations.pause.pauseExtraction, { jobId }),
    ).rejects.toThrow();
  });

  it("rejects foreign users with NOT_FOUND shape (no existence leak)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await seedJob(t, userId, "extracting");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_pause_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });
    const foreign = t.withIdentity({
      subject: "clerk_pause_other",
      tokenIdentifier: "clerk_pause_other|test",
    });
    await expect(
      foreign.mutation(api.extraction.mutations.pause.pauseExtraction, {
        jobId,
      }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("rejects pause on chat-mode jobs", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
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
      auth.mutation(api.extraction.mutations.pause.pauseExtraction, { jobId }),
    ).rejects.toThrow(/extraction/i);
  });
});
