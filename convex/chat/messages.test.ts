/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { APICallError } from "@ai-sdk/provider";
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

/** A doStream that emits `deltas.length` text-delta chunks then hangs
 *  until abortSignal fires. Used to verify partial-delta persistence. */
function partialDeltasThenHangDoStream(
  deltas: string[],
): (options: {
  abortSignal?: AbortSignal;
}) => Promise<{ stream: ReadableStream<unknown> }> {
  return async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "0" });
        for (const d of deltas) {
          controller.enqueue({ type: "text-delta", id: "0", delta: d });
        }
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

/** A doStream that emits a complete `deltas → finish` stream
 *  synchronously, so paperChat.streamText resolves the happy path. */
function finishingDoStream(
  deltas: string[],
): () => Promise<{ stream: ReadableStream<unknown> }> {
  return async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "0" });
        for (const d of deltas) {
          controller.enqueue({ type: "text-delta", id: "0", delta: d });
        }
        controller.enqueue({ type: "text-end", id: "0" });
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        });
        controller.close();
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

  it("A2 — onAbort wiring logs '[chat] stream aborted by user'", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    mockDoStream.mockImplementation(hangingDoStream());

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const actionPromise = t.action(
        internal.chat.messages.generateResponse,
        { threadId, promptMessageId },
      );
      await waitFor(() => doStreamArgsSeen.length > 0);
      await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
      await actionPromise;

      const abortLog = infoSpy.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("[chat] stream aborted by user"),
      );
      expect(abortLog).toBeDefined();
      // The action's onAbort passes { jobId, threadId, stepCount } as
      // the structured payload — assert the shape is honest.
      const payload = abortLog?.[1] as
        | { jobId: string; threadId: string; stepCount: number }
        | undefined;
      expect(payload?.jobId).toBe(jobId);
      expect(payload?.threadId).toBe(threadId);
      expect(typeof payload?.stepCount).toBe("number");
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("A3 — stream row transitions to state:{kind:'aborted'} after abort", async () => {
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
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    const abortedRows: Array<{ status: string }> = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId: threadId as Id<"threads">,
        statuses: ["aborted"],
      }),
    );
    expect(abortedRows.length).toBeGreaterThanOrEqual(1);
    expect(abortedRows[0]?.status).toBe("aborted");
  });

  it("A4 — partial deltas written before abort survive the abort", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    mockDoStream.mockImplementation(
      partialDeltasThenHangDoStream(["hello ", "world", "!"]),
    );

    const actionPromise = t.action(
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId },
    );
    await waitFor(() => doStreamArgsSeen.length > 0);
    // Give DeltaStreamer's 250ms throttle (convex/chat/messages.ts:178)
    // time to flush at least one batch before abort fires.
    await new Promise((r) => setTimeout(r, 400));
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    const allStreams: Array<{ streamId: Id<"streamingMessages"> }> =
      await t.run(async (ctx) =>
        ctx.runQuery(components.agent.streams.list, {
          threadId: threadId as Id<"threads">,
          statuses: ["aborted"],
        }),
      );
    expect(allStreams.length).toBeGreaterThanOrEqual(1);
    const streamId = allStreams[0]!.streamId;

    const deltas: Array<{ streamId: string; parts: unknown[] }> =
      await t.run(async (ctx) =>
        ctx.runQuery(components.agent.streams.listDeltas, {
          threadId: threadId as Id<"threads">,
          cursors: [{ streamId, cursor: 0 }],
        }),
      );
    // At least one delta batch should have flushed pre-abort.
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    const totalParts = deltas.reduce(
      (acc, d) => acc + (d.parts?.length ?? 0),
      0,
    );
    expect(totalParts).toBeGreaterThanOrEqual(1);
  });

  it("A5 — releaseThreadLock clears isGenerating/shouldAbort/generatingStartedAt after abort", async () => {
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
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.isGenerating).toBe(false);
    expect(job?.shouldAbort).toBeUndefined();
    expect(job?.generatingStartedAt).toBeUndefined();
  });

  it("A6 — happy path: no abort, onAbort never fires, stream row finishes", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    mockDoStream.mockImplementation(finishingDoStream(["hi"]));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await t.action(internal.chat.messages.generateResponse, {
        threadId,
        promptMessageId,
      });

      const abortLog = infoSpy.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("[chat] stream aborted by user"),
      );
      expect(abortLog).toBeUndefined();
    } finally {
      infoSpy.mockRestore();
    }

    const finishedRows: Array<{ status: string }> = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId: threadId as Id<"threads">,
        statuses: ["finished"],
      }),
    );
    expect(finishedRows.length).toBeGreaterThanOrEqual(1);
    expect(finishedRows[0]?.status).toBe("finished");

    const abortedRows: Array<{ status: string }> = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId: threadId as Id<"threads">,
        statuses: ["aborted"],
      }),
    );
    expect(abortedRows.length).toBe(0);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.isGenerating).toBe(false);
  });

  it("A7 — rapid click-stop-click is safe (abortGeneration is idempotent)", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    const caller = asCaller(t, "c_msg");

    mockDoStream.mockImplementation(hangingDoStream());

    const actionPromise = t.action(
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId },
    );
    await waitFor(() => doStreamArgsSeen.length > 0);

    // Double-click stop — both should resolve without throwing. Second
    // call either flips shouldAbort (idempotent patch) or no-ops via
    // the !job.isGenerating guard depending on who races whom.
    await caller.mutation(api.chat.messages.abortGeneration, { threadId });
    await caller.mutation(api.chat.messages.abortGeneration, { threadId });

    await actionPromise;

    // Exactly one aborted stream row — no duplicate on the second click.
    const abortedRows: Array<{ status: string }> = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId: threadId as Id<"threads">,
        statuses: ["aborted"],
      }),
    );
    expect(abortedRows.length).toBe(1);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.isGenerating).toBe(false);
    expect(job?.shouldAbort).toBeUndefined();
  });

  it("A8 — maxRetries:0 — a retryable doStream failure is NOT retried", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    // Retryable 503 — AI SDK would normally retry twice on this. With
    // maxRetries:0 (set by generateResponse), the failure must bubble
    // out after exactly one attempt.
    mockDoStream.mockImplementation(async () => {
      throw new APICallError({
        message: "mock 503",
        url: "https://mock/provider",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    expect(mockDoStream).toHaveBeenCalledTimes(1);

    // Lock still released even on the error path.
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.isGenerating).toBe(false);
  });
});
