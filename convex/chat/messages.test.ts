/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../_generated/api";
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
