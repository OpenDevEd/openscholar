/**
 * Chat messages surface. Mutations and a query for the chat thread
 * lifecycle after the thread has been provisioned (ensureThreadForJob).
 *
 * Flow:
 *   sendMessage (mutation)          ← client calls this
 *     ↓ acquires per-thread lock
 *     ↓ saves the user message via paperChat.saveMessage
 *     ↓ bumps messageCount + lastMessageAt
 *     ↓ schedules generateResponse
 *   generateResponse (internal action)
 *     ↓ pre-flight credit check (throws AI_INSUFFICIENT_CREDITS)
 *     ↓ resolves per-job model via resolveOpenRouterModel
 *     ↓ paperChat.streamText with saveStreamDeltas
 *     ↓ try/finally releases the lock
 *   listThreadMessages (query)
 *     ← reactive subscription on client; drives useUIMessages
 *   regenerateLastAssistant / clearThread / swapModel: affordances.
 */

import type { ActionCtx, MutationCtx } from "../_generated/server";
import {
  internalAction,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import {
  paginationOptsValidator,
  type PaginationOptions,
} from "convex/server";
import {
  listMessages,
  syncStreams,
  toUIMessages,
  vStreamArgs,
} from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { paperChat } from "./agent";
import { authorizeThreadAccess } from "./auth";
import { resolveOpenRouterModel } from "./provider";
import { ESTIMATED_CREDITS_PER_CHAT_MESSAGE } from "../lib/constants";
import {
  classifyChatError,
  serializeChatError,
} from "../../lib/errors/taxonomy";
import { startAbortPoller } from "../../lib/chat/abort-poller";
import {
  ABORT_REASON_USER_STOPPED,
  ABORT_ERROR_STRING,
} from "../../lib/chat/abort-signal";
import { resolveLatestAssistantTurn } from "../../lib/chat/latest-assistant-turn";
import {
  estimateTokenCount,
  extractMessageText,
  errorToLogString,
} from "./abortTokenEstimate";

export const STOP_ABORT_POLL_INTERVAL_MS = 500;

/* ────────────────────────────────────────────────────────────────── */
/*                      User → Assistant turn                         */
/* ────────────────────────────────────────────────────────────────── */

export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, prompt }) => {
    if (prompt.trim().length === 0) {
      throw createError("VALIDATION_ERROR", "Prompt must not be empty");
    }
    const { job } = await authorizeThreadAccess(ctx, threadId);

    // Zero-included guard (D9). Defensive second gate — the composer
    // should already have Send disabled via its reactive `includedCount`
    // subscription, but a race between client-side click and server-side
    // handler entry could slip through. Short-circuit read: .take(1) is
    // O(1); we only need to know whether *any* included row exists.
    const hasIncluded = (
      await ctx.db
        .query("chatPapers")
        .withIndex("by_job_included", (q) =>
          q.eq("jobId", job._id).eq("included", true),
        )
        .take(1)
    ).length > 0;
    if (!hasIncluded) {
      throw createError(
        "NO_SOURCES_INCLUDED",
        "At least one source must be included before sending a message.",
      );
    }

    // Inline lock logic — runMutation to acquireThreadLock would be a
    // separate transaction; we want the lock set atomically with the
    // user-message insert below so a concurrent sendMessage can't slip
    // in between acquire + save.
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "A response is already being generated for this chat.",
      );
    }

    const { messageId } = await paperChat.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });

    const now = Date.now();
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: now,
      lastMessageAt: now,
      messageCount: (job.messageCount ?? 0) + 1,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId: messageId },
    );

    return null;
  },
});

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId }) => {
    const meta = await ctx.runQuery(
      internal.chat.threads.getModelForThread,
      { threadId },
    );
    if (!meta) {
      throw createError("NOT_FOUND", "Thread not found");
    }
    const { jobId, userId, chatModelId } = meta;

    // Abort wiring (plans/chat-stop-streaming/01-action-abort-wiring.md).
    // Poll job.shouldAbort every 500ms; when flipped, abort the signal
    // we pass into paperChat.streamText, which cascades through the
    // library's DeltaStreamer → AI SDK streamText → OpenRouter fetch.
    const abortController = new AbortController();
    const stopAbortPoller = startAbortPoller({
      readFlag: async () => {
        const flag: boolean = await ctx.runQuery(
          internal.chat.messages.shouldAbortInternal,
          { jobId },
        );
        return flag;
      },
      onAbort: () => {
        if (!abortController.signal.aborted) {
          abortController.abort(
            new DOMException(ABORT_REASON_USER_STOPPED, "AbortError"),
          );
        }
      },
      intervalMs: STOP_ABORT_POLL_INTERVAL_MS,
    });

    // True once `onError` has patched the pending message with a
    // structured envelope *from the original provider error* (which has
    // statusCode, headers, body — everything we need for a precise
    // classification). If it ran, the inner catch skips re-patching,
    // because the error reaching the catch is the agent's stringified
    // wrapper ("Provider returned error") and would downgrade our
    // envelope from `rate_limit` to `provider_5xx` / `unknown`.
    let envelopePatchedFromOnError = false;

    // Captured from OpenRouter's X-Generation-Id response header via
    // the provider's fetch wrapper (see convex/chat/openrouterFetch.ts).
    // The header lands on the initial HTTP response frame, so this ref
    // is populated even when the client aborts the stream mid-flight.
    // That is what lets stopped turns bill against OpenRouter's
    // /api/v1/generation endpoint via billing.reconcileGenerationUsage.
    let capturedGenerationId: string | undefined;
    let capturedModelSlug: string | undefined;
    // Flipped by onFinish (happy path) OR onAbort (cancelled path) once
    // local billing has committed. The post-stream reconcile block
    // checks this flag and skips scheduling reconcile when either fast
    // path already wrote the deduction — prevents OpenRouter's
    // /api/v1/generation lookup from double-billing, and avoids
    // scheduling a reconcile that would 404 forever anyway for
    // cancelled streams on non-whitelisted providers (Google, Groq,
    // Mistral, …). See plans/chat-exact-stop-billing/01 for the
    // provider-dependence analysis.
    let onFinishBilled = false;
    // Accumulates streamed text deltas so onAbort can tokenize what
    // the user actually received and bill from an estimate when
    // OpenRouter's generation lookup is unavailable for the cancel
    // path (see abortTokenEstimate.ts for the heuristic's caveats).
    let accumulatedOutput = "";

    try {
      const balance = await ctx.runQuery(
        internal.credits.internal.getBalanceByUserId,
        { userId },
      );
      if (!balance || balance.total < ESTIMATED_CREDITS_PER_CHAT_MESSAGE) {
        throw createError(
          "AI_INSUFFICIENT_CREDITS",
          "Not enough credits for this chat message.",
        );
      }

      const { model, modelSlug, pricing } = await resolveOpenRouterModel(
        ctx,
        chatModelId,
        {
          generationIdSink: (id) => {
            capturedGenerationId = id;
          },
        },
      );
      capturedModelSlug = modelSlug;

      try {
        await paperChat.streamText(
          ctx,
          { threadId, userId },
          {
            promptMessageId,
            model,
            abortSignal: abortController.signal,
            // Retries serve no user when the stream is live — the user
            // is watching and would prefer a fast failure or a clean
            // abort over a ~2s wait for a retry that mid-stream can't
            // salvage anyway.
            maxRetries: 0,
            onChunk: async ({ chunk }) => {
              // Accumulate the text the user actually saw — on abort we
              // tokenize this to bill from an estimate. Only text-delta
              // counts: reasoning chunks ship via a separate detail
              // channel and are priced differently by most providers.
              if (chunk.type === "text-delta") {
                accumulatedOutput += chunk.text ?? "";
              }
            },
            onFinish: async ({ usage }) => {
              // Fast path for successful turns. AI SDK v6's onFinish
              // fires with aggregated usage once every step has
              // completed — for V1 (stepCountIs(1)) this is equivalent
              // to onStepFinish. It does NOT fire on abort, which is
              // exactly what we want: aborts fall through to the
              // post-stream reconcile block below, which resolves cost
              // against OpenRouter's /api/v1/generation endpoint.
              const inputTokens = usage?.inputTokens ?? 0;
              const outputTokens = usage?.outputTokens ?? 0;
              if (inputTokens === 0 && outputTokens === 0) return;

              const reasoningTokens =
                usage?.outputTokenDetails?.reasoningTokens ??
                usage?.reasoningTokens ??
                0;
              const cachedPromptTokens =
                usage?.inputTokenDetails?.cacheReadTokens ??
                usage?.cachedInputTokens ??
                0;

              if (capturedGenerationId) {
                // Prefer ledger-backed billing keyed on generation id
                // so duplicate invocations (e.g. on retry) no-op via
                // the billedAt guard inside billGenerationFromSdkUsage.
                await ctx.runMutation(
                  internal.chat.billing.captureGenerationFromResponse,
                  {
                    threadId,
                    generationId: capturedGenerationId,
                    requestedModel: modelSlug,
                  },
                );
                await ctx.runMutation(
                  internal.chat.billing.billGenerationFromSdkUsage,
                  {
                    generationId: capturedGenerationId,
                    model: modelSlug,
                    pricing,
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    reasoningTokens,
                    cachedPromptTokens,
                  },
                );
              } else {
                // Defence-in-depth: fetch wrapper missed the header
                // but the stream still finished. Bill via the thread-
                // keyed path so the user isn't undercharged.
                await ctx.runMutation(
                  internal.chat.billing.billThreadUsageFromSdk,
                  {
                    threadId,
                    model: modelSlug,
                    pricing,
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    reasoningTokens,
                    cachedPromptTokens,
                  },
                );
              }
              onFinishBilled = true;
            },
            onAbort: async ({ steps }) => {
              console.info("[chat] stream aborted by user", {
                jobId,
                threadId,
                stepCount: steps.length,
                accumulatedChars: accumulatedOutput.length,
              });

              // Local estimate billing for the cancel path. Provider-
              // routing gap means OpenRouter's /api/v1/generation does
              // not publish cancelled records for non-whitelisted
              // providers (Google/Groq/Mistral/…). Without an
              // authoritative source we bill from what the user saw:
              // tokenize the streamed text (output) and the user's
              // prompt message (input). This undercharges relative to
              // OpenRouter's internal accounting — system prompt and
              // thread context are excluded — which is the policy we
              // want: aborts charge less than a full turn.
              if (!capturedGenerationId) return;
              if (accumulatedOutput.length === 0) return;

              const outputTokens = estimateTokenCount(accumulatedOutput);
              let inputTokens = 0;
              try {
                // promptMessageId is the agent component's opaque id —
                // it lives in the component's own schema, not our root
                // schema, so we can't name it with our Id<"messages">
                // brand. Convex validates the value at the boundary.
                const messageDocs = await ctx.runQuery(
                  components.agent.messages.getMessagesByIds,
                  { messageIds: [promptMessageId as never] },
                );
                const promptMessage = messageDocs[0];
                const promptText = extractMessageText(promptMessage);
                inputTokens = estimateTokenCount(promptText);
              } catch (err) {
                console.warn(
                  "[chat] abort billing: failed to read prompt text for token estimate",
                  { jobId, threadId, err: errorToLogString(err) },
                );
              }

              if (inputTokens === 0 && outputTokens === 0) return;

              await ctx.runMutation(
                internal.chat.billing.captureGenerationFromResponse,
                {
                  threadId,
                  generationId: capturedGenerationId,
                  requestedModel: modelSlug,
                },
              );
              await ctx.runMutation(
                internal.chat.billing.billGenerationFromSdkUsage,
                {
                  generationId: capturedGenerationId,
                  model: modelSlug,
                  pricing,
                  promptTokens: inputTokens,
                  completionTokens: outputTokens,
                  reasoningTokens: 0,
                  cachedPromptTokens: 0,
                },
              );
              onFinishBilled = true;
            },
            onError: async ({ error }) => {
              // This runs with the ORIGINAL provider error (429 w/
              // retry-after, etc.) but only if the agent's own
              // `call.fail` → `finalizeMessage` path did not throw.
              // When finalizeMessage DOES throw (stream-had-error-
              // chunks case), this never runs and we fall back to the
              // inner catch below.
              const patched = await patchLastAssistantAsFailed(
                ctx,
                threadId,
                error,
              ).catch(() => false);
              if (patched) envelopePatchedFromOnError = true;
            },
          },
          { saveStreamDeltas: { chunking: "word", throttleMs: 250 } },
        );
      } catch (err) {
        // The agent's `streamText` wrapper re-throws stream errors
        // (node_modules/@convex-dev/agent/src/client/streamText.ts:180).
        // We land here for every stream-time failure — and sometimes
        // before onError got a chance, when the agent's call.fail
        // itself threw inside finalizeMessage. Force-transition the
        // stuck pending assistant to `failed` so the UI can render an
        // alert instead of an empty bubble.
        // NOTE: abort is NOT an error path. AI SDK swallows AbortError
        // and converts it to an {type:"abort"} stream chunk; paperChat
        // .streamText returns normally on abort and this catch never
        // fires for user-stop.
        if (!envelopePatchedFromOnError) {
          const patched = await patchLastAssistantAsFailed(
            ctx,
            threadId,
            err,
          ).catch(() => false);
          // startGeneration failed before a pending assistant could be
          // saved — persist a standalone one so the thread still shows
          // the error.
          if (!patched) {
            await saveStandaloneErrorMessage(ctx, threadId, err).catch(
              () => {},
            );
          }
        }
      }

      // Reconcile path for turns onFinish did NOT settle — aborts and
      // stream errors that still produced an OpenRouter generation id.
      // captureGenerationFromResponse is idempotent (unique index on
      // generationId) so it's safe to invoke here even when onFinish
      // already inserted the row; we just skip scheduling reconcile
      // when the fast path already wrote the deduction, otherwise the
      // /api/v1/generation lookup would double-bill on happy paths.
      if (capturedGenerationId && !onFinishBilled) {
        await ctx.runMutation(
          internal.chat.billing.captureGenerationFromResponse,
          {
            threadId,
            generationId: capturedGenerationId,
            requestedModel: capturedModelSlug,
          },
        );
        await ctx.scheduler.runAfter(
          0,
          internal.chat.billing.reconcileGenerationUsage,
          { generationId: capturedGenerationId },
        );
      }
    } catch (err) {
      // Genuine pre-stream failures only: credit guard, thread/model
      // lookup, provider construction. No pending assistant message
      // exists yet, so persist a standalone one inline.
      await saveStandaloneErrorMessage(ctx, threadId, err).catch(() => {});
      throw err;
    } finally {
      // Stop the poller BEFORE releasing the lock. releaseThreadLock
      // clears shouldAbort=undefined; if a poll tick raced past that
      // clear we could — in theory — spuriously abort the very next
      // turn (impossible under the current per-thread lock, but
      // defence in depth). See plan § 3 placement notes.
      stopAbortPoller();
      await ctx.runMutation(
        internal.chat.concurrency.releaseThreadLock,
        { jobId },
      );
    }
    return null;
  },
});

