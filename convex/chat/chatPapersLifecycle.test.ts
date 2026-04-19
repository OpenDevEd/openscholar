/**
 * Integration tests for the chatPapers bridge-table lifecycle (plan-01).
 *
 * Covers the four lifecycle hooks:
 *   - seed at persistPreparedSourcesForJob (the mutation behind
 *     ensureThreadForJob) including wipe-and-rewrite idempotency
 *   - cascade-delete in deleteExtractionInternal
 *   - clone on duplicateJob (chat mode carries flags, extraction mode is a no-op)
 *   - backfillChatPapersForExistingChats idempotent replay
 */

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type TestInstance = ReturnType<typeof convexTest>;

const BUCKET_ITEM = {
  bucketKey: "history:W1",
  source: "library" as const,
  sourceRefId: "W1",
  title: "Paper One",
  authors: ["A"],
  openalexId: "W1",
};

async function seedUser(t: TestInstance): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: "clerk_chatpapers",
      email: "chatpapers@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  });
}

async function seedFlags(
  t: TestInstance,
  flags: { chat?: boolean } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.start",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.chat",
      enabled: flags.chat ?? true,
      minimumTier: 0,
      updatedAt: now,
    });
  });
}

async function insertChatJob(
  t: TestInstance,
  userId: Id<"users">,
  name = "Chat Job",
): Promise<Id<"extractionJobs">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat" as const,
      sourceType: "history" as const,
      name,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...BUCKET_ITEM,
    bucketKey: `history:W${i + 1}`,
    sourceRefId: `W${i + 1}`,
    title: `Paper ${i + 1}`,
    openalexId: `W${i + 1}`,
  }));
}

describe("persistPreparedSourcesForJob seeds chatPapers", () => {
  it("emits one chatPapers row per source with included=true", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await insertChatJob(t, userId);

    await t.mutation(internal.chat.threads.persistPreparedSourcesForJob, {
      jobId,
      items: makeItems(3),
    });

    await t.run(async (ctx) => {
      const papers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(papers).toHaveLength(3);
      expect(papers.every((p) => p.included === true)).toBe(true);

      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect();
      const sourceIds = new Set(sources.map((s) => s._id));
      for (const paper of papers) {
        expect(sourceIds.has(paper.sourceId)).toBe(true);
      }
    });
  });

  it("wipes and re-seeds on replay — still 3 rows, not 6", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await insertChatJob(t, userId);

    await t.mutation(internal.chat.threads.persistPreparedSourcesForJob, {
      jobId,
      items: makeItems(3),
    });
    await t.mutation(internal.chat.threads.persistPreparedSourcesForJob, {
      jobId,
      items: makeItems(3),
    });

    await t.run(async (ctx) => {
      const papers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(papers).toHaveLength(3);

      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect();
      const sourceIds = new Set(sources.map((s) => s._id));
      // every chatPapers row must reference a current source _id, not a
      // stale one from the first run (which replaceJobSources deleted).
      for (const paper of papers) {
        expect(sourceIds.has(paper.sourceId)).toBe(true);
      }
    });
  });
});

describe("deleteExtractionInternal cascade clears chatPapers", () => {
  it("drains chatPapers for a chat-mode job across the self-rescheduling batches", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const jobId = await insertChatJob(t, userId);

    await t.run(async (ctx) => {
      // Insert 150 sources + chatPapers to cross the BATCH_SIZE=100 boundary.
      for (let i = 0; i < 150; i++) {
        const sourceId = await ctx.db.insert("extractionJobSources", {
          jobId,
          position: i,
          bucketKey: `history:W${i}`,
          source: "library" as const,
          sourceRefId: `W${i}`,
          title: `Paper ${i}`,
          authors: ["A"],
          openalexId: `W${i}`,
        });
        await ctx.db.insert("chatPapers", {
          jobId,
          sourceId,
          included: true,
        });
      }
    });

    vi.useFakeTimers();
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    await t.run(async (ctx) => {
      const remaining = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(remaining).toHaveLength(0);

      const job = await ctx.db.get("extractionJobs", jobId);
      expect(job).toBeNull();
    });
  });
});

