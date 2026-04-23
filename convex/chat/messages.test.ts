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
import { startAbortPoller } from "../../lib/chat/abort-poller";
import { STOP_ABORT_POLL_INTERVAL_MS } from "./messages";
import { setupTransactionAggregates } from "../credits/aggregates.test-support";

// Capture the composed abortSignal the library hands to doStream so
// tests can assert it transitioned to aborted after we flip
// job.shouldAbort. `providerState.emitGenerationId` lets tests simulate
// the OpenRouter X-Generation-Id fetch capture without an actual HTTP
// round trip — the mocked resolveOpenRouterModel invokes the sink as
// soon as doStream starts, which is exactly when createOpenRouter's
// fetch wrapper would fire in production.
const { mockDoStream, doStreamArgsSeen, providerState, fetchMock } =
  vi.hoisted(() => ({
    mockDoStream: vi.fn(),
    doStreamArgsSeen: [] as Array<{ abortSignal?: AbortSignal }>,
    providerState: {
      emitGenerationId: undefined as string | undefined,
      modelSlug: "mock/model" as string,
    },
    fetchMock: vi.fn(),
  }));

vi.stubGlobal("fetch", fetchMock);

// vi.mock replaces ./provider for every importer in this test file —
// including generateResponse's own import. The factory is async so it
// can pull in ai/test (which is not available at the hoisted phase).
vi.mock("./provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async (
      _ctx: unknown,
      _modelId: unknown,
      options?: { generationIdSink?: (id: string) => void },
    ) => ({
      model: new MockLanguageModelV3({
        doStream: async (doStreamOpts) => {
          doStreamArgsSeen.push({ abortSignal: doStreamOpts.abortSignal });
          // Simulate OpenRouter returning X-Generation-Id on the
          // initial HTTP response — the real fetch wrapper fires the
          // sink before any streamed body lands, i.e. before a client
          // abort can race the header read.
          if (providerState.emitGenerationId && options?.generationIdSink) {
            options.generationIdSink(providerState.emitGenerationId);
          }
          return mockDoStream(doStreamOpts);
        },
      }),
      modelSlug: providerState.modelSlug,
      pricing: { input: 0, output: 0 },
    }),
  };
});

vi.mock("../../lib/chat/abort-poller", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/chat/abort-poller")>();
  return {
    ...actual,
    startAbortPoller: vi.fn(actual.startAbortPoller),
  };
});