/**
 * Force-transition the newest pending/failed assistant message to
 * `status:"failed"` with a serialized {@link ChatErrorEnvelope} as its
 * `error` field.
 *
 * We accept `pending` here because the agent's own `call.fail` may have
 * thrown inside `finalizeMessage` (it re-processes saved stream chunks,
 * and that processor throws on error chunks — see
 * node_modules/@convex-dev/agent/src/deltas.ts). In that case the
 * pending row is stuck in `status:"pending"` and the UI sees an empty
 * bubble. Patching it here is what lets the failure alert render.
 *
 * Returns true if a patch was made (so callers can know whether they
 * still need to save a standalone error message).
 */
async function patchLastAssistantAsFailed(
  ctx: ActionCtx,
  threadId: string,
  rawError: unknown,
): Promise<boolean> {
  const envelope = classifyChatError(rawError);
  const serialized = serializeChatError(envelope);
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 1, cursor: null },
    statuses: ["pending", "failed"],
  });
  const last = page[0];
  if (!last) return false;
  if (last.message?.role !== "assistant") return false;
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId: last._id,
    patch: { status: "failed", error: serialized },
  });
  return true;
}

/**
 * For failures that occur before `streamText` gets a chance to create a
 * pending assistant message (e.g. insufficient credits, thread lookup
 * failure), persist a standalone assistant message with the envelope so
 * the chat UI can still render the error inline.
 */
