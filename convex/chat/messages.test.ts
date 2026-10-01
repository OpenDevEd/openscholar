/// <reference types="vite/client" />
import { CHAT_PROMPT_MAX_CHARS } from "@/lib/extraction/limits";
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
import { fakeAutumn, fakeAutumnFetch, seedCreditsForTest } from "../billing/billing.test-support";
import { convertUsdToCredits, creditsForUsage } from "../../lib/pricing";
import { parseChatError } from "../../lib/errors/taxonomy";

// Capture the composed abortSignal the library hands to doStream so
// tests can assert it transitioned to aborted after we flip
// job.shouldAbort. `providerState.emitGenerationId` lets tests simulate
// the OpenRouter X-Generation-Id fetch capture without an actual HTTP
// round trip — the mocked resolveOpenRouterModel invokes the sink as
// soon as doStream starts, which is exactly when createOpenRouter's
// fetch wrapper would fire in production.
const { mockDoStream, doStreamArgsSeen, providerState, fetchMock } = vi.hoisted(
  () => ({
    mockDoStream: vi.fn(),
    doStreamArgsSeen: [] as Array<{
      abortSignal?: AbortSignal;
      prompt?: unknown;
    }>,
      providerState: {
        emitGenerationId: undefined as string | undefined,
        modelSlug: "mock/model" as string,
        modelIdsSeen: [] as unknown[],
        pricing: { input: 0, output: 0 },
      },
    fetchMock: vi.fn(),
  }),
);

vi.stubGlobal("fetch", fetchMock);

// vi.mock replaces ./provider for every importer in this test file —
// including generateResponse's own import. The factory is async so it
// can pull in ai/test (which is not available at the hoisted phase).
vi.mock("./provider", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  return {
    resolveOpenRouterModel: async (
      _ctx: unknown,
      modelId: unknown,
      options?: { generationIdSink?: (id: string) => void },
    ) => {
      providerState.modelIdsSeen.push(modelId);
      return {
        model: new MockLanguageModelV3({
          doStream: async (doStreamOpts) => {
            doStreamArgsSeen.push({
              abortSignal: doStreamOpts.abortSignal,
              prompt: doStreamOpts.prompt,
            });
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
        pricing: providerState.pricing,
      };
    },
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
  fakeAutumn.reset();
  fetchMock.mockImplementation(fakeAutumnFetch());
  providerState.emitGenerationId = undefined;
  providerState.modelSlug = "mock/model";
  providerState.modelIdsSeen = [];
  providerState.pricing = { input: 0, output: 0 };
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

/** A doStream that paces text-delta chunks with `delayMs` between
 *  them, then hangs until abortSignal fires. Required for tests that
 *  need DeltaStreamer's throttled flush to actually persist multiple
 *  delta batches to the streamDeltas table — `partialDeltasThenHang
 *  DoStream` enqueues all chunks synchronously, so DeltaStreamer
 *  flushes the first batch and then has no further `addParts` calls
 *  to retrigger the throttle window, leaving subsequent text-deltas
 *  buffered in memory and never written. */
function pacedDeltasThenHangDoStream(
  deltas: string[],
  delayMs: number,
): (options: {
  abortSignal?: AbortSignal;
}) => Promise<{ stream: ReadableStream<unknown> }> {
  return async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "0" });
        let i = 0;
        const interval = setInterval(() => {
          if (i >= deltas.length) {
            clearInterval(interval);
            return;
          }
          try {
            controller.enqueue({
              type: "text-delta",
              id: "0",
              delta: deltas[i]!,
            });
          } catch {
            clearInterval(interval);
          }
          i++;
        }, delayMs);
        options.abortSignal?.addEventListener("abort", () => {
          clearInterval(interval);
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
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 3, text: 3, reasoning: 0 },
          },
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
    await seedCreditsForTest(ctx, {
      userId,
      free: opts.freeBalance ?? 10_000,
      now,
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
      model: message.model,
      provider: message.provider,
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
  const stoppedAssistant = messages.find(
    (message) => message.role === "assistant",
  );
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
      .filter(
        (message) =>
          message.role === "assistant" &&
          message.order === stoppedAssistant!.order,
      )
      .map((message) => message._id),
    stoppedStreamIds: streams
      .filter((stream) => stream.order === stoppedAssistant!.order)
      .map((stream) => stream.streamId),
  };
}

function createTestConvex() {
  const t = convexTest(schema);
  registerAgentComponent(t);
  // Settled chat charges add to the job's credit total.
  return t;
}

async function seedUserAndChatJob(
  t: ReturnType<typeof convexTest>,
  opts: {
    isGenerating?: boolean;
    threadId?: string;
    generationAttemptId?: string;
  } = {},
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
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
        ? {
            isGenerating: opts.isGenerating,
            generatingStartedAt: Date.now(),
            ...(opts.generationAttemptId
              ? { chatGenerationAttemptId: opts.generationAttemptId }
              : {}),
          }
        : {}),
    });
    return { userId, jobId, threadId };
  });
}

