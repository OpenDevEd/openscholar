import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { components, internal } from "../_generated/api";
import schema from "../schema";

it("deletes the chat jobs and what points at them, and leaves every extraction job without chat fields", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    registerAgentComponent(t);
    const { _id: threadId } = await t.mutation(components.agent.threads.createThread, {});
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkId: "remove-chat", email: "chat@test", state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
      const chatId = await ctx.db.insert("extractionJobs", { userId, mode: "chat", name: "Chat", chatThreadId: threadId, messageCount: 4, isGenerating: false, createdAt: 1, updatedAt: 1 });
      const sourceId = await ctx.db.insert("extractionJobSources", { jobId: chatId, position: 0, bucketKey: "history:W1", source: "history", sourceRefId: "W1", title: "Paper", authors: [] });
      await ctx.db.insert("chatPapers", { jobId: chatId, sourceId, included: true });
      await ctx.db.insert("chatSourceEvents", { jobId: chatId, threadId, kind: "sources_updated", boundaryOrder: 1, createdAt: 1 });
      const extractionId = await ctx.db.insert("extractionJobs", { userId, mode: "extraction", name: "Extraction", sourceType: "history", status: "completed", totalPapers: 0, lastMessageAt: 1, chatSourceFingerprint: "f", createdAt: 1, updatedAt: 1 });
      const data = { id: "s1", query: "tutoring", field: "title_and_abstract" as const, count: 3, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", chatJobIdsByAccountId: { [userId]: chatId } };
      const searchId = await ctx.db.insert("searches", { userId, localId: "s1", revision: 1, data });
      await ctx.db.insert("searchRevisions", { userId, searchId, revision: 0, author: "user", data, deleted: false, createdAt: 1 });
      await ctx.db.insert("featureFlags", { key: "extraction.chat", enabled: false, updatedAt: 1 });
      return { chatId, extractionId, searchId };
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.setSystemTime(Date.now() + 60_000);

    const before = await t.action(internal.migrations.removeChat.dryRun, {});
    expect(before.chats).toEqual([expect.objectContaining({ jobId: ids.chatId, threadId, chatPapers: 1, sourceEvents: 1, sources: 1 })]);
    expect(before.tally).toEqual({ extractionJobs: { at: expect.any(Number), count: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }, chatJobs: 1, jobsWithChatFields: 1, searchesLinked: 1, revisionsLinked: 1 });

    await expect(t.action(internal.migrations.removeChat.deleteChats, { count: 2 })).rejects.toThrow(/not the 2 expected/);
    expect(await t.action(internal.migrations.removeChat.deleteChats, { count: 1 })).toEqual([ids.chatId]);
    for (const migration of [internal.migrations.removeChat.jobs, internal.migrations.removeChat.searches, internal.migrations.removeChat.revisions]) {
      await t.mutation(migration, { cursor: null, dryRun: false });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.action(internal.migrations.removeChat.verify, { jobs: before.tally.extractionJobs, chatJobIds: [ids.chatId], threadIds: [threadId] }))
      .toEqual({ chatJobs: 0, jobsWithChatFields: 0, searchesLinked: 0, revisionsLinked: 0, jobsKept: true, threadsLeft: [], cascade: { chatPapers: 0, sourceEvents: 0, sources: 0 } });
    const lost = { ...before.tally.extractionJobs, count: 2 };
    expect((await t.action(internal.migrations.removeChat.verify, { jobs: lost, chatJobIds: [ids.chatId], threadIds: [threadId] })).jobsKept).toBe(false);
    const left = await t.run(async (ctx) => ({
      chatPapers: await ctx.db.query("chatPapers").collect(),
      events: await ctx.db.query("chatSourceEvents").collect(),
      sources: await ctx.db.query("extractionJobSources").collect(),
      flag: await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "extraction.chat")).unique(),
      search: await ctx.db.get("searches", ids.searchId),
      extraction: await ctx.db.get("extractionJobs", ids.extractionId),
    }));
    expect(left).toMatchObject({ chatPapers: [], events: [], sources: [], flag: null, search: { data: { query: "tutoring", count: 3 } } });
    expect(left.extraction).toMatchObject({ name: "Extraction", status: "completed" });
    expect(left.extraction).not.toHaveProperty("mode");
  } finally {
    vi.useRealTimers();
  }
});
