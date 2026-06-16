import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type TestInstance = ReturnType<typeof convexTest>;

const ITEM = {
  bucketKey: "history:W1",
  source: "history" as const,
  sourceRefId: "search_1",
  title: "Paper One",
  authors: ["A"],
  openalexId: "W1",
};

async function seedChatJob(t: TestInstance) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_source_refresh",
      email: "source-refresh@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat" as const,
      sourceType: "history" as const,
      name: "Chat",
      chatThreadId: "thread_source_refresh",
      messageCount: 2,
      chatSourceFingerprint: "old-fingerprint",
      chatSourceOpenAlexIds: ["W1", "W2"],
      createdAt: now,
      updatedAt: now,
    });
    const sourceOne = await ctx.db.insert("extractionJobSources", {
      jobId,
      position: 0,
      ...ITEM,
      openalexId: "W1",
      title: "Paper One",
    });
    const sourceTwo = await ctx.db.insert("extractionJobSources", {
      jobId,
      position: 1,
      ...ITEM,
      bucketKey: "history:W2",
      openalexId: "W2",
      title: "Paper Two",
    });
    await ctx.db.insert("chatPapers", {
      jobId,
      sourceId: sourceOne,
      included: true,
    });
    await ctx.db.insert("chatPapers", {
      jobId,
      sourceId: sourceTwo,
      included: false,
    });
    return { jobId };
  });
}

describe("applyChatSourceRefresh", () => {
  it("replaces ordered sources, preserves inclusion by OpenAlex id, and records a boundary event", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t);

    const result = await t.mutation(
      internal.chat.threads.applyChatSourceRefresh,
      {
        jobId,
        sourceFingerprint: "new-fingerprint",
        items: [
          {
            ...ITEM,
            bucketKey: "history:W2",
            openalexId: "W2",
            title: "Paper Two Updated",
          },
          {
            ...ITEM,
            bucketKey: "history:W3",
            openalexId: "W3",
            title: "Paper Three",
          },
        ],
      },
    );

    expect(result).toEqual({
      jobId,
      changed: true,
      sourcesChanged: true,
    });

    await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      expect(job?.chatSourceFingerprint).toBe("new-fingerprint");
      expect(job?.chatSourceOpenAlexIds).toEqual(["W2", "W3"]);

      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect();
      expect(sources.map((source) => source.openalexId)).toEqual(["W2", "W3"]);

      const papers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      const sourceById = new Map(
        sources.map((source) => [source._id, source.openalexId]),
      );
      const includedByOpenAlex = new Map(
        papers.map((paper) => [sourceById.get(paper.sourceId), paper.included]),
      );
      expect(includedByOpenAlex.get("W2")).toBe(false);
      expect(includedByOpenAlex.get("W3")).toBe(true);

      const events = await ctx.db
        .query("chatSourceEvents")
        .withIndex("by_thread_createdAt", (q) =>
          q.eq("threadId", "thread_source_refresh"),
        )
        .collect();
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("sources_updated");
      expect(events[0].boundaryOrder).toBe(2);
    });
  });

  it("updates metadata without recording a boundary when ordered OpenAlex ids are unchanged", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t);

    const result = await t.mutation(
      internal.chat.threads.applyChatSourceRefresh,
      {
        jobId,
        sourceFingerprint: "new-fingerprint",
        items: [
          {
            ...ITEM,
            openalexId: "W1",
            title: "Paper One Updated",
          },
          {
            ...ITEM,
            bucketKey: "history:W2",
            openalexId: "W2",
            title: "Paper Two Updated",
          },
        ],
      },
    );

    expect(result.sourcesChanged).toBe(false);

    await t.run(async (ctx) => {
      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect();
      expect(sources.map((source) => source.title)).toEqual([
        "Paper One Updated",
        "Paper Two Updated",
      ]);

      const events = await ctx.db
        .query("chatSourceEvents")
        .withIndex("by_job_createdAt", (q) => q.eq("jobId", jobId))
        .collect();
      expect(events).toHaveLength(0);
    });
  });

  it("rejects refreshes while the chat is generating", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { isGenerating: true });
    });

    await expect(
      t.mutation(internal.chat.threads.applyChatSourceRefresh, {
        jobId,
        sourceFingerprint: "new-fingerprint",
        items: [{ ...ITEM, openalexId: "W3" }],
      }),
    ).rejects.toThrow(/response is already being generated/i);
  });

  it("rejects an empty refreshed source set", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedChatJob(t);

    await expect(
      t.mutation(internal.chat.threads.applyChatSourceRefresh, {
        jobId,
        sourceFingerprint: "empty",
        items: [],
      }),
    ).rejects.toThrow(/at least one source/i);
  });
});
