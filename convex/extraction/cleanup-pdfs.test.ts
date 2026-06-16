import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("cleanupOldPdfs", () => {
  it("deletes storage and clears storageId for completed papers older than maxAgeHours", async () => {
    const t = convexTest(schema);
    const maxAgeHours = 24 * 30;
    const old = Date.now() - maxAgeHours * 60 * 60 * 1000 - 60_000; // 1 min past cutoff
    const fresh = Date.now() - 60_000;

    const { oldPaperIds, freshPaperId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkId: "clerk_cleanup",
        email: "c@test.com",
        firstName: "C",
        lastName: "U",
        state: "active" as const,
        createdAt: old,
        updatedAt: old,
        lastLoginAt: old,
      });
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 10,
        name: "Cleanup Test Job",
        createdAt: old,
        updatedAt: old,
      });

      const oldPaperIds = [] as string[];
      for (let i = 0; i < 10; i++) {
        const storageId = await ctx.storage.store(
          new Blob([`pdf-${i}`], { type: "application/pdf" }),
        );
        const paperId = await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:old${i}`,
          title: `Old ${i}`,
          status: "completed" as const,
          completedAt: old,
          storageId,
        });
        oldPaperIds.push(paperId as unknown as string);
      }

      // One paper that should NOT be cleaned — still fresh.
      const freshStorageId = await ctx.storage.store(
        new Blob([`fresh-pdf`], { type: "application/pdf" }),
      );
      const freshPaperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:fresh",
        title: "Fresh",
        status: "completed" as const,
        completedAt: fresh,
        storageId: freshStorageId,
      });

      return { oldPaperIds, freshPaperId };
    });

    const result = await t.mutation(
      internal.extraction.mutations.internal.admin.cleanupOldPdfs,
      { maxAgeHours },
    );
    expect(result.cleaned).toBe(10);

    await t.run(async (ctx) => {
      for (const id of oldPaperIds) {
        const p = await ctx.db.get(id as never);
        expect((p as { storageId?: unknown })?.storageId).toBeUndefined();
      }
      const fresh = await ctx.db.get(freshPaperId);
      expect(fresh?.storageId).toBeDefined();
    });
  });

  it("is a no-op when no old papers exist", async () => {
    const t = convexTest(schema);

    const result = await t.mutation(
      internal.extraction.mutations.internal.admin.cleanupOldPdfs,
      { maxAgeHours: 24 * 30 },
    );
    expect(result.cleaned).toBe(0);
  });

  it("continues past old completed papers that do not have stored PDFs", async () => {
    const t = convexTest(schema);
    const maxAgeHours = 24 * 30;
    const old = Date.now() - maxAgeHours * 60 * 60 * 1000 - 60_000;

    const storedPaperId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkId: "clerk_cleanup_cursor",
        email: "cursor@test.com",
        firstName: "Cursor",
        lastName: "Cleanup",
        state: "active" as const,
        createdAt: old,
        updatedAt: old,
        lastLoginAt: old,
      });
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 501,
        name: "Cleanup Cursor Test Job",
        createdAt: old,
        updatedAt: old,
      });

      for (let i = 0; i < 500; i++) {
        await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:cursor-skip-${i}`,
          title: `Skipped ${i}`,
          status: "completed" as const,
          completedAt: old,
        });
      }

      const storageId = await ctx.storage.store(
        new Blob(["stored-pdf"], { type: "application/pdf" }),
      );
      return await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:cursor-stored",
        title: "Stored",
        status: "completed" as const,
        completedAt: old + 1,
        storageId,
      });
    });

    try {
      vi.useFakeTimers();
      const firstPage = await t.mutation(
        internal.extraction.mutations.internal.admin.cleanupOldPdfs,
        { maxAgeHours },
      );
      expect(firstPage.cleaned).toBe(0);

      const continuationCursor = await t.run(async (ctx) => {
        const scheduled = await ctx.db.system
          .query("_scheduled_functions")
          .collect();
        const cleanupContinuation = scheduled.find((sf) =>
          sf.name.includes("cleanupOldPdfs"),
        );
        const args = cleanupContinuation?.args as
          | ReadonlyArray<{ cursor?: string | null }>
          | undefined;
        return args?.[0]?.cursor ?? null;
      });

      expect(continuationCursor).toEqual(expect.any(String));
      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      const storedPaper = await ctx.db.get(storedPaperId);
      expect(storedPaper?.storageId).toBeUndefined();
    });
  });
});