beforeEach(() => {
  mockDoStream.mockReset();
  doStreamArgsSeen.length = 0;
  fetchMock.mockReset();
  providerState.emitGenerationId = undefined;
  providerState.modelSlug = "mock/model";
  vi.mocked(startAbortPoller).mockClear();
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
  opts: {
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
    freeBalance?: number;
  } = {},
): Promise<{ modelId: Id<"models"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const modelId = await ctx.db.insert("models", {
      modelId: "mock/model",
      name: "Mock Model",
      provider: "openrouter",
      inputPricePerMillion: opts.inputPricePerMillion ?? 0,
      outputPricePerMillion: opts.outputPricePerMillion ?? 0,
      costMarkup: 1,
      isServed: true,
      sortOrder: 0,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: opts.freeBalance ?? 10_000,
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

async function listPersistedMessages(
  t: ReturnType<typeof convexTest>,
  threadId: string,
) {
  return await t.run(async (ctx) => {
    const { page } = await paperChat.listMessages(ctx, {
      threadId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    return page.map((message) => ({
      _id: message._id,
      order: message.order,
      stepOrder: message.stepOrder,
      status: message.status,
      error: message.error,
      role: message.message?.role,
      text:
        typeof message.message?.content === "string"
          ? message.message.content
          : undefined,
    }));
  });
}

async function listAllStreams(
  t: ReturnType<typeof convexTest>,
  threadId: string,
) {
  return await t.run(async (ctx) =>
    ctx.runQuery(components.agent.streams.list, {
      threadId: threadId as never,
      statuses: ["streaming", "finished", "aborted"],
    }),
  );
}

async function listDeltasForStreamIds(
  t: ReturnType<typeof convexTest>,
  threadId: string,
  streamIds: string[],
) {
  if (streamIds.length === 0) return [];
  return await t.run(async (ctx) =>
    ctx.runQuery(components.agent.streams.listDeltas, {
      threadId: threadId as never,
      cursors: streamIds.map((streamId) => ({
        streamId: streamId as never,
        cursor: 0,
      })),
    }),
  );
}

async function createStoppedAssistantTurn(
  t: ReturnType<typeof convexTest>,
  opts: { prompt?: string } = {},
) {
  const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
    isGenerating: true,
  });
  const { modelId } = await seedModelAndCredits(t, userId);
  await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
  const promptMessageId = await seedUserMessage(
    t,
    threadId,
    opts.prompt ?? "ping",
  );

  mockDoStream.mockImplementation(
    partialDeltasThenHangDoStream(["partial ", "reply"]),
  );

  const actionPromise = t.action(internal.chat.messages.generateResponse, {
    threadId,
    promptMessageId,
  });
  await waitFor(() => doStreamArgsSeen.length > 0);
  await new Promise((r) => setTimeout(r, 400));
  await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
  await actionPromise;

  const messages = await listPersistedMessages(t, threadId);
  const streams = await listAllStreams(t, threadId);
  const stoppedAssistant = messages.find((message) => message.role === "assistant");
  const stoppedStream = streams.find((stream) => stream.status === "aborted");
  expect(stoppedAssistant).toBeDefined();
  expect(stoppedStream).toBeDefined();

  return {
    userId,
    jobId,
    threadId,
    modelId,
    promptMessageId,
    stoppedOrder: stoppedAssistant!.order,
    stoppedAssistantIds: messages
      .filter((message) => message.role === "assistant" && message.order === stoppedAssistant!.order)
      .map((message) => message._id),
    stoppedStreamIds: streams
      .filter((stream) => stream.order === stoppedAssistant!.order)
      .map((stream) => stream.streamId),
  };
}

function createTestConvex() {
  const t = convexTest(schema);
  registerAgentComponent(t);
  // Required by convex/credits/internal.ts so deductCredits can write
  // its aggregate counters. Chat billing calls deductCreditsTransaction
  // after reconciliation, so every chat test that exercises billing
  // needs these aggregates registered.
  setupTransactionAggregates(t);
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
  it("A0 — generateResponse uses the explicit stop poll cadence", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    mockDoStream.mockImplementation(finishingDoStream(["hi"]));

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    expect(startAbortPoller).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: STOP_ABORT_POLL_INTERVAL_MS,
      }),
    );
  });

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
        threadId: threadId as never,
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

    const allStreams: Array<{ streamId: string }> = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId: threadId as never,
        statuses: ["aborted"],
      }),
    );
    expect(allStreams.length).toBeGreaterThanOrEqual(1);
    const streamId = allStreams[0]!.streamId;

    const deltas: Array<{ streamId: string; parts: unknown[] }> =
      await t.run(async (ctx) =>
        ctx.runQuery(components.agent.streams.listDeltas, {
          threadId: threadId as never,
          cursors: [{ streamId: streamId as never, cursor: 0 }],
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
        threadId: threadId as never,
        statuses: ["finished"],
      }),
    );
    expect(finishedRows.length).toBeGreaterThanOrEqual(1);
    expect(finishedRows[0]?.status).toBe("finished");

    const abortedRows: Array<{ status: string }> = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId: threadId as never,
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
        threadId: threadId as never,
        statuses: ["aborted"],
      }),
    );
    expect(abortedRows.length).toBe(1);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.isGenerating).toBe(false);
    expect(job?.shouldAbort).toBeUndefined();
  });

  it("C1a — no billing when OpenRouter never returned a generation id (defence-in-depth)", async () => {
    // If the fetch wrapper never captured an X-Generation-Id (e.g. the
    // upstream POST failed before headers arrived, or the provider
    // changed its contract), generateResponse must NOT bill. The chat
    // ledger is keyed by generation id; billing without one would leave
    // a row that cannot be reconciled or refunded.
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId, {
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      freeBalance: 10_000,
    });
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");

    // providerState.emitGenerationId is undefined by default — simulating
    // a run where OpenRouter did not return X-Generation-Id.
    mockDoStream.mockImplementation(
      partialDeltasThenHangDoStream(["hello ", "world"]),
    );

    const actionPromise = t.action(
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId },
    );
    await waitFor(() => doStreamArgsSeen.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBe(0);
    expect(balance?.total).toBe(10_000);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("chatGenerationUsages").collect();
      expect(rows).toHaveLength(0);
    });
  });

  it("C1b — happy-path finish captures a chatGenerationUsages row keyed by the fetch-header generation id", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId, {
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      freeBalance: 10_000,
    });
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    const generationId = "gen_happy_1";
    providerState.emitGenerationId = generationId;

    mockDoStream.mockImplementation(finishingDoStream(["hi"]));
    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    await t.run(async (ctx) => {
      const ledger = await ctx.db
        .query("chatGenerationUsages")
        .withIndex("by_generation_id", (q) =>
          q.eq("generationId", generationId),
        )
        .unique();
      expect(ledger?.status).toBe("captured");
      expect(ledger?.jobId).toBe(jobId);
      expect(ledger?.userId).toBe(userId);
      expect(ledger?.requestedModel).toBe("mock/model");
      expect(ledger?.billedAt ?? null).toBeNull();
    });
  });

  it("C1c — user-stop STILL captures a chatGenerationUsages row for later reconciliation", async () => {
    // The critical regression test for plan-01's Deviation note. In
    // AI SDK v5, streamText.onFinish does not fire on abort and
    // providerMetadata.openrouter.responseId is body-derived (undefined
    // on abort). The fetch wrapper captures X-Generation-Id from the
    // initial HTTP response headers — which arrive before any
    // AbortSignal can race the read — so user-stopped turns MUST still
    // produce a chatGenerationUsages row. That row is what reconcile
    // then bills against OpenRouter's authoritative /api/v1/generation
    // payload (the cancelled=true branch is covered end-to-end in
    // billing.integration.test.ts).
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId, {
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      freeBalance: 10_000,
    });
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    const generationId = "gen_stopped_1";
    providerState.emitGenerationId = generationId;

    mockDoStream.mockImplementation(
      partialDeltasThenHangDoStream(["hello ", "world"]),
    );

    const actionPromise = t.action(
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId },
    );
    await waitFor(() => doStreamArgsSeen.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    // The capture ran despite the abort — this is the regression guard.
    await t.run(async (ctx) => {
      const ledger = await ctx.db
        .query("chatGenerationUsages")
        .withIndex("by_generation_id", (q) =>
          q.eq("generationId", generationId),
        )
        .unique();
      expect(ledger).not.toBeNull();
      expect(ledger?.status).toBe("captured");
      expect(ledger?.jobId).toBe(jobId);
      expect(ledger?.userId).toBe(userId);
      expect(ledger?.billedAt ?? null).toBeNull();
    });

    // Now run reconcile directly against a mocked cancelled-generation
    // OpenRouter payload. This is the same settleGenerationUsage code
    // path that fires from the scheduler in production — exercised
    // here synchronously so the assertion on the credit transaction is
    // deterministic regardless of stream-internal scheduled cleanups.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: generationId,
            model: "mock/model",
            provider_name: "mock",
            cancelled: true,
            finish_reason: "stop",
            native_finish_reason: "USER_ABORT",
            native_tokens_prompt: 8,
            native_tokens_completion: 2,
            total_cost: 0.04,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await t.action(internal.chat.billing.reconcileGenerationUsage, {
      generationId,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(generationId),
      expect.any(Object),
    );

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBeGreaterThan(0);
    expect(balance?.total).toBeLessThan(10_000);

    await t.run(async (ctx) => {
      const ledger = await ctx.db
        .query("chatGenerationUsages")
        .withIndex("by_generation_id", (q) =>
          q.eq("generationId", generationId),
        )
        .unique();
      expect(ledger?.status).toBe("billed");
      expect(ledger?.cancelled).toBe(true);
      expect(ledger?.billedCredits ?? 0).toBeGreaterThan(0);

      const txs = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(txs).toHaveLength(1);
      expect(txs[0]?.metadata?.generationId).toBe(generationId);
      expect(txs[0]?.metadata?.cancelled).toBe("true");
      expect(txs[0]?.metadata?.billingSource).toBe(
        "openrouter_generation_api",
      );
    });
  });

  it("M1 — listThreadMessages enriches aborted messages with aborted:true and drops the sentinel error", async () => {
    const t = createTestConvex();
    const { threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");

    // Seed three assistant messages into the same thread:
    //   - regular (success, no error)
    //   - aborted (failed + the exact sentinel the library writes on abort)
    //   - real error (failed + serialized envelope)
    await t.run(async (ctx) => {
      await paperChat.saveMessage(ctx, {
        threadId,
        message: { role: "assistant", content: "All done." },
        metadata: { status: "success" },
        skipEmbeddings: true,
      });
      await paperChat.saveMessage(ctx, {
        threadId,
        message: { role: "assistant", content: "Partial text before stop" },
        metadata: {
          status: "failed",
          // Mirror what the agent library actually writes: it stringifies
          // DOMException via Error#message, so the sentinel landing in the
          // doc is the bare reason — see lib/chat/abort-signal.ts.
          error: "user_stopped",
        },
        skipEmbeddings: true,
      });
      await paperChat.saveMessage(ctx, {
        threadId,
        message: { role: "assistant", content: "" },
        metadata: {
          status: "failed",
          error: '{"kind":"rate_limit","message":"busy"}',
        },
        skipEmbeddings: true,
      });
    });

    const result = await caller.query(api.chat.messages.listThreadMessages, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: undefined,
    });

    // All three persisted rows show up.
    expect(result.page.length).toBeGreaterThanOrEqual(3);

    const byText = Object.fromEntries(
      result.page.map((m: { text?: string; aborted?: boolean; error?: string }) => [
        m.text ?? "",
        m,
      ]),
    ) as Record<string, { aborted?: boolean; error?: string }>;

    const regular = byText["All done."];
    expect(regular).toBeDefined();
    expect(regular.aborted).toBeUndefined();
    expect(regular.error).toBeUndefined();

    const aborted = byText["Partial text before stop"];
    expect(aborted).toBeDefined();
    expect(aborted.aborted).toBe(true);
    // Critical: the raw sentinel string never reaches the client.
    expect(aborted.error).toBeUndefined();

    const realError = byText[""];
    expect(realError).toBeDefined();
    expect(realError.error).toBe('{"kind":"rate_limit","message":"busy"}');
    expect(realError.aborted).toBeUndefined();
  });

  it("M2 — listThreadMessages returns active stream sync alongside the persisted page", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    const caller = asCaller(t, "c_msg");

    mockDoStream.mockImplementation(
      partialDeltasThenHangDoStream(["hello ", "world"]),
    );

    const actionPromise = t.action(
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId },
    );
    await waitFor(() => doStreamArgsSeen.length > 0);
    await new Promise((r) => setTimeout(r, 400));

    const result = await caller.query(api.chat.messages.listThreadMessages, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list", startOrder: 0 },
    });

    expect(
      result.page.some(
        (m: { role?: string; text?: string }) =>
          m.role === "user" && m.text === "ping",
      ),
    ).toBe(true);
    expect(result.streams).toMatchObject({
      kind: "list",
      messages: expect.arrayContaining([
        expect.objectContaining({ status: "streaming" }),
      ]),
    });

    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;
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

  it("A9 — regenerate after stop purges same-order artifacts before rerun", async () => {
    const t = createTestConvex();
    const stopped = await createStoppedAssistantTurn(t);
    const caller = asCaller(t, "c_msg");

    await caller.mutation(api.chat.messages.regenerateLastAssistant, {
      threadId: stopped.threadId,
    });

    const messagesAfterPurge = await listPersistedMessages(t, stopped.threadId);
    const streamsAfterPurge = await listAllStreams(t, stopped.threadId);
    const deltasAfterPurge = await listDeltasForStreamIds(
      t,
      stopped.threadId,
      stopped.stoppedStreamIds,
    );
    const jobAfterPurge = await t.run(async (ctx) => ctx.db.get(stopped.jobId));

    expect(
      messagesAfterPurge.some((message) =>
        stopped.stoppedAssistantIds.includes(message._id),
      ),
    ).toBe(false);
    expect(
      streamsAfterPurge.some((stream) =>
        stopped.stoppedStreamIds.includes(stream.streamId),
      ),
    ).toBe(false);
    expect(deltasAfterPurge).toHaveLength(0);
    expect(jobAfterPurge?.isGenerating).toBe(true);

    mockDoStream.mockImplementation(finishingDoStream(["regenerated reply"]));

    await t.action(internal.chat.messages.generateResponse, {
      threadId: stopped.threadId,
      promptMessageId: stopped.promptMessageId,
    });

    const finalMessages = await listPersistedMessages(t, stopped.threadId);
    const finalStreams = await listAllStreams(t, stopped.threadId);
    const assistantMessagesAtOrder = finalMessages.filter(
      (message) =>
        message.role === "assistant" && message.order === stopped.stoppedOrder,
    );
    const streamRowsAtOrder = finalStreams.filter(
      (stream) => stream.order === stopped.stoppedOrder,
    );

    expect(assistantMessagesAtOrder.length).toBeGreaterThanOrEqual(1);
    expect(streamRowsAtOrder).toHaveLength(1);
    expect(streamRowsAtOrder[0]?.status).toBe("finished");
  });

  it("A10 — clear after stop removes messages and stream artifacts but keeps the thread", async () => {
    const t = createTestConvex();
    const stopped = await createStoppedAssistantTurn(t, {
      prompt: "clear me",
    });
    await seedChatPapers(t, stopped.jobId, [true, false, true]);
    const caller = asCaller(t, "c_msg");

    await caller.mutation(api.chat.messages.clearThread, {
      threadId: stopped.threadId,
    });

    const messagesAfterClear = await listPersistedMessages(t, stopped.threadId);
    const streamsAfterClear = await listAllStreams(t, stopped.threadId);
    const deltasAfterClear = await listDeltasForStreamIds(
      t,
      stopped.threadId,
      stopped.stoppedStreamIds,
    );
    const preserved = await t.run(async (ctx) => {
      const thread = await ctx.runQuery(components.agent.threads.getThread, {
        threadId: stopped.threadId,
      });
      const job = await ctx.db.get(stopped.jobId);
      const chatPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", stopped.jobId))
        .collect();
      return {
        thread,
        job,
        chatPapers: chatPapers.map((row) => row.included),
      };
    });

    expect(messagesAfterClear).toHaveLength(0);
    expect(streamsAfterClear).toHaveLength(0);
    expect(deltasAfterClear).toHaveLength(0);
    expect(preserved.thread).not.toBeNull();
    expect(preserved.job?.chatModelId).toBe(stopped.modelId);
    expect(preserved.job?.messageCount).toBe(0);
    expect(preserved.job?.lastMessageAt).toBeUndefined();
    expect(preserved.chatPapers).toEqual([true, false, true]);
  });
});