function asCaller(t: ReturnType<typeof convexTest>, clerkId: string) {
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

async function seedInFlightChatJobs(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  count: number,
) {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat",
        sourceType: "history",
        name: `in-flight ${i}`,
        messageCount: 0,
        createdAt: 0,
        updatedAt: 0,
        isGenerating: true,
        generatingStartedAt: Date.now(),
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
      ctx.db.insert("users", {libraryItemCount: 0, 
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
      generationAttemptId: "attempt_current",
    });
    const caller = asCaller(t, "c_msg");
    const result = await caller.mutation(api.chat.messages.abortGeneration, {
      threadId,
      generationAttemptId: "attempt_current",
    });
    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(result).toEqual({ stopped: true });
    expect(after?.shouldAbort).toBe(true);
  });

  it("abortGeneration ignores a stale attempt id from an older stop click", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
      generationAttemptId: "attempt_current",
    });
    const caller = asCaller(t, "c_msg");
    const result = await caller.mutation(api.chat.messages.abortGeneration, {
      threadId,
      generationAttemptId: "attempt_old",
    });

    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(result).toEqual({ stopped: false });
    expect(after?.shouldAbort).toBeUndefined();
  });

  it("abortGeneration no-ops when nothing is in flight", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");
    const result = await caller.mutation(api.chat.messages.abortGeneration, {
      threadId,
      generationAttemptId: "attempt_current",
    });
    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(result).toEqual({ stopped: false });
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
    const envelope = (err as ConvexError<{ code: string; message?: string }>).data;
    expect(envelope.code).toBe("NO_SOURCES_INCLUDED");

    // Guard short-circuits before any saveMessage / job.patch runs.
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.messageCount).toBe(0);
    expect(job?.isGenerating).toBeUndefined();
    expect(job?.lastMessageAt).toBeUndefined();
  });

  it("sendMessage refuses a prompt over the length limit", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    await seedChatPapers(t, jobId, [true]);

    const err = await asCaller(t, "c_msg")
      .mutation(api.chat.messages.sendMessage, { threadId, prompt: "x".repeat(CHAT_PROMPT_MAX_CHARS + 1) })
      .catch((e: unknown) => e);
    expect((err as ConvexError<{ code: string }>).data.code).toBe("VALIDATION_ERROR");
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.messageCount).toBe(0);
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

  it("sendMessage rejects when the user is already at the chat concurrency cap", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t);
    await seedChatPapers(t, jobId, [true]);
    await seedInFlightChatJobs(t, userId, 3);

    const caller = asCaller(t, "c_msg");
    await expect(
      caller.mutation(api.chat.messages.sendMessage, {
        threadId,
        prompt: "hi",
      }),
    ).rejects.toThrow(/concurrent chats/i);
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

