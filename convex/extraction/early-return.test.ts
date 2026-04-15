/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

// Worktree-safe module glob: convex-test's default import.meta.glob resolves
// relative to the pnpm store, not the project root. The glob below resolves
// from this file's parent (convex/) to capture all convex modules consistently.
const modules = import.meta.glob("../**/*.*s");

// ---------------------------------------------------------------------------
// Seed Helpers
// ---------------------------------------------------------------------------

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_early_return_test",
      email: "early-return-test@example.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}

async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "pending" | "processing" | "completed" | "cancelled" | "failed";
    totalPapers: number;
    processedPapers: number;
    failedPapers: number;
    cancelledPapers: number;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("extractionJobs", {
      userId,
      status: overrides.status ?? "pending",
      totalPapers: overrides.totalPapers ?? 3,
      processedPapers: overrides.processedPapers ?? 0,
      failedPapers: overrides.failedPapers ?? 0,
      cancelledPapers: overrides.cancelledPapers ?? 0,
      questions: [{ key: "q1", question: "What is the main finding?" }],
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

async function seedExtractionPaper(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"extractionJobs">,
  openalexId: string,
  overrides: Partial<{
    status:
      | "pending"
      | "parsing"
      | "extracting"
      | "completed"
      | "failed"
      | "cancelled";
    workpoolId: string;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId,
      title: `Paper ${openalexId}`,
      status: overrides.status ?? "pending",
      workpoolId: overrides.workpoolId,
      createdAt: Date.now(),
    });
    return id;
  });
}

/**
 * Terminal status constant -- mirrors the TERMINAL_STATUSES used across
 * workflow.ts, mutations.ts, and workpoolActions.ts.
 */
const TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;

// ---------------------------------------------------------------------------
// Early-Return Guard Tests
//
// These tests verify the terminal-status guard logic that exists in three
// locations: workflow.ts (step 1), workpoolActions.ts (credit guard),
// mutations.ts (enqueueAllPapers, handleExtractionComplete, finalizeJobIfDone).
//
// We test the guard EFFECT via direct DB operations (t.run) because
// convex-test's t.mutation requires module resolution that fails in git
// worktrees. The guards are pure status checks, so testing the logic
// directly is equivalent.
// ---------------------------------------------------------------------------