async function saveStandaloneErrorMessage(
  ctx: ActionCtx,
  threadId: string,
  rawError: unknown,
) {
  const envelope = classifyChatError(rawError);
  const serialized = serializeChatError(envelope);
  await paperChat.saveMessage(ctx, {
    threadId,
    message: { role: "assistant", content: "" },
    metadata: { status: "failed", error: serialized },
    skipEmbeddings: true,
  });
}

/* ────────────────────────────────────────────────────────────────── */
/*                        Reactive message list                       */
/* ────────────────────────────────────────────────────────────────── */

const THREAD_MESSAGE_ROWS_READ_MULTIPLIER = 8;
const THREAD_MESSAGE_MAX_BYTES_READ = 256 * 1024;

function withThreadMessageReadCaps(paginationOpts: PaginationOptions) {
  return {
    ...paginationOpts,
    maximumRowsRead:
      paginationOpts.maximumRowsRead ??
      paginationOpts.numItems * THREAD_MESSAGE_ROWS_READ_MULTIPLIER,
    maximumBytesRead:
      paginationOpts.maximumBytesRead ?? THREAD_MESSAGE_MAX_BYTES_READ,
  };
}

type ThreadMessagePage = Awaited<
  ReturnType<typeof listMessages>
>;
type RecentThreadMessagesPage = Awaited<
  ReturnType<typeof paperChat.listMessages>
