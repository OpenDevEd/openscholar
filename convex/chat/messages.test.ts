/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { paperChat } from "./agent";

// Capture the composed abortSignal the library hands to doStream so
// tests can assert it transitioned to aborted after we flip
// job.shouldAbort. Populated on each mock doStream call.
const { mockDoStream, doStreamArgsSeen } = vi.hoisted(() => ({
  mockDoStream: vi.fn(),
  doStreamArgsSeen: [] as Array<{ abortSignal?: AbortSignal }>,
}));

// vi.mock replaces ./provider for every importer in this test file —
// including generateResponse's own import. The factory is async so it
// can pull in ai/test (which is not available at the hoisted phase).
vi.mock("./provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async () => ({
      model: new MockLanguageModelV3({
        doStream: async (options) => {
          doStreamArgsSeen.push({ abortSignal: options.abortSignal });
          return mockDoStream(options);
        },
      }),
      modelSlug: "mock/model",
      pricing: { input: 0, output: 0 },
    }),
  };
});

beforeEach(() => {
  mockDoStream.mockReset();
  doStreamArgsSeen.length = 0;
});

afterEach(() => {
  // Abort any lingering signals so stale setIntervals from abandoned
  // tests don't leak across test boundaries.
  for (const { abortSignal } of doStreamArgsSeen) {
    if (abortSignal && !abortSignal.aborted) {
      // No-op — just a sanity net.
    }
  }
});

/** A doStream that opens a minimal stream and blocks until the
 *  composed abortSignal fires, then closes cleanly. */
function hangingDoStream(
  opts: { onStarted?: () => void } = {},
): (options: {
  abortSignal?: AbortSignal;
}) => Promise<{ stream: ReadableStream<unknown> }> {
  return async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        opts.onStarted?.();
        options.abortSignal?.addEventListener("abort", () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    }),
  });
}

/** Poll helper: wait until a predicate returns true, or throw. */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 2_000, intervalMs = 20 } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function seedModelAndCredits(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
): Promise<{ modelId: Id<"models"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const modelId = await ctx.db.insert("models", {
      modelId: "mock/model",
      name: "Mock Model",
      provider: "openrouter",
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      costMarkup: 1,
      isServed: true,
      sortOrder: 0,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: 10_000,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return { modelId };
  });
}

async function seedUserMessage(
  t: ReturnType<typeof convexTest>,
  threadId: string,
  body: string,
): Promise<string> {
  return await t.run(async (ctx) => {
    const { messageId } = await paperChat.saveMessage(ctx, {
      threadId,
      prompt: body,
      skipEmbeddings: true,
    });
    return messageId;
  });
}

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

describe("chat.messages.generateResponse — stop-streaming wiring", () => {
  it("A1 — poller fires controller.abort() when shouldAbort flips true", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    mockDoStream.mockImplementation(hangingDoStream());

    const actionPromise = t.action(
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId },
    );

    await waitFor(() => doStreamArgsSeen.length > 0);
    // Sanity: the composed signal exists and is not yet aborted.
    expect(doStreamArgsSeen[0]?.abortSignal).toBeDefined();
    expect(doStreamArgsSeen[0]?.abortSignal?.aborted).toBe(false);

    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));

    await actionPromise;
    expect(doStreamArgsSeen[0]?.abortSignal?.aborted).toBe(true);
  });
});