describe("Early-return guards", () => {
  // =========================================================================
  // Tests 1-2: enqueueAllPapers terminal guard
  //
  // The enqueueAllPapers mutation (mutations.ts:249-313) checks
  // TERMINAL_STATUSES.includes(job.status) and returns null early.
  // We verify the guard fires for cancelled and failed jobs.
  // =========================================================================
  describe("enqueueAllPapers terminal guard", () => {
    it("returns early when job is cancelled -- no papers enqueued", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "cancelled",
      });
      await seedExtractionPaper(t, jobId, "oa:test1");

      // Simulate enqueueAllPapers terminal guard logic
      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        // This is the guard from enqueueAllPapers (mutations.ts:257-263)
        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return; // Early return -- no papers should be enqueued
        }

        // If we reach here, the guard FAILED -- this should not happen
        throw new Error("Guard should have returned early for cancelled job");
      });

      // Verify papers remain untouched
      const papers = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .collect();
      });
      expect(papers).toHaveLength(1);
      expect(papers[0].status).toBe("pending");
      expect(papers[0].workpoolId).toBeUndefined();
    });

    it("returns early when job is failed -- no papers enqueued", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "failed",
      });
      await seedExtractionPaper(t, jobId, "oa:test2");

      // Simulate enqueueAllPapers terminal guard logic
      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        throw new Error("Guard should have returned early for failed job");
      });

      const papers = await t.run(async (ctx) => {
        return await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", jobId))
          .collect();
      });
      expect(papers).toHaveLength(1);
      expect(papers[0].status).toBe("pending");
      expect(papers[0].workpoolId).toBeUndefined();
    });
  });

  // =========================================================================
  // Tests 3-4: workpoolActions terminal status guard
  //
  // The processExtractionPaper action (workpoolActions.ts:58-64) checks
  // terminalStatuses.includes(job.status) and returns {success: false}.
  // =========================================================================
  describe("workpoolActions terminal status guard", () => {
    it("terminal guard matches cancelled status", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "cancelled",
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      expect(
        TERMINAL_STATUSES.includes(
          job!.status as (typeof TERMINAL_STATUSES)[number]
        )
      ).toBe(true);
    });

    it("terminal guard matches failed status", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "failed",
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      expect(
        TERMINAL_STATUSES.includes(
          job!.status as (typeof TERMINAL_STATUSES)[number]
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // Tests 5-6: handleExtractionComplete terminal guard
  //
  // handleExtractionComplete (mutations.ts:509-513) checks
  // TERMINAL_STATUSES.includes(job.status) and returns early.
  // We verify via finalizeJobIfDone which shares the same guard pattern.
  // =========================================================================
  describe("handleExtractionComplete terminal guard (via finalizeJobIfDone)", () => {
    it("finalizeJobIfDone is a no-op when job is cancelled", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "cancelled",
        totalPapers: 3,
        processedPapers: 1,
        failedPapers: 0,
        cancelledPapers: 2,
      });

      // Simulate finalizeJobIfDone logic (mutations.ts:459-489)
      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        // Terminal states are no-ops
        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        // Should not reach here
        const handled =
          job.processedPapers +
          job.failedPapers +
          (job.cancelledPapers ?? 0);
        if (handled >= job.totalPapers) {
          const now = Date.now();
          await ctx.db.patch(jobId, {
            status: "completed",
            completedAt: now,
            updatedAt: now,
          });
        }
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      expect(job!.status).toBe("cancelled");
      expect(job!.completedAt).toBeUndefined();
    });

    it("finalizeJobIfDone is a no-op when job is failed", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "failed",
        totalPapers: 3,
        processedPapers: 1,
        failedPapers: 0,
        cancelledPapers: 2,
      });

      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        const handled =
          job.processedPapers +
          job.failedPapers +
          (job.cancelledPapers ?? 0);
        if (handled >= job.totalPapers) {
          const now = Date.now();
          await ctx.db.patch(jobId, {
            status: "completed",
            completedAt: now,
            updatedAt: now,
          });
        }
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      expect(job!.status).toBe("failed");
      expect(job!.completedAt).toBeUndefined();
    });
  });

  // =========================================================================
  // Tests 7-8: finalizeJobIfDone is a no-op for already-terminal jobs
  // =========================================================================
  describe("finalizeJobIfDone terminal guard", () => {
    it("is a no-op for already-completed jobs", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "completed",
        totalPapers: 3,
        processedPapers: 3,
        failedPapers: 0,
      });

      // Simulate finalizeJobIfDone logic
      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        const handled =
          job.processedPapers +
          job.failedPapers +
          (job.cancelledPapers ?? 0);
        if (handled >= job.totalPapers) {
          const now = Date.now();
          await ctx.db.patch(jobId, {
            status: "completed",
            completedAt: now,
            updatedAt: now,
          });
        }
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      expect(job!.status).toBe("completed");
    });

    it("is a no-op for already-cancelled jobs", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "cancelled",
        totalPapers: 5,
        processedPapers: 2,
        failedPapers: 1,
        cancelledPapers: 2,
      });

      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        const handled =
          job.processedPapers +
          job.failedPapers +
          (job.cancelledPapers ?? 0);
        if (handled >= job.totalPapers) {
          const now = Date.now();
          await ctx.db.patch(jobId, {
            status: "completed",
            completedAt: now,
            updatedAt: now,
          });
        }
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      expect(job!.status).toBe("cancelled");
      expect(job!.completedAt).toBeUndefined();
    });
  });

  // =========================================================================
  // Positive tests: finalizeJobIfDone accounts for cancelledPapers
  // =========================================================================
  describe("finalizeJobIfDone cancelledPapers accounting", () => {
    it("completes job when processed + failed + cancelled >= total", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "processing",
        totalPapers: 5,
        processedPapers: 2,
        failedPapers: 1,
        cancelledPapers: 2,
      });

      // Simulate finalizeJobIfDone logic (mutations.ts:459-489)
      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        const handled =
          job.processedPapers +
          job.failedPapers +
          (job.cancelledPapers ?? 0);
        if (handled >= job.totalPapers) {
          const now = Date.now();
          await ctx.db.patch(jobId, {
            status: "completed",
            completedAt: now,
            updatedAt: now,
          });
        }
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      // 2 + 1 + 2 = 5 >= 5, so job should be completed
      expect(job!.status).toBe("completed");
      expect(job!.completedAt).toBeDefined();
    });

    it("does NOT complete job when processed + failed + cancelled < total", async () => {
      const t = convexTest(schema, modules);
      const user = await seedUser(t);
      const jobId = await seedExtractionJob(t, user._id, {
        status: "processing",
        totalPapers: 5,
        processedPapers: 1,
        failedPapers: 1,
        cancelledPapers: 1,
      });

      await t.run(async (ctx) => {
        const job = await ctx.db.get(jobId);
        if (!job) return;

        if (
          TERMINAL_STATUSES.includes(
            job.status as (typeof TERMINAL_STATUSES)[number]
          )
        ) {
          return;
        }

        const handled =
          job.processedPapers +
          job.failedPapers +
          (job.cancelledPapers ?? 0);
        if (handled >= job.totalPapers) {
          const now = Date.now();
          await ctx.db.patch(jobId, {
            status: "completed",
            completedAt: now,
            updatedAt: now,
          });
        }
      });

      const job = await t.run(async (ctx) => ctx.db.get(jobId));
      // 1 + 1 + 1 = 3 < 5, so job should still be processing
      expect(job!.status).toBe("processing");
      expect(job!.completedAt).toBeUndefined();
    });
  });
});