>;
type ListThreadMessagesStreamArgs = {
  kind: "list";
  startOrder?: number;
};

function countVisibleMessageGroups(rawMessages: ThreadMessagePage["page"]) {
  let groups = 0;
  let lastKey: string | null = null;
  for (const message of rawMessages) {
    const key = `${message.order}:${message.message?.role ?? "unknown"}`;
    if (key === lastKey) continue;
    lastKey = key;
    groups += 1;
  }
  return groups;
}

async function readThreadMessagesWithVisiblePageIntegrity(
  ctx: QueryCtx,
  args: {
    threadId: string;
    paginationOpts: PaginationOptions;
    streamArgs?: ListThreadMessagesStreamArgs;
  },
): Promise<ThreadMessagePage> {
  const rawMessages: ThreadMessagePage["page"] = [];
  let cursor = args.paginationOpts.cursor;
  let isDone = false;
  let continueCursor: ThreadMessagePage["continueCursor"] = "";
  let splitCursor: ThreadMessagePage["splitCursor"];
  let pageStatus: ThreadMessagePage["pageStatus"];

  while (!isDone) {
    const rawPage = await listMessages(ctx, components.agent, {
      ...args,
      paginationOpts: withThreadMessageReadCaps({
        ...args.paginationOpts,
        cursor,
      }),
    });

    rawMessages.push(...rawPage.page);
    isDone = rawPage.isDone;
    continueCursor = rawPage.continueCursor;
    splitCursor = rawPage.splitCursor;
    pageStatus = rawPage.pageStatus;

    if (
      rawMessages.length === 0 ||
      countVisibleMessageGroups(rawMessages) >= args.paginationOpts.numItems
    ) {
      break;
    }
    if (!continueCursor || continueCursor === cursor) {
      break;
    }
    cursor = continueCursor;
  }

  return {
    page: rawMessages,
    isDone,
    continueCursor,
    splitCursor,
    pageStatus,
  };
}