describe("chat.messages.setChatWebSearchEnabled", () => {
  it("flips the flag and reports outcome=updated on the happy path", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");

    const result = await caller.mutation(
      api.chat.messages.setChatWebSearchEnabled,
      { threadId, enabled: true },
    );

    expect(result).toEqual({ outcome: "updated" });
    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(after?.webSearchEnabled).toBe(true);
  });

  it("rejects callers who don't own the thread", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    await t.run(async (ctx) =>
      ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "c_other",
        email: "o@t",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const other = asCaller(t, "c_other");

    await expect(
      other.mutation(api.chat.messages.setChatWebSearchEnabled, {
        threadId,
        enabled: true,
      }),
    ).rejects.toThrow(/access denied|forbidden/i);

    const after = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(after?.webSearchEnabled).toBeUndefined();
  });

  it("returns outcome=noop and skips the patch when value is unchanged", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");

    // Unset (undefined) should compare equal to false → noop on first call.
    const initialNoop = await caller.mutation(
      api.chat.messages.setChatWebSearchEnabled,
      { threadId, enabled: false },
    );
    expect(initialNoop).toEqual({ outcome: "noop" });
    const afterInitial = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(afterInitial?.webSearchEnabled).toBeUndefined();
    expect(afterInitial?.updatedAt).toBe(0);

    // Real flip lands a patch with a fresh updatedAt.
    const flipped = await caller.mutation(
      api.chat.messages.setChatWebSearchEnabled,
      { threadId, enabled: true },
    );
    expect(flipped).toEqual({ outcome: "updated" });
    const afterFlip = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(afterFlip?.webSearchEnabled).toBe(true);
    expect(afterFlip?.updatedAt).toBeGreaterThan(0);

    // Re-toggle to the same value: noop, updatedAt unchanged proves the
    // patch was skipped (the patch path always writes Date.now()).
    const repeat = await caller.mutation(
      api.chat.messages.setChatWebSearchEnabled,
      { threadId, enabled: true },
    );
    expect(repeat).toEqual({ outcome: "noop" });
    const afterRepeat = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(afterRepeat?.updatedAt).toBe(afterFlip?.updatedAt);

    // Disable transitions back to false through the patch path.
    const disabled = await caller.mutation(
      api.chat.messages.setChatWebSearchEnabled,
      { threadId, enabled: false },
    );
    expect(disabled).toEqual({ outcome: "updated" });
    const afterDisable = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(afterDisable?.webSearchEnabled).toBe(false);
  });

  it("rejects unknown threadIds", async () => {
    const t = createTestConvex();
    // Seed only the user; do NOT create a chat job for them, so any
    // threadId we pass cannot resolve to one of their rows.
    await t.run(async (ctx) =>
      ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "c_msg",
        email: "m@t",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const caller = asCaller(t, "c_msg");

    await expect(
      caller.mutation(api.chat.messages.setChatWebSearchEnabled, {
        threadId: "thread_does_not_exist",
        enabled: true,
      }),
    ).rejects.toThrow(/access denied|forbidden/i);
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

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

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
      const actionPromise = t.action(internal.chat.messages.generateResponse, {
        threadId,
        promptMessageId,
      });
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

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
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

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
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

    const deltas: Array<{ streamId: string; parts: unknown[] }> = await t.run(
      async (ctx) =>
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

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
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
      generationAttemptId: "attempt_current",
    });
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    const caller = asCaller(t, "c_msg");

    mockDoStream.mockImplementation(hangingDoStream());

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
    await waitFor(() => doStreamArgsSeen.length > 0);

    // Double-click stop — both should resolve without throwing. Second
    // call either flips shouldAbort (idempotent patch) or no-ops via
    // the !job.isGenerating guard depending on who races whom.
    await caller.mutation(api.chat.messages.abortGeneration, {
      threadId,
      generationAttemptId: "attempt_current",
    });
    await caller.mutation(api.chat.messages.abortGeneration, {
      threadId,
      generationAttemptId: "attempt_current",
    });

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

  async function chargedUsage(t: ReturnType<typeof createTestConvex>, jobId: Id<"extractionJobs">) {
    return await t.run(async (ctx) =>
      ctx.db
        .query("billingUsage")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
  }

  it("C1a — a stop before OpenRouter starts a generation charges nothing and frees the reservation", async () => {
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

    mockDoStream.mockImplementation(partialDeltasThenHangDoStream([]));

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
    await waitFor(() => doStreamArgsSeen.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    expect(fakeAutumn.balance(userId)).toBe(10_000);
    expect(fakeAutumn.locks.size).toBe(0);
    expect(await chargedUsage(t, jobId)).toHaveLength(0);
  });

  it("C1b — a finished turn charges its cost once and records it against the chat", async () => {
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
    providerState.emitGenerationId = "gen_happy_1";
    providerState.pricing = { input: 1_000, output: 2_000 };

    mockDoStream.mockImplementation(finishingDoStream(["hi"]));
    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    // 5 input and 3 output tokens at $1,000/$2,000 per million.
    const expected = creditsForUsage({ inputTokens: 5, outputTokens: 3 }, { input: 1_000, output: 2_000 });
    const usage = await chargedUsage(t, jobId);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.kind).toBe("chat");
    expect(usage[0]?.userId).toBe(userId);
    expect(usage[0]?.credits).toBe(expected);
    expect(fakeAutumn.balance(userId)).toBe(10_000 - (usage[0]?.credits ?? 0));
    expect(fakeAutumn.locks.size).toBe(0);
  });

  it("C1c — a stop charges what OpenRouter's generation record says it cost", async () => {
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
    providerState.emitGenerationId = "gen_stopped_1";

    mockDoStream.mockImplementation(
      partialDeltasThenHangDoStream(["hello ", "world"]),
    );

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
    await waitFor(() => doStreamArgsSeen.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    const lookup = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).find((sf) =>
        sf.name.includes("settleFromOpenRouter"),
      ),
    );
    expect(lookup?.args[0]).toMatchObject({ generationId: "gen_stopped_1" });

    // OpenRouter bills the whole response when the provider can't cancel.
    fetchMock.mockImplementation(
      fakeAutumnFetch(async () =>
        new Response(
          JSON.stringify({
            data: { id: "gen_stopped_1", model: "mock/model", total_cost: 0.002 },
          }),
          { status: 200 },
        ),
      ),
    );
    await t.action(internal.chat.billing.settleFromOpenRouter, lookup!.args[0]);

    const usage = await chargedUsage(t, jobId);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.credits).toBe(convertUsdToCredits({ usd: 0.002 }));
    expect(fakeAutumn.balance(userId)).toBe(10_000 - convertUsdToCredits({ usd: 0.002 }));
    expect(fakeAutumn.locks.size).toBe(0);
  });

  it("C1e — user-stop persists ABORT_ERROR_STRING on the pending assistant so listThreadMessages enriches aborted:true", async () => {
    // The agent library registers a fire-and-forget abort-signal
    // listener in start.ts:170-178 that's supposed to finalize the
    // pending assistant message as failed with the abort sentinel.
    // But that listener's `await fail()` is a dangling promise from
    // the action's perspective — Convex warns about it and may not
    // run it reliably. Observed in pm2 logs: "[chat] stream aborted
    // by user … 2 unawaited operations: [mutation, query]" followed
    // by the pending assistant staying status="pending" with empty
    // content five minutes later.
    //
    // Result without our defensive patch: the UI sees
    //   { status: "pending", text: "" }
    // instead of an aborted bubble — the chat renders "error" via
    // the stale-pending fallback.
    //
    // Fix: at the end of onAbort, after billing, we explicitly run
    // ctx.runMutation(components.agent.messages.updateMessage, {
    //   messageId, patch: { status: "failed", error: ABORT_ERROR_STRING }
    // }) ourselves. listThreadMessages then sees isAbortErrorString
    // on the message error and surfaces aborted:true.
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId } = await seedModelAndCredits(t, await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      return job!.userId;
    }), {
      inputPricePerMillion: 1_000,
      outputPricePerMillion: 2_000,
      freeBalance: 10_000,
    });
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    providerState.emitGenerationId = "gen_aborted_finalize_1";

    // Pace the deltas with 300ms between them so DeltaStreamer's
    // 250ms throttle has time to flush each batch separately. With
    // synchronous enqueue (partialDeltasThenHangDoStream) the throttle
    // window only fires once and subsequent text-delta chunks stay
    // buffered in memory unwritten — that's a test-environment
    // artifact, but it would also fail to exercise the consolidation
    // path we're trying to verify.
    mockDoStream.mockImplementation(
      pacedDeltasThenHangDoStream(["partial ", "reply"], 300),
    );

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
    await waitFor(() => doStreamArgsSeen.length > 0);
    await new Promise((r) => setTimeout(r, 900));
    await t.run(async (ctx) => ctx.db.patch(jobId, { shouldAbort: true }));
    await actionPromise;

    // Persisted state: assistant row patched to failed with the wire
    // sentinel. listThreadMessages strips the sentinel and surfaces
    // aborted:true (already covered by M1 against seeded data — this
    // test pins the same enrichment against the live abort path).
    const caller = asCaller(t, "c_msg");
    const result = await caller.query(api.chat.messages.listThreadMessages, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: undefined,
    });
    const assistant = result.page.find(
      (m: { role?: string }) => m.role === "assistant",
    ) as
      | {
          status?: string;
          aborted?: boolean;
          error?: string;
          text?: string;
        }
      | undefined;
    expect(assistant).toBeDefined();
    expect(assistant!.status).toBe("failed");
    expect(assistant!.aborted).toBe(true);
    expect(assistant!.error).toBeUndefined();
    // Partial streamed text MUST survive — the user saw text before
    // clicking stop and the stopped bubble has to show whatever
    // content the agent had time to flush, not an empty failed
    // message. This is the production regression from using
    // updateMessage (locks empty content because finalizeMessage
    // early-returns once status !== pending) instead of finalize
    // Message (consolidates stream deltas via getStreamingMessages
    // WithMetadata → addMessagesHandler before marking failed).
    //
    // Substring match — exact text fragmentation is timing-dependent
    // (DeltaStreamer's 250ms throttle vs the 300ms inter-delta pace
    // in the mock means the second flush may not complete before
    // abort fires), so we just assert the first delta survived.
    expect(assistant!.text).toContain("partial");
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
          // Mirror what the installed agent library writes: it stringifies
          // DOMException via toString(), so the persisted value includes the
          // error name — see lib/chat/abort-signal.ts.
          error: "AbortError: user_stopped",
        },
        skipEmbeddings: true,
      });
      await paperChat.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: "Partial text before update conflict",
        },
        metadata: {
          status: "failed",
          error:
            "Trying to update a message that failed: ks7fm4y0axy6ad5g8pfdmtq00x85f2m5, error: AbortError: user_stopped",
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
      result.page.map(
        (m: { text?: string; aborted?: boolean; error?: string }) => [
          m.text ?? "",
          m,
        ],
      ),
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

    const abortUpdateConflict = byText["Partial text before update conflict"];
    expect(abortUpdateConflict).toBeDefined();
    expect(abortUpdateConflict.aborted).toBe(true);
    expect(abortUpdateConflict.error).toBeUndefined();

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

    const actionPromise = t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });
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

    const result = await caller.mutation(
      api.chat.messages.regenerateLastAssistant,
      {
        threadId: stopped.threadId,
      },
    );

    const messagesAfterPurge = await listPersistedMessages(t, stopped.threadId);
    const streamsAfterPurge = await listAllStreams(t, stopped.threadId);
    const deltasAfterPurge = await listDeltasForStreamIds(
      t,
      stopped.threadId,
      stopped.stoppedStreamIds,
    );
    const jobAfterPurge = await t.run(async (ctx) => ctx.db.get(stopped.jobId));

    expect(result.started).toBe(true);
    expect(typeof result.generationAttemptId).toBe("string");
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

  it("A9.1 — scheduled generation uses the model snapshot passed by the mutation", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const { modelId: firstModelId } = await seedModelAndCredits(t, userId);
    const secondModelId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("models", {
        modelId: "mock/other-model",
        name: "Other Model",
        provider: "openrouter",
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        costMarkup: 1,
        isServed: true,
        sortOrder: 1,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    await t.run(async (ctx) =>
      ctx.db.patch(jobId, { chatModelId: secondModelId }),
    );
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    mockDoStream.mockImplementation(finishingDoStream(["reply"]));

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
      chatModelId: firstModelId,
    });

    expect(providerState.modelIdsSeen[0]).toBe(firstModelId);
  });

  it("A9a — regenerate reports the backend reason when no assistant turn can be resolved", async () => {
    const t = createTestConvex();
    const { threadId } = await seedUserAndChatJob(t);
    const caller = asCaller(t, "c_msg");

    const result = await caller.mutation(
      api.chat.messages.regenerateLastAssistant,
      {
        threadId,
      },
    );

    expect(result.started).toBe(false);
    expect(result.error).toMatchObject({
      code: "regenerate_failed",
      message:
        "Regenerate did not start because this thread has no persisted chat messages or stream artifacts.",
    });
  });

  it("A9a.0 — regenerate explains a latest user-only turn instead of inventing a provider error", async () => {
    const t = createTestConvex();
    const { threadId } = await seedUserAndChatJob(t);
    await seedUserMessage(t, threadId, "orphaned prompt");
    const caller = asCaller(t, "c_msg");

    const result = await caller.mutation(
      api.chat.messages.regenerateLastAssistant,
      {
        threadId,
      },
    );

    expect(result.started).toBe(false);
    expect(result.error?.code).toBe("regenerate_failed");
    expect(result.error?.message).toContain(
      "latest persisted turn at order 0 has no assistant message or stream artifact",
    );
    expect(result.error?.message).toContain("messages=[user:success]");
    expect(result.error?.message).toContain("streams=0");
  });

  it("A9a.1 — regenerate preserves the recorded provider error when no assistant artifact remains", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, {
        error: {
          code: "context_too_long",
          message:
            "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
          httpStatus: 400,
          at: 123,
        },
      });
    });
    const caller = asCaller(t, "c_msg");

    const result = await caller.mutation(
      api.chat.messages.regenerateLastAssistant,
      {
        threadId,
      },
    );

    expect(result).toEqual({
      started: false,
      error: {
        code: "context_too_long",
        message:
          "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
        httpStatus: 400,
        at: 123,
      },
    });
  });

  it("A9a.2 — regenerate clears the previous backend error before the replacement stream runs", async () => {
    const t = createTestConvex();
    const stopped = await createStoppedAssistantTurn(t);
    const caller = asCaller(t, "c_msg");
    await t.run(async (ctx) => {
      await ctx.db.patch(stopped.jobId, {
        error: {
          code: "context_too_long",
          message:
            "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
          httpStatus: 400,
          at: 123,
        },
      });
    });

    await caller.mutation(api.chat.messages.regenerateLastAssistant, {
      threadId: stopped.threadId,
    });

    const jobAfterStart = await t.run((ctx) => ctx.db.get(stopped.jobId));
    expect(jobAfterStart?.error).toBeUndefined();

    mockDoStream.mockImplementation(finishingDoStream(["regenerated reply"]));

    await t.action(internal.chat.messages.generateResponse, {
      threadId: stopped.threadId,
      promptMessageId: stopped.promptMessageId,
      generationAttemptId: jobAfterStart?.chatGenerationAttemptId,
    });

    const jobAfterSuccess = await t.run((ctx) => ctx.db.get(stopped.jobId));
    expect(jobAfterSuccess?.error).toBeUndefined();
  });

  it("A9a.3 — regenerate resolves a valid turn when many same-order assistant artifacts hide the prompt from the first page", async () => {
    const t = createTestConvex();
    const { userId, jobId, threadId } = await seedUserAndChatJob(t);
    const { modelId } = await seedModelAndCredits(t, userId);
    await t.run(async (ctx) => ctx.db.patch(jobId, { chatModelId: modelId }));
    const promptMessageId = await seedUserMessage(t, threadId, "wide turn");
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await paperChat.saveMessage(ctx, {
          threadId,
          promptMessageId,
          message: { role: "assistant", content: `assistant artifact ${i}` },
          metadata: { status: "success" },
          skipEmbeddings: true,
        });
      }
    });
    const caller = asCaller(t, "c_msg");

    const result = await caller.mutation(
      api.chat.messages.regenerateLastAssistant,
      { threadId },
    );

    const messagesAfterPurge = await listPersistedMessages(t, threadId);
    expect(result.started).toBe(true);
    expect(messagesAfterPurge.some((message) => message.role === "assistant"))
      .toBe(false);
  });

  it("A9b — regenerate rejects when the user is already at the chat concurrency cap", async () => {
    const t = createTestConvex();
    const stopped = await createStoppedAssistantTurn(t);
    await seedInFlightChatJobs(t, stopped.userId, 3);
    const caller = asCaller(t, "c_msg");

    await expect(
      caller.mutation(api.chat.messages.regenerateLastAssistant, {
        threadId: stopped.threadId,
      }),
    ).rejects.toThrow(/concurrent chats/i);
  });

  it("A9c — regenerate provider failure persists a failed assistant error on the rerun", async () => {
    const t = createTestConvex();
    const stopped = await createStoppedAssistantTurn(t);
    const caller = asCaller(t, "c_msg");

    await caller.mutation(api.chat.messages.regenerateLastAssistant, {
      threadId: stopped.threadId,
    });

    mockDoStream.mockImplementation(async () => {
      throw new APICallError({
        message:
          "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
        url: "https://mock/provider",
        requestBodyValues: {},
        statusCode: 400,
        isRetryable: false,
      });
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId: stopped.threadId,
      promptMessageId: stopped.promptMessageId,
    });

    const result = await caller.query(api.chat.messages.listThreadMessages, {
      threadId: stopped.threadId,
      paginationOpts: { numItems: 5, cursor: null },
      streamArgs: { kind: "list" },
    });
    const failedAssistant = result.page.find(
      (message: { role?: string; status?: string; error?: string }) =>
        message.role === "assistant" && message.status === "failed",
    );
    const jobAfterFailure = await t.run((ctx) => ctx.db.get(stopped.jobId));

    expect(failedAssistant).toBeDefined();
    expect(failedAssistant?.order).toBe(stopped.stoppedOrder);
    expect(parseChatError(failedAssistant?.error)?.class).toBe(
      "context_too_long",
    );
    expect(failedAssistant?.model).toBe("mock/model");
    expect(failedAssistant?.provider).toBe("openrouter");
    expect(jobAfterFailure?.isGenerating).toBe(false);
    expect(jobAfterFailure?.error?.code).toBe("context_too_long");
    expect(jobAfterFailure?.error?.message).toContain(
      "maximum context length is 200000 tokens",
    );
    expect(jobAfterFailure?.error?.httpStatus).toBe(400);
  });

  it("A9d — pre-stream credit failure persists a standalone failed assistant row", async () => {
    const t = createTestConvex();
    const { jobId, threadId } = await seedUserAndChatJob(t, {
      isGenerating: true,
    });
    const promptMessageId = await seedUserMessage(t, threadId, "hello");
    const caller = asCaller(t, "c_msg");

    await expect(
      t.action(internal.chat.messages.generateResponse, {
        threadId,
        promptMessageId,
      }),
    ).rejects.toThrow(/Not enough credits/);

    const result = await caller.query(api.chat.messages.listThreadMessages, {
      threadId,
      paginationOpts: { numItems: 5, cursor: null },
      streamArgs: { kind: "list" },
    });
    const failedAssistant = result.page.find(
      (message: { role?: string; status?: string; error?: string }) =>
        message.role === "assistant" && message.status === "failed",
    );
    const jobAfterFailure = await t.run((ctx) => ctx.db.get(jobId));

    expect(failedAssistant).toBeDefined();
    const errorEnvelope = parseChatError(failedAssistant?.error);
    expect(errorEnvelope?.class).toBe("insufficient_credits");
    expect(errorEnvelope?.creditEstimate).toEqual({
      required: 200,
      available: 0,
      deficit: 200,
    });
    expect(jobAfterFailure?.isGenerating).toBe(false);
    expect(jobAfterFailure?.error?.code).toBe("insufficient_credits");
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

describe("chat.messages.generateResponse — web search tool wiring (plan-06)", () => {
  /**
   * Each test seeds: a chat job, a model row (optionally with
   * supportedParameters: ["tools"]), credits, optionally flips
   * webSearchEnabled. Then runs the generateResponse action with a
   * finishing doStream and inspects the captured tools arg on
   * paperChat.streamText.
   */

  async function seedToolWiringScenario(
    t: ReturnType<typeof convexTest>,
    opts: {
      webSearchEnabled?: boolean;
      modelSupportsTools?: boolean;
    },
  ): Promise<{
    threadId: string;
    promptMessageId: string;
    jobId: Id<"extractionJobs">;
  }> {
    const { userId, jobId, threadId } = await seedUserAndChatJob(t);
    const { modelId } = await t.run(async (ctx) => {
      const now = Date.now();
      const insertedModelId = await ctx.db.insert("models", {
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
        ...(opts.modelSupportsTools
          ? { supportedParameters: ["tools"] }
          : {}),
      });
      await seedCreditsForTest(ctx, { userId, free: 10_000, now });
      return { modelId: insertedModelId };
    });
    await t.run(async (ctx) =>
      ctx.db.patch(jobId, {
        chatModelId: modelId,
        ...(opts.webSearchEnabled !== undefined
          ? { webSearchEnabled: opts.webSearchEnabled }
          : {}),
      }),
    );
    await seedChatPapers(t, jobId, [true]);
    const promptMessageId = await seedUserMessage(t, threadId, "ping");
    return { threadId, promptMessageId, jobId };
  }

  it("toggle off → no tools arg passed to paperChat.streamText", async () => {
    const t = createTestConvex();
    mockDoStream.mockImplementation(finishingDoStream(["ok"]));
    const spy = vi.spyOn(paperChat, "streamText");

    const { threadId, promptMessageId } = await seedToolWiringScenario(t, {
      webSearchEnabled: false,
      modelSupportsTools: true,
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    const call = spy.mock.calls.at(-1);
    expect(call).toBeDefined();
    const opts = call![2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("tools");

    spy.mockRestore();
  });

  it("toggle on, capability true → tools.web_search is the OpenRouter server tool", async () => {
    const t = createTestConvex();
    mockDoStream.mockImplementation(finishingDoStream(["ok"]));
    const spy = vi.spyOn(paperChat, "streamText");

    const { threadId, promptMessageId } = await seedToolWiringScenario(t, {
      webSearchEnabled: true,
      modelSupportsTools: true,
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    const call = spy.mock.calls.at(-1);
    expect(call).toBeDefined();
    const opts = call![2] as { tools?: Record<string, { type?: string; id?: string }> };
    expect(opts.tools).toBeDefined();
    const tool = opts.tools!.web_search;
    expect(tool.type).toBe("provider");
    expect(tool.id).toBe("openrouter.web_search");

    spy.mockRestore();
  });

  it("toggle on but capability missing → no tool and no search policy (silent downgrade)", async () => {
    const t = createTestConvex();
    mockDoStream.mockImplementation(finishingDoStream(["ok"]));
    const spy = vi.spyOn(paperChat, "streamText");

    const { threadId, promptMessageId } = await seedToolWiringScenario(t, {
      webSearchEnabled: true,
      modelSupportsTools: false,
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    const call = spy.mock.calls.at(-1);
    expect(call).toBeDefined();
    const opts = call![2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("tools");
    // The model isn't told about a search tool it doesn't have.
    const prompt = doStreamArgsSeen.at(-1)!.prompt as Array<{ role: string }>;
    expect(prompt.filter((m) => m.role === "system")).toHaveLength(2);

    spy.mockRestore();
  });

  it("toggle on → WEB_SEARCH_SYSTEM_INSTRUCTION reaches the model as a third system message (U4 plumbing)", async () => {
    const t = createTestConvex();
    mockDoStream.mockImplementation(finishingDoStream(["ok"]));

    const { threadId, promptMessageId } = await seedToolWiringScenario(t, {
      webSearchEnabled: true,
      modelSupportsTools: true,
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    const captured = doStreamArgsSeen.at(-1);
    expect(captured?.prompt).toBeDefined();
    const messages = captured!.prompt as Array<{
      role: string;
      content: unknown;
    }>;
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(3);
    const thirdContent = systemMessages[2]!.content;
    const text = Array.isArray(thirdContent)
      ? thirdContent.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("")
      : String(thirdContent);
    expect(text).toMatch(/PRIMARY/);
    expect(text).toMatch(/SUPPLEMENT/);
  });

  it("toggle off → only the persona + corpus system messages reach the model (no policy leak)", async () => {
    const t = createTestConvex();
    mockDoStream.mockImplementation(finishingDoStream(["ok"]));

    const { threadId, promptMessageId } = await seedToolWiringScenario(t, {
      webSearchEnabled: false,
      modelSupportsTools: true,
    });

    await t.action(internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId,
    });

    const captured = doStreamArgsSeen.at(-1);
    const messages = captured!.prompt as Array<{
      role: string;
      content: unknown;
    }>;
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(2);
  });
});

describe("retired chat model selection", () => {
  it("rejects stale selections and sends before changing the thread or queue", async () => {
    const t = createTestConvex();
    const {userId, jobId, threadId} = await seedUserAndChatJob(t);
    const {modelId} = await seedModelAndCredits(t, userId);
    await t.run(ctx => ctx.db.patch(modelId, {retiredAt: Date.now()}));
    const caller = asCaller(t, "c_msg");
    await expect(caller.mutation(api.chat.messages.swapModel, {threadId, modelId})).rejects.toThrow("Choose another model");
    expect((await t.run(ctx => ctx.db.get(jobId)))?.chatModelId).toBeUndefined();
    await t.run(ctx => ctx.db.patch(jobId, {chatModelId: modelId}));
    await expect(caller.mutation(api.chat.messages.sendMessage, {threadId, prompt: "Explain this paper"})).rejects.toThrow("Choose another model");
    expect((await t.run(ctx => ctx.db.get(jobId)))?.isGenerating).toBeUndefined();
    expect((await t.query(internal.chat.threads.getModelForThread, {threadId}))?.modelSupportedParameters).toBeNull();
  });
});

describe("chat.messages — reasoning effort", () => {
  it("sets the chat's effort only to a level its model takes, and a model swap takes the shortcut's effort", async () => {
    const t = createTestConvex();
    const {userId, jobId, threadId} = await seedUserAndChatJob(t);
    const {modelId} = await seedModelAndCredits(t, userId);
    await t.run(ctx => ctx.db.patch(modelId, {reasoningEfforts: ["low", "medium", "high"], defaultEffort: "medium"}));
    const caller = asCaller(t, "c_msg");

    await caller.mutation(api.chat.messages.swapModel, {threadId, modelId, effort: "high"});
    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({chatModelId: modelId, chatEffort: "high"});

    await caller.mutation(api.chat.messages.setChatEffort, {threadId, effort: "low"});
    expect((await t.run(ctx => ctx.db.get(jobId)))?.chatEffort).toBe("low");
    await expect(caller.mutation(api.chat.messages.setChatEffort, {threadId, effort: "max"})).rejects.toThrow(/doesn't take max/);

    // A plain swap runs the model at its default.
    await caller.mutation(api.chat.messages.swapModel, {threadId, modelId});
    expect((await t.run(ctx => ctx.db.get(jobId)))?.chatEffort).toBeUndefined();
  });
});

describe("chat.messages — effort per turn", () => {
  const scheduledEffort = (t: ReturnType<typeof createTestConvex>) =>
    t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      const generate = jobs.filter((job) => job.name.includes("generateResponse")).at(-1);
      // No effort means the model's default; convex-test turns undefined into null both ways.
      return (generate?.args[0] as { chatEffort?: string | null } | undefined)?.chatEffort ?? "default";
    });

  it("takes the effort with the model when a turn starts, and drops a level the model no longer takes", async () => {
    const t = createTestConvex();
    const {userId, jobId, threadId} = await seedUserAndChatJob(t);
    await seedChatPapers(t, jobId, [true]);
    const {modelId} = await seedModelAndCredits(t, userId);
    await t.run(ctx => ctx.db.patch(modelId, {reasoningEfforts: ["low", "high"], defaultEffort: "low"}));
    await t.run(ctx => ctx.db.patch(jobId, {chatModelId: modelId, chatEffort: "high"}));
    const caller = asCaller(t, "c_msg");

    await caller.mutation(api.chat.messages.sendMessage, {threadId, prompt: "hi"});
    expect(await scheduledEffort(t)).toBe("high");

    // The catalog dropped "high": the next turn runs at the model's default.
    await t.run(ctx => ctx.db.patch(modelId, {reasoningEfforts: ["low"]}));
    await t.run(ctx => ctx.db.patch(jobId, {isGenerating: undefined}));
    await caller.mutation(api.chat.messages.sendMessage, {threadId, prompt: "again"});
    expect(await scheduledEffort(t)).toBe("default");
  });
});