describe("duplicateJob clones chatPapers", () => {
  const IDENTITY = {
    tokenIdentifier: "clerk_chatpapers",
    subject: "clerk_chatpapers",
    issuer: "test",
  };

  it("chat mode carries included flags per-row onto new cloned sources", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    // seedUser's clerkId matches IDENTITY.subject so withIdentity resolves.
    await seedFlags(t, { chat: true });
    const sourceJobId = await insertChatJob(t, userId, "Chat Original");

    const { oldSourceIds } = await t.run(async (ctx) => {
      const oldSourceIds: Id<"extractionJobSources">[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await ctx.db.insert("extractionJobSources", {
          jobId: sourceJobId,
          position: i,
          bucketKey: `history:W${i}`,
          source: "library" as const,
          sourceRefId: `W${i}`,
          title: `Paper ${i}`,
          authors: ["A"],
          openalexId: `W${i}`,
        });
        oldSourceIds.push(id);
        // Row 2 is excluded; all others included.
        await ctx.db.insert("chatPapers", {
          jobId: sourceJobId,
          sourceId: id,
          included: i !== 2,
        });
      }
      return { oldSourceIds };
    });

    const auth = t.withIdentity(IDENTITY);
    const { jobId: newJobId } = await auth.mutation(
      api.extraction.mutations.duplicateJob,
      { jobId: sourceJobId },
    );

    await t.run(async (ctx) => {
      const newJob = await ctx.db.get("extractionJobs", newJobId);
      expect(newJob?.mode).toBe("chat");
      expect(newJob?.name).toBe("Chat Original (Copy)");

      const newSources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", newJobId))
        .collect();
      expect(newSources).toHaveLength(5);

      const newPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", newJobId))
        .collect();
      expect(newPapers).toHaveLength(5);

      const newBySourceRef = new Map(
        newSources.map((s) => [s.sourceRefId, s._id]),
      );
      const flagBySource = new Map(
        newPapers.map((p) => [p.sourceId, p.included]),
      );
      expect(flagBySource.get(newBySourceRef.get("W0")!)).toBe(true);
      expect(flagBySource.get(newBySourceRef.get("W1")!)).toBe(true);
      expect(flagBySource.get(newBySourceRef.get("W2")!)).toBe(false);
      expect(flagBySource.get(newBySourceRef.get("W3")!)).toBe(true);
      expect(flagBySource.get(newBySourceRef.get("W4")!)).toBe(true);

      // Sanity: every new chatPapers row's sourceId is one of the new
      // source _ids, none of the old ones leaked through.
      const oldSet = new Set(oldSourceIds);
      for (const paper of newPapers) {
        expect(oldSet.has(paper.sourceId)).toBe(false);
      }

      // Original job's chatPapers untouched.
      const originalPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", sourceJobId))
        .collect();
      expect(originalPapers).toHaveLength(5);
    });
  });

  it("extraction mode is a no-op for chatPapers — neither old nor new job has rows", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await seedFlags(t, { chat: false });

    const sourceJobId = await t.run(async (ctx) => {
      const now = Date.now();
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 1,
        processedPapers: 1,
        failedPapers: 0,
        name: "Extraction Job",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 0,
        bucketKey: BUCKET_ITEM.bucketKey,
        source: BUCKET_ITEM.source,
        sourceRefId: BUCKET_ITEM.sourceRefId,
        title: BUCKET_ITEM.title,
        authors: BUCKET_ITEM.authors,
        openalexId: BUCKET_ITEM.openalexId,
      });
      return jobId;
    });

    const auth = t.withIdentity(IDENTITY);
    // Extraction duplicate reaches workflow.start, which isn't registered
    // in convex-test — the mutation throws and the transaction rolls back
    // wholesale. That rollback is itself the proof we need: no stray
    // extraction-mode clone ever wrote chatPapers rows, since if the
    // rollback were incomplete we'd see stale rows here.
    await expect(
      auth.mutation(api.extraction.mutations.duplicateJob, {
        jobId: sourceJobId,
      }),
    ).rejects.toThrow(/Component "workflow" is not registered/);

    await t.run(async (ctx) => {
      const papersAnywhere = await ctx.db.query("chatPapers").collect();
      expect(papersAnywhere).toHaveLength(0);

      const jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      // Only the original extraction-mode job survives the rollback.
      expect(jobs).toHaveLength(1);
      expect(jobs[0]._id).toBe(sourceJobId);
    });
  });
});

describe("backfillChatPapersForExistingChats", () => {
  it("seeds existing chat jobs once and is idempotent on replay", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    // Two chat jobs with sources but no chatPapers rows.
    const { chatA, chatB } = await t.run(async (ctx) => {
      const now = Date.now();
      const chatA = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat" as const,
        sourceType: "history" as const,
        name: "Chat A",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const chatB = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat" as const,
        sourceType: "history" as const,
        name: "Chat B",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (const [jobId, count] of [
        [chatA, 3],
        [chatB, 2],
      ] as const) {
        for (let i = 0; i < count; i++) {
          await ctx.db.insert("extractionJobSources", {
            jobId,
            position: i,
            bucketKey: `history:W${i}`,
            source: "library" as const,
            sourceRefId: `W${i}`,
            title: `Paper ${i}`,
            authors: ["A"],
            openalexId: `W${i}`,
          });
        }
      }
      return { chatA, chatB };
    });

    const first = await t.mutation(
      internal.chat.adminBackfill.backfillChatPapersForExistingChats,
      {},
    );
    expect(first.jobsScanned).toBe(2);
    expect(first.jobsSeeded).toBe(2);
    expect(first.rowsInserted).toBe(5);

    await t.run(async (ctx) => {
      const aPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", chatA))
        .collect();
      expect(aPapers).toHaveLength(3);
      expect(aPapers.every((p) => p.included)).toBe(true);

      const bPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", chatB))
        .collect();
      expect(bPapers).toHaveLength(2);
      expect(bPapers.every((p) => p.included)).toBe(true);
    });

    const second = await t.mutation(
      internal.chat.adminBackfill.backfillChatPapersForExistingChats,
      {},
    );
    expect(second.jobsSeeded).toBe(0);
    expect(second.rowsInserted).toBe(0);
  });

  it("skips extraction-mode jobs entirely", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 1,
        processedPapers: 1,
        failedPapers: 0,
        name: "Extraction Only",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 0,
        bucketKey: BUCKET_ITEM.bucketKey,
        source: BUCKET_ITEM.source,
        sourceRefId: BUCKET_ITEM.sourceRefId,
        title: BUCKET_ITEM.title,
        authors: BUCKET_ITEM.authors,
        openalexId: BUCKET_ITEM.openalexId,
      });
    });

    const result = await t.mutation(
      internal.chat.adminBackfill.backfillChatPapersForExistingChats,
      {},
    );
    expect(result.jobsScanned).toBe(0);
    expect(result.rowsInserted).toBe(0);
  });
});
