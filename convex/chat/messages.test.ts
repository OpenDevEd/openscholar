/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { paperChat } from "./agent";

function createTestConvex() {
  const t = convexTest(schema);
  registerAgentComponent(t);
  return t;
}

async function seedUserAndChatJob(
  t: ReturnType<typeof convexTest>,
  opts: { isGenerating?: boolean; threadId?: string } = {},
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "c_msg",
      email: "m@t",
      state: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    const { threadId: createdThreadId } = await paperChat.createThread(ctx, {
      userId,
      title: "chat test thread",
    });
    const threadId = opts.threadId ?? createdThreadId;
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat",
      sourceType: "history",
      name: "m",
      messageCount: 0,
      chatThreadId: threadId,
      createdAt: 0,
      updatedAt: 0,
      ...(opts.isGenerating != null
        ? { isGenerating: opts.isGenerating, generatingStartedAt: Date.now() }
        : {}),
    });
    return { userId, jobId, threadId };
  });
}

function asCaller(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://test.clerk.local|${clerkId}`,
    issuer: "https://test.clerk.local",
  });
}

async function seedChatPapers(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"extractionJobs">,
  includedMask: boolean[],
) {
  await t.run(async (ctx) => {
    for (let i = 0; i < includedMask.length; i++) {
      const sourceId = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: i + 1,
        bucketKey: `openalex:W${2000 + i}`,
        source: "library",
        sourceRefId: `W${2000 + i}`,
        openalexId: `W${2000 + i}`,
        title: `Paper ${i + 1}`,
        authors: ["Doe"],
        year: 2024,
        abstract: "abs",
      });
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId,
        included: includedMask[i],
      });
    }
  });
}

describe("chat.messages — auth + mode gating", () => {
  it("sendMessage rejects unauthenticated callers", async () => {
    const t = createTestConvex();
    const { threadId } = await seedUserAndChatJob(t);
    await expect(
      t.mutation(api.chat.messages.sendMessage, {
        threadId,
        prompt: "hi",
      }),
    ).rejects.toThrow();
  });

  it("sendMessage rejects callers who don't own the thread", async () => {
    const t = createTestConvex();
    const { threadId } = await seedUserAndChatJob(t);
    await t.run(async (ctx) =>
      ctx.db.insert("users", {
        clerkId: "c_other",
        email: "o@t",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const other = asCaller(t, "c_other");
    await expect(
      other.mutation(api.chat.messages.sendMessage, { threadId, prompt: "hi" }),
    ).rejects.toThrow(/access denied|forbidden/i);
  });

  it("abortGeneration flips shouldAbort when the thread is generating", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const caller = asCaller(t, "c_msg");
    await caller.mutation(api.chat.messages.abortGeneration, { threadId });
    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(after?.shouldAbort).toBe(true);
  });

  it("abortGeneration no-ops when nothing is in flight", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");
    await caller.mutation(api.chat.messages.abortGeneration, { threadId });
    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(after?.shouldAbort).toBeUndefined();
  });

  it("sendMessage throws NO_SOURCES_INCLUDED when every chatPapers row is excluded", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    await seedChatPapers(t, jobId, [false, false, false]);

    const caller = asCaller(t, "c_msg");
    const err = await caller
      .mutation(api.chat.messages.sendMessage, { threadId, prompt: "hi" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvexError);
    // convex-test serializes .data to a JSON string on the caught error.
    const envelope = JSON.parse(
      (err as ConvexError<string>).data,
    ) as { code: string; message?: string };
    expect(envelope.code).toBe("NO_SOURCES_INCLUDED");

    // Guard short-circuits before any saveMessage / job.patch runs.
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.messageCount).toBe(0);
    expect(job?.isGenerating).toBeUndefined();
    expect(job?.lastMessageAt).toBeUndefined();
  });

  it("sendMessage succeeds when at least one chatPapers row is included", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    await seedChatPapers(t, jobId, [false, true, false]);

    const caller = asCaller(t, "c_msg");
    await caller.mutation(api.chat.messages.sendMessage, {
      threadId,
      prompt: "hi",
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.messageCount).toBe(1);
    expect(job?.isGenerating).toBe(true);
  });

  it("listThreadMessages resolves on an empty thread when streamArgs is omitted", async () => {
    const t = createTestConvex();
    const { threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");

    await expect(
      caller.query(api.chat.messages.listThreadMessages, {
        threadId,
        paginationOpts: { cursor: null, numItems: 20 },
        streamArgs: undefined,
      }),
    ).resolves.toMatchObject({
      page: [],
      isDone: true,
      continueCursor: "[]",
    });
  });
});