type ThreadStreamArtifact = {
  streamId: string;
  order: number;
};

async function listRecentThreadArtifacts(
  ctx: MutationCtx,
  threadId: string,
): Promise<{
  messages: RecentThreadMessagesPage["page"];
  streams: ThreadStreamArtifact[];
}> {
  const messages = await paperChat.listMessages(ctx, {
    threadId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  const streams = await ctx.runQuery(components.agent.streams.list, {
    threadId,
    statuses: ["streaming", "finished", "aborted"],
  });
  return { messages: messages.page, streams };
}

async function deleteStreamArtifacts(
  ctx: MutationCtx,
  streamIds: string[],
) {
  for (const streamId of streamIds) {
    await ctx.runMutation(components.agent.streams.deleteStreamSync, {
      streamId,
    });
  }
}

async function purgeAssistantTurnArtifacts(
  ctx: MutationCtx,
  args: {
    assistantMessageIds: string[];
    streamIds: string[];
  },
) {
  if (args.assistantMessageIds.length > 0) {
    await ctx.runMutation(components.agent.messages.deleteByIds, {
      messageIds: args.assistantMessageIds,
    });
  }
  await deleteStreamArtifacts(ctx, args.streamIds);
}

async function clearThreadStreams(ctx: MutationCtx, threadId: string) {
  // Query the latest page repeatedly; each pass removes those rows, so the
  // next query exposes the next batch without touching the thread row.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const streams = await ctx.runQuery(components.agent.streams.list, {
      threadId,
      statuses: ["streaming", "finished", "aborted"],
    });
    if (streams.length === 0) break;
    await deleteStreamArtifacts(
      ctx,
      streams.map((stream) => stream.streamId),
    );
  }
}

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    streams: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId);
    const listModeStreamArgs =
      args.streamArgs?.kind === "list" ? args.streamArgs : undefined;
    const [rawPage, streams] = await Promise.all([
      readThreadMessagesWithVisiblePageIntegrity(ctx, {
        threadId: args.threadId,
        paginationOpts: args.paginationOpts,
        streamArgs: listModeStreamArgs,
      }),
      // includeStatuses is required for aborted stream rows to reach the
      // client — the library default is ["streaming"] only
      // (@convex-dev/agent/src/component/streams.ts:125), which silently
      // drops aborted streams. Passing all three here means a user-stopped
      // message stays visible with its partial deltas.
      syncStreams(ctx, components.agent, {
        ...args,
        includeStatuses: ["streaming", "finished", "aborted"],
      }),
    ]);
    const paginated = {
      ...rawPage,
      page: toUIMessages(rawPage.page),
    };
    // `toUIMessages` drops the `error` field during the doc→UI
    // conversion. Attach it back by id so the client's failure Alert
    // can classify and render without a second query.
    // Aborted messages are a special case: the library's call.fail path
    // persists them as {status:"failed", error: ABORT_ERROR_STRING}. We
    // translate that sentinel into a clean `aborted: true` boolean and
    // drop the envelope so the client branches cleanly without parsing
    // an error string.
    const errorById = new Map<string, string>();
    for (const doc of rawPage.page) {
      if (doc.error) errorById.set(doc._id, doc.error);
    }
    const page = paginated.page.map((m) => {
      const err = errorById.get(m.id);
      if (!err) return m;
      if (err === ABORT_ERROR_STRING) return { ...m, aborted: true };
      return { ...m, error: err };
    });
    return { ...paginated, page, streams };
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                  Regenerate / Clear / Swap model                   */
/* ────────────────────────────────────────────────────────────────── */

