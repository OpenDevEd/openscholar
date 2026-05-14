import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

async function seedChatJob(
  t: ReturnType<typeof convexTest>,
  opts: {
    isGenerating?: boolean;
    generatingStartedAt?: number;
  } = {},
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "c_conc",
      email: "c@t",
      state: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat",
      sourceType: "history",
      name: "c",
      messageCount: 0,
      createdAt: 0,
      updatedAt: 0,
      ...(opts.isGenerating != null
        ? {
            isGenerating: opts.isGenerating,
            generatingStartedAt: opts.generatingStartedAt ?? Date.now(),
          }
        : {}),
    });
    return { userId, jobId };
  });
}

describe("acquireThreadLock / releaseThreadLock", () => {
  it("sets isGenerating + generatingStartedAt on acquire", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t);
    await t.mutation(
      internal.chat.concurrency.acquireThreadLock,
      { jobId },
    );
    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(after?.isGenerating).toBe(true);
    expect(typeof after?.generatingStartedAt).toBe("number");
  });

  it("throws CONFLICT when the same thread is already generating", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t, { isGenerating: true });
    await expect(
      t.mutation(internal.chat.concurrency.acquireThreadLock, { jobId }),
    ).rejects.toThrow(/still generating/i);
  });

  it("throws CONFLICT when the user is at the per-plan chat cap", async () => {
    const t = convexTest(schema);
    // Seed 3 in-flight chats (the default cap), then try to acquire a 4th.
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        clerkId: "c_cap",
        email: "c@t",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("extractionJobs", {
          userId,
          mode: "chat",
          sourceType: "history",
          name: `c${i}`,
          messageCount: 0,
          createdAt: 0,
          updatedAt: 0,
          isGenerating: true,
          generatingStartedAt: Date.now(),
        });
      }
    });
    const fourth = await t.run(async (ctx) =>
      ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat",
        sourceType: "history",
        name: "c3",
        messageCount: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await expect(
      t.mutation(internal.chat.concurrency.acquireThreadLock, {
        jobId: fourth,
      }),
    ).rejects.toThrow(/concurrent chats/i);
  });

  it("releaseThreadLock is idempotent — clears or no-ops", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t, { isGenerating: true });
    await t.mutation(
      internal.chat.concurrency.releaseThreadLock,
      { jobId },
    );
    const first = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(first?.isGenerating).toBe(false);
    // Second call is a no-op.
    await t.mutation(
      internal.chat.concurrency.releaseThreadLock,
      { jobId },
    );
    const second = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(second?.isGenerating).toBe(false);
  });

  it("releaseThreadLock does not clear a newer generation attempt", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t, { isGenerating: true });
    await t.run(async (ctx) =>
      ctx.db.patch(jobId, {
        chatGenerationAttemptId: "new-attempt",
        shouldAbort: true,
      }),
    );

    await t.mutation(internal.chat.concurrency.releaseThreadLock, {
      jobId,
      generationAttemptId: "old-attempt",
    });

    const afterStaleRelease = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(afterStaleRelease?.isGenerating).toBe(true);
    expect(afterStaleRelease?.chatGenerationAttemptId).toBe("new-attempt");
    expect(afterStaleRelease?.shouldAbort).toBe(true);

    await t.mutation(internal.chat.concurrency.releaseThreadLock, {
      jobId,
      generationAttemptId: "new-attempt",
    });

    const afterMatchingRelease = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(afterMatchingRelease?.isGenerating).toBe(false);
    expect(afterMatchingRelease?.chatGenerationAttemptId).toBeUndefined();
    expect(afterMatchingRelease?.shouldAbort).toBeUndefined();
  });
});

describe("cleanupZombieChatLocks", () => {
  it("clears only stale locks; keeps fresh locks and unlocked rows", async () => {
    const t = convexTest(schema);
    const STALE = Date.now() - 6 * 60 * 1000;
    const FRESH = Date.now() - 1 * 60 * 1000;

    const { jobId: staleId } = await seedChatJob(t, {
      isGenerating: true,
      generatingStartedAt: STALE,
    });
    const { jobId: freshId } = await seedChatJob(t, {
      isGenerating: true,
      generatingStartedAt: FRESH,
    });
    const { jobId: unlockedId } = await seedChatJob(t, {});

    const { cleared } = await t.mutation(
      internal.chat.concurrency.cleanupZombieChatLocks,
      {},
    );
    expect(cleared).toBe(1);

    const [stale, fresh, unlocked] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(staleId),
        ctx.db.get(freshId),
        ctx.db.get(unlockedId),
      ]),
    );
    expect(stale?.isGenerating).toBe(false);
    expect(fresh?.isGenerating).toBe(true);
    expect(unlocked?.isGenerating).toBeUndefined();
  });

  it("ignores non-chat rows even when they carry a stale isGenerating flag", async () => {
    // Plan-03 R1: the indexed scan must gate on mode === "chat"; a
    // stale-locked extraction-mode row must NOT be touched. This is a
    // defensive guarantee — extraction jobs never set isGenerating in
    // practice, but the scan boundary must be tight.
    const t = convexTest(schema);
    const STALE = Date.now() - 6 * 60 * 1000;

    const { chatStaleId, extractionStaleId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkId: "c_h4_r1",
        email: "h4r1@t",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      const chatStaleId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat",
        sourceType: "history",
        name: "chat-stale",
        messageCount: 0,
        createdAt: 0,
        updatedAt: 0,
        isGenerating: true,
        generatingStartedAt: STALE,
      });
      const extractionStaleId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction",
        sourceType: "history",
        name: "extraction-stale",
        messageCount: 0,
        createdAt: 0,
        updatedAt: 0,
        isGenerating: true,
        generatingStartedAt: STALE,
      });
      return { chatStaleId, extractionStaleId };
    });

    const { cleared } = await t.mutation(
      internal.chat.concurrency.cleanupZombieChatLocks,
      {},
    );
    expect(cleared).toBe(1);

    const [chatAfter, extractionAfter] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(chatStaleId),
        ctx.db.get(extractionStaleId),
      ]),
    );
    expect(chatAfter?.isGenerating).toBe(false);
    // Extraction row is untouched — index gate excludes it.
    expect(extractionAfter?.isGenerating).toBe(true);
    expect(extractionAfter?.generatingStartedAt).toBe(STALE);
  });
});