export const regenerateLastAssistant = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "Wait for the current response before regenerating.",
      );
    }

    const { messages, streams } = await listRecentThreadArtifacts(ctx, threadId);
    const latestTurn = resolveLatestAssistantTurn({ messages, streams });
    if (!latestTurn) return null;

    await purgeAssistantTurnArtifacts(ctx, {
      assistantMessageIds: latestTurn.assistantMessageIds,
      streamIds: latestTurn.streamIds,
    });

    const now = Date.now();
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.chat.messages.generateResponse,
      { threadId, promptMessageId: latestTurn.promptMessageId },
    );
    return null;
  },
});

export const clearThread = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "Wait for the current response before clearing.",
      );
    }

    let startOrder: number | undefined = 0;
    // Loop because deleteMessageRange paginates internally — keep
    // invoking until it signals isDone.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await paperChat.deleteMessageRange(ctx, {
        threadId,
        startOrder: startOrder ?? 0,
        endOrder: Number.MAX_SAFE_INTEGER,
      });
      if (r.isDone) break;
      startOrder = r.lastOrder;
    }

    await clearThreadStreams(ctx, threadId);

    await ctx.db.patch(job._id, {
      isGenerating: false,
      generatingStartedAt: undefined,
      shouldAbort: undefined,
      messageCount: 0,
      lastMessageAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const swapModel = mutation({
  args: {
    threadId: v.string(),
    modelId: v.id("models"),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, modelId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    await ctx.db.patch(job._id, {
      chatModelId: modelId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                          Mid-stream abort                          */
/* ────────────────────────────────────────────────────────────────── */

export const abortGeneration = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (!job.isGenerating) return null;
    await ctx.db.patch(job._id, {
      shouldAbort: true,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const shouldAbortInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.boolean(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    return job?.shouldAbort === true;
  },
});

// Export unused helper so TypeScript keeps the Id import alive — helps
// any future caller that wants to type a modelId locally.
export type ChatMessageJobId = Id<"extractionJobs">;
