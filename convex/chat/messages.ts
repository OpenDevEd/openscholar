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
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "../lib/functions";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import {
  listMessages,
  syncStreams,
  toUIMessages,
  vStreamArgs,
} from "@convex-dev/agent";
import type { ToolSet } from "ai";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireAvailableModel, requireEffort, requireTaskModel } from "../models/catalog";
import { effortValidator } from "../aiModelConfig/validators";
import { paperChat } from "./agent";
import { authorizeThreadAccess } from "./auth";
import { resolveOpenRouterModel } from "./provider";
import { buildOpenRouterWebSearchTool } from "./tools/openrouterWebSearch";
import { chatSearchesWeb } from "../../lib/chat/web-search-capability";
import { ESTIMATED_CREDITS_PER_CHAT_MESSAGE } from "../lib/constants";
import {
  classifyChatError,
  errorCodeValidator,
  serializeChatError,
  type ErrorCode,
} from "../../lib/errors/taxonomy";
import { startAbortPoller } from "../../lib/chat/abort-poller";
import {
  ABORT_ERROR_STRING,
} from "../../lib/chat/abort-signal";
import {
  normalizeChatUIMessage,
  selectChatMessageError,
} from "../../lib/chat/message-state";
import { resolveLatestAssistantTurn } from "../../lib/chat/latest-assistant-turn";
import { pickProviderCostUsd } from "../../lib/chat/pick-provider-cost";
import { errorToLogString } from "../lib/errors";
import { assertChatConcurrencyAvailable, LEASE_RENEW_MS } from "./concurrency";
import { reserveCredits, releaseCredits, settleCredits, tokenCounts, tokenDetails } from "../billing/charge";
import { callOptions } from "../../lib/ai/core/call-options";
import { aggregateUsage, usageOf } from "../../lib/ai/core/cost";
import type { Usage } from "../../lib/ai/core/types";
import {
  CHAT_WEB_SEARCHES_PER_REPLY,
  convertUsdToCredits,
  WEB_SEARCH_CREDITS,
} from "../../lib/pricing";
import { calculateCostInDollars } from "../../lib/ai/core/cost";
import { CHAT_PROMPT_MAX_CHARS } from "@/lib/extraction/limits";

export const STOP_ABORT_POLL_INTERVAL_MS = 500;

const chatGenerationJobErrorValidator = v.object({
  code: errorCodeValidator,
  message: v.string(),
  httpStatus: v.optional(v.number()),
  retryAfterMs: v.optional(v.number()),
  providerName: v.optional(v.string()),
  at: v.number(),
});

type ChatGenerationJobError = {
  code: ErrorCode;
  message: string;
  httpStatus?: number;
  retryAfterMs?: number;
  providerName?: string;
  at: number;
};

function newChatGenerationAttemptId(now: number): string {
  return `${now}:${Math.random().toString(36).slice(2)}`;
}

function toChatGenerationJobError(rawError: unknown) {
  const envelope = classifyChatError(rawError);
  return {
    code: envelope.class,
    message: envelope.message,
    ...(envelope.httpStatus !== undefined
      ? { httpStatus: envelope.httpStatus }
      : {}),
    ...(envelope.retryAfterMs !== undefined
      ? { retryAfterMs: envelope.retryAfterMs }
      : {}),
    ...(envelope.providerName !== undefined
      ? { providerName: envelope.providerName }
      : {}),
    at: Date.now(),
  };
}

function regenerateUnavailableError(
  jobError: ChatGenerationJobError | undefined,
  diagnostic: string,
): ChatGenerationJobError {
  if (jobError) {
    return {
      code: jobError.code,
      message: jobError.message,
      ...(jobError.httpStatus !== undefined
        ? { httpStatus: jobError.httpStatus }
        : {}),
      ...(jobError.retryAfterMs !== undefined
        ? { retryAfterMs: jobError.retryAfterMs }
        : {}),
      ...(jobError.providerName !== undefined
        ? { providerName: jobError.providerName }
        : {}),
      at: jobError.at,
    };
  }
  return {
    code: "regenerate_failed",
    message: diagnostic,
    at: Date.now(),
  };
}

export const recordGenerationError = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    generationAttemptId: v.optional(v.string()),
    error: chatGenerationJobErrorValidator,
  },
  returns: v.null(),
  handler: async (ctx, { jobId, generationAttemptId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (
      generationAttemptId !== undefined &&
      job.chatGenerationAttemptId !== generationAttemptId
    ) {
      return null;
    }
    await ctx.db.patch(jobId, {
      error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const clearGenerationError = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    generationAttemptId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, generationAttemptId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (
      generationAttemptId !== undefined &&
      job.chatGenerationAttemptId !== generationAttemptId
    ) {
      return null;
    }
    await ctx.db.patch(jobId, {
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

async function recordGenerationErrorFromAction(
  ctx: ActionCtx,
  args: {
    jobId: Id<"extractionJobs">;
    generationAttemptId?: string;
    error: unknown;
  },
) {
  const error = toChatGenerationJobError(args.error);
  if (error.code === "aborted") return;
  await ctx.runMutation(internal.chat.messages.recordGenerationError, {
    jobId: args.jobId,
    generationAttemptId: args.generationAttemptId,
    error,
  });
}

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
    if (prompt.length > CHAT_PROMPT_MAX_CHARS) {
      throw createError("VALIDATION_ERROR", `A message can be at most ${CHAT_PROMPT_MAX_CHARS.toLocaleString("en")} characters.`);
    }
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (job.chatModelId) await requireAvailableModel(ctx, job.chatModelId);

    // Zero-included guard (D9). Defensive second gate — the composer
    // should already have Send disabled via its reactive `includedCount`
    // subscription, but a race between client-side click and server-side
    // handler entry could slip through. Short-circuit read: .take(1) is
    // O(1); we only need to know whether *any* included row exists.
    const hasIncluded =
      (
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
    await assertChatConcurrencyAvailable(ctx, job.userId);

    const { messageId } = await paperChat.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });

    const now = Date.now();
    const generationAttemptId = newChatGenerationAttemptId(now);
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: now,
      chatGenerationAttemptId: generationAttemptId,
      error: undefined,
      lastMessageAt: now,
      messageCount: (job.messageCount ?? 0) + 1,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId: messageId,
      generationAttemptId,
      chatModelId: job.chatModelId ?? null,
      chatEffort: await liveChatEffort(ctx, job),
    });

    return null;
  },
});

/** The chat's effort if its model still takes it; a level the catalog dropped runs at the default. */
async function liveChatEffort(ctx: MutationCtx, job: Doc<"extractionJobs">) {
  if (!job.chatEffort || !job.chatModelId) return undefined;
  const model = await ctx.db.get("models", job.chatModelId);
  return model?.reasoningEfforts?.includes(job.chatEffort) ? job.chatEffort : undefined;
}

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    generationAttemptId: v.optional(v.string()),
    chatModelId: v.optional(v.union(v.id("models"), v.null())),
    /** Taken with the model when the turn starts, so a later change only affects the next turn. */
    chatEffort: v.optional(effortValidator),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { threadId, promptMessageId, generationAttemptId, chatModelId, chatEffort },
  ) => {
    const meta = await ctx.runQuery(internal.chat.threads.getModelForThread, {
      threadId,
    });
    if (!meta) {
      throw createError("NOT_FOUND", "Thread not found");
    }
    const { jobId, userId } = meta;
    const requestedChatModelId =
      chatModelId !== undefined ? chatModelId : meta.chatModelId;

    // Abort wiring (plans/chat-stop-streaming/01-action-abort-wiring.md).
    // Poll job.shouldAbort every 500ms; when flipped, abort the signal
    // we pass into paperChat.streamText, which cascades through the
    // library's DeltaStreamer → AI SDK streamText → OpenRouter fetch.
    const abortController = new AbortController();
    // The poller also renews this generation's lock, so a long reply isn't
    // taken for one that died (convex/chat/concurrency.ts).
    let leaseRenewedAt = Date.now();
    const stopAbortPoller = startAbortPoller({
      readFlag: async () => {
        if (Date.now() - leaseRenewedAt >= LEASE_RENEW_MS) {
          leaseRenewedAt = Date.now();
          await ctx.runMutation(internal.chat.concurrency.renewGenerationLease, { jobId, generationAttemptId });
        }
        const flag: boolean = await ctx.runQuery(
          internal.chat.messages.shouldAbortInternal,
          { jobId, generationAttemptId },
        );
        return flag;
      },
      onAbort: () => {
        if (!abortController.signal.aborted) {
          // Pass the wire string directly as the abort reason. The agent
          // library serializes via `abortSignal.reason?.toString()` at
          // start.ts:175, and String#toString returns the string itself,
          // so the persisted MessageDoc.error becomes ABORT_ERROR_STRING
          // verbatim — same value our defensive persistAssistantAbort
          // Sentinel writes. Avoids the prior dependency on
          // `new DOMException(reason, name).toString()` happening to
          // format as "AbortError: user_stopped" at runtime.
          abortController.abort(ABORT_ERROR_STRING);
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
    let generationErrorRecordedFromOnError = false;

    // Captured from OpenRouter's X-Generation-Id response header via
    // the provider's fetch wrapper (see convex/chat/openrouterFetch.ts).
    // The header lands on the initial HTTP response frame, so this ref
    // is populated even when the client aborts the stream mid-flight.
    // That is what lets stopped turns bill from OpenRouter's
    // /api/v1/generation record via chat/billing.ts settleFromOpenRouter.
    let capturedGenerationId: string | undefined;
    let capturedModelSlug: string | undefined;
    let streamErrored = false;
    let streamAbortedByUser = false;
    let streamReturned = false;
    // Credits for this turn are held under chargeId until the turn settles.
    const chargeId = `chat:${generationAttemptId ?? crypto.randomUUID()}`;
    let reserved = false;
    let settledOrScheduled = false;
    // A turn can take several model steps (tool calls). Each completed step
    // adds its cost; a step still running at a stop or error is billed from
    // its OpenRouter generation record.
    let completedUsd = 0;
    let completedTokens = 0;
    const stepUsages: Usage[] = [];
    const completedGenerations = new Set<string>();
    let finished = false;

    try {
      const webSearch = chatSearchesWeb(meta);
      // A web-search reply can run every search it's allowed.
      const requiredCredits =
        ESTIMATED_CREDITS_PER_CHAT_MESSAGE +
        (webSearch ? WEB_SEARCH_CREDITS * CHAT_WEB_SEARCHES_PER_REPLY : 0);
      if (!(await reserveCredits(ctx, { userId, chargeId, credits: requiredCredits }))) {
        const account = await ctx.runQuery(internal.billing.accounts.forUser, { userId });
        const availableCredits = account?.balance ?? 0;
        throw createError(
          "AI_INSUFFICIENT_CREDITS",
          "Not enough credits for this chat message.",
          {
            requiredCredits,
            availableCredits,
            deficitCredits: Math.max(0, requiredCredits - availableCredits),
          },
        );
      }
      reserved = true;

      const { model, modelSlug, pricing } = await resolveOpenRouterModel(
        ctx,
        requestedChatModelId,
        {
          generationIdSink: (id) => {
            capturedGenerationId = id;
          },
        },
      );
      capturedModelSlug = modelSlug;

      const tools = webSearch
        ? ({ web_search: buildOpenRouterWebSearchTool() } as ToolSet)
        : undefined;

      try {
        await paperChat.streamText(
          ctx,
          { threadId, userId },
          {
            promptMessageId,
            model,
            // Paper context is assembled from trusted server-owned system messages.
            allowSystemInMessages: true,
            abortSignal: abortController.signal,
            ...(tools ? { tools } : {}),
            // Retries serve no user when the stream is live — the user
            // is watching and would prefer a fast failure or a clean
            // abort over a ~2s wait for a retry that mid-stream can't
            // salvage anyway.
            maxRetries: 0,
            // Claude caches the corpus and earlier turns; the thread id keeps
            // every turn on the same upstream host so that cache stays warm.
            providerOptions: callOptions(model, { cache: true, sessionId: threadId, effort: chatEffort }),
            onStepEnd: async ({ usage, providerMetadata }) => {
              stepUsages.push(usageOf({ usage, providerMetadata }));
              const inputTokens = usage?.inputTokens ?? 0;
              const outputTokens = usage?.outputTokens ?? 0;
              completedTokens += inputTokens + outputTokens;
              // OpenRouter's reported cost includes its web searches; tokens ×
              // price is the fallback.
              completedUsd +=
                pickProviderCostUsd(providerMetadata) ??
                calculateCostInDollars({ inputTokens, outputTokens }, pricing);
              if (capturedGenerationId) completedGenerations.add(capturedGenerationId);
            },
            onEnd: async () => {
              finished = true;
            },
            onAbort: ({ steps }) => {
              // The SDK awaits this callback. Leave billing and finalization
              // to the action body after the stream has been consumed.
              streamAbortedByUser = true;
              console.info("[chat] stream aborted by user", {
                jobId,
                threadId,
                stepCount: steps.length,
              });
            },
            onError: async ({ error }) => {
              streamErrored = true;
              // This runs with the ORIGINAL provider error (429 w/
              // retry-after, etc.) but only if the agent's own
              // `call.fail` → `finalizeMessage` path did not throw.
              // When finalizeMessage DOES throw (stream-had-error-
              // chunks case), this never runs and we fall back to the
              // inner catch below.
              await recordGenerationErrorFromAction(ctx, {
                jobId,
                generationAttemptId,
                error,
              })
                .then(() => {
                  generationErrorRecordedFromOnError = true;
                })
                .catch((err) => {
                  console.error("[chat] failed to record generation error", {
                    jobId,
                    threadId,
                    err: errorToLogString(err),
                  });
                });
              const patched = await patchLastAssistantAsFailed(
                ctx,
                threadId,
                promptMessageId,
                error,
                { model: capturedModelSlug, provider: "openrouter" },
              ).catch(() => false);
              if (patched) envelopePatchedFromOnError = true;
            },
          },
          { saveStreamDeltas: { chunking: "word", throttleMs: 250 } },
        );
        streamReturned = true;
      } catch (err) {
        streamErrored = true;
        // The agent's `streamText` wrapper re-throws stream errors
        // (node_modules/@convex-dev/agent/src/vercel/client/streamText.ts).
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
          if (!generationErrorRecordedFromOnError) {
            await recordGenerationErrorFromAction(ctx, {
              jobId,
              generationAttemptId,
              error: err,
            }).catch((recordErr) => {
              console.error("[chat] failed to record generation error", {
                jobId,
                threadId,
                err: errorToLogString(recordErr),
              });
            });
          }
          const patched = await patchLastAssistantAsFailed(
            ctx,
            threadId,
            promptMessageId,
            err,
            { model: capturedModelSlug, provider: "openrouter" },
          ).catch((patchErr) => {
            console.error("[chat] failed to patch assistant error", {
              jobId,
              threadId,
              err: errorToLogString(patchErr),
            });
            return false;
          });
          // startGeneration failed before a pending assistant could be
          // saved — persist a standalone one so the thread still shows
          // the error.
          if (!patched) {
            await saveStandaloneErrorMessage(
              ctx,
              threadId,
              promptMessageId,
              err,
              { model: capturedModelSlug, provider: "openrouter" },
            ).catch((saveErr) => {
              console.error("[chat] failed to save standalone chat error", {
                jobId,
                threadId,
                err: errorToLogString(saveErr),
              });
            });
          }
        }
      }

      if (streamReturned && !streamErrored && !streamAbortedByUser) {
        await ctx
          .runMutation(internal.chat.messages.clearGenerationError, {
            jobId,
            generationAttemptId,
          })
          .catch((err) => {
            console.error("[chat] failed to clear generation error", {
              jobId,
              threadId,
              err: errorToLogString(err),
            });
          });
      }

      // A user stop is handled here, awaited: AI SDK calls onAbort
      // fire-and-forget (stream-text.ts:1206), so onAbort only sets
      // streamAbortedByUser. The stop is billed below like any other
      // unfinished generation.
      if (streamAbortedByUser) {
        // (1) Persist the wire abort sentinel on the pending
        // assistant row so listThreadMessages's isAbortErrorString
        // detection enriches aborted:true and drops the error from
        // the UI page. Idempotent vs. the agent library's own
        // start.ts:170-178 listener — both paths write identical
        // values (same DOMException toString result).
        await persistAssistantAbortSentinel(
          ctx,
          threadId,
          promptMessageId,
        ).catch((err) => {
          console.error("[chat] failed to persist abort sentinel", {
            jobId,
            threadId,
            err: errorToLogString(err),
          });
        });
      }

      const unfinishedGeneration =
        capturedGenerationId && !completedGenerations.has(capturedGenerationId)
          ? capturedGenerationId
          : undefined;
      const cleanFinish = finished && !streamErrored && !streamAbortedByUser;
      if (unfinishedGeneration && !cleanFinish) {
        // Stopped or failed mid-step. The step's generation record says what
        // OpenRouter billed, including a response the provider finished
        // after the stop.
        await ctx.scheduler.runAfter(0, internal.chat.billing.settleFromOpenRouter, {
          userId,
          jobId,
          chargeId,
          generationId: unfinishedGeneration,
          extraUsd: completedUsd,
          earlierTokens: tokenCounts(aggregateUsage(stepUsages)),
          attempt: 0,
        });
        settledOrScheduled = true;
      } else if (completedTokens > 0) {
        const usd = completedUsd;
        await settleCredits(ctx, {
          userId,
          chargeId,
          credits: convertUsdToCredits({ usd }) || 1,
          usage: {
            kind: "chat",
            description: "Chat message",
            jobId,
            model: modelSlug,
            ...tokenDetails(aggregateUsage(stepUsages)),
            costUsd: usd,
          },
        });
        settledOrScheduled = true;
      }
    } catch (err) {
      // Genuine pre-stream failures only: credit guard, thread/model
      // lookup, provider construction. No pending assistant message
      // exists yet, so persist a standalone one inline.
      await recordGenerationErrorFromAction(ctx, {
        jobId,
        generationAttemptId,
        error: err,
      }).catch((recordErr) => {
        console.error("[chat] failed to record generation error", {
          jobId,
          threadId,
          err: errorToLogString(recordErr),
        });
      });
      await saveStandaloneErrorMessage(
        ctx,
        threadId,
        promptMessageId,
        err,
        capturedModelSlug
          ? { model: capturedModelSlug, provider: "openrouter" }
          : undefined,
      ).catch((saveErr) => {
        console.error("[chat] failed to save standalone chat error", {
          jobId,
          threadId,
          err: errorToLogString(saveErr),
        });
      });
      throw err;
    } finally {
      if (reserved && !settledOrScheduled) {
        await releaseCredits(ctx, { userId, chargeId }).catch((err) => {
          console.error("[chat] failed to release reserved credits", {
            chargeId,
            err: errorToLogString(err),
          });
        });
      }
      // Stop the poller BEFORE releasing the lock. releaseThreadLock
      // clears shouldAbort=undefined; if a poll tick raced past that
      // clear we could — in theory — spuriously abort the very next
      // turn (impossible under the current per-thread lock, but
      // defence in depth). See plan § 3 placement notes.
      await stopAbortPoller();
      await ctx.runMutation(internal.chat.concurrency.releaseThreadLock, {
        jobId,
        generationAttemptId,
      });
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
/**
 * Locate the pending-or-failed assistant message row for a given user
 * prompt. Shared lookup used by `patchLastAssistantAsFailed` (error
 * paths) and `persistAssistantAbortSentinel` (abort path); both want
 * the same row but write different patch payloads, so the lookup is
 * extracted while the two outer functions stay separate.
 *
 * Returns `null` if the prompt has no associated pending/failed
 * assistant row (e.g. pre-stream credit failure where the agent never
 * created one — callers fall back to `saveStandaloneErrorMessage`).
 */
async function findPendingAssistantForPrompt(
  ctx: ActionCtx,
  threadId: string,
  promptMessageId: string,
): Promise<{ _id: string } | null> {
  const promptMessages = await ctx.runQuery(
    components.agent.messages.getMessagesByIds,
    { messageIds: [promptMessageId as never] },
  );
  const promptOrder = promptMessages[0]?.order;
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 20, cursor: null },
    statuses: ["pending", "failed"],
  });
  return (
    page.find(
      (message) =>
        message.message?.role === "assistant" &&
        (promptOrder === undefined || message.order === promptOrder),
    ) ?? null
  );
}

async function patchLastAssistantAsFailed(
  ctx: ActionCtx,
  threadId: string,
  promptMessageId: string,
  rawError: unknown,
  metadata?: { model?: string; provider?: string },
): Promise<boolean> {
  const target = await findPendingAssistantForPrompt(
    ctx,
    threadId,
    promptMessageId,
  );
  if (!target) return false;
  const envelope = classifyChatError(rawError);
  const serialized = serializeChatError(envelope);
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId: target._id,
    patch: {
      status: "failed",
      error: serialized,
      ...(metadata?.model ? { model: metadata.model } : {}),
      ...(metadata?.provider ? { provider: metadata.provider } : {}),
    },
  });
  return true;
}

/**
 * Force-transition the newest pending/failed assistant message to
 * `status:"failed"` with the agent's wire abort sentinel as `error`.
 *
 * Why we need this: the agent library registers a fire-and-forget
 * abort listener in start.ts:170-178 that's supposed to call
 * `finalizeMessage` when our AbortController signals. But that
 * listener's `await fail()` is a dangling promise from the action's
 * perspective — Convex warns ("N unawaited operations") and may not
 * run it. Observed live (jobId k576p992sf7kq812yta72kqh2x85jamf):
 * pending assistant stuck at status="pending" with empty content
 * five minutes after abort, accumulated 2221 chars in stream deltas
 * but the message row never finalized. UI then renders an error
 * alert instead of the stopped pill because listThreadMessages's
 * isAbortErrorString detection has nothing to fire on.
 *
 * Writes the literal `ABORT_ERROR_STRING` (not a serialized envelope)
 * because that's what listThreadMessages's `isAbortErrorString(error)`
 * detection looks for to set `aborted: true` and drop the error from
 * the UI page. Idempotent under the agent listener winning the race —
 * we call `abortController.abort(ABORT_ERROR_STRING)` so
 * `abortSignal.reason` is already the wire string, and the agent's
 * `reason?.toString()` returns the string itself. Duplicate patches
 * write identical values.
 */
async function persistAssistantAbortSentinel(
  ctx: ActionCtx,
  threadId: string,
  promptMessageId: string,
): Promise<boolean> {
  const target = await findPendingAssistantForPrompt(
    ctx,
    threadId,
    promptMessageId,
  );
  if (!target) return false;
  // Use finalizeMessage, NOT updateMessage. finalizeMessage detects
  // empty message content and consolidates the stream deltas into it
  // BEFORE marking failed (component/messages.ts:388-405 →
  // getStreamingMessagesWithMetadata → addMessagesHandler with
  // pendingMessageId, which db.replace's the pending row with the
  // delta-derived content + our { status: failed, error } metadata).
  // updateMessage would flip status to failed first and lock in the
  // empty content because finalizeMessage early-returns when status
  // is no longer "pending" (component/messages.ts:380-385). Idempotent
  // vs. the agent library's own listener: whichever fires second
  // sees status !== pending and no-ops.
  await ctx.runMutation(components.agent.messages.finalizeMessage, {
    messageId: target._id as never,
    result: { status: "failed", error: ABORT_ERROR_STRING },
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
  promptMessageId: string,
  rawError: unknown,
  metadata?: { model?: string; provider?: string },
) {
  const envelope = classifyChatError(rawError);
  const serialized = serializeChatError(envelope);
  await paperChat.saveMessage(ctx, {
    threadId,
    promptMessageId,
    message: { role: "assistant", content: "" },
    metadata: {
      status: "failed",
      error: serialized,
      ...(metadata?.model ? { model: metadata.model } : {}),
      ...(metadata?.provider ? { provider: metadata.provider } : {}),
    },
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

type ThreadMessagePage = Awaited<ReturnType<typeof listMessages>>;
type RecentThreadMessagesPage = Awaited<
  ReturnType<typeof paperChat.listMessages>
>;
type ListThreadMessagesStreamArgs = {
  kind: "list";
  startOrder?: number;
};

type ThreadUIMessage = ReturnType<typeof toUIMessages>[number] & {
  error?: string;
  aborted?: boolean;
  model?: string;
  provider?: string;
};

type ThreadMessageModelMetadata = {
  model?: string;
  provider?: string;
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

function rawMessageRole(message: ThreadMessagePage["page"][number]) {
  return message.message?.role;
}

function isAssistantLikeRawMessage(message: ThreadMessagePage["page"][number]) {
  const role = rawMessageRole(message);
  return role === "assistant" || role === "tool";
}

function buildThreadMessageErrorIndexes(
  rawMessages: ThreadMessagePage["page"],
) {
  const errorById = new Map<string, string>();
  const modelById = new Map<string, ThreadMessageModelMetadata>();
  const sortedRawMessages = [...rawMessages].sort(
    (a, b) => a.order - b.order || a.stepOrder - b.stepOrder,
  );

  for (const message of sortedRawMessages) {
    if (message.error) errorById.set(message._id, message.error);
    if (message.model || message.provider) {
      modelById.set(message._id, {
        ...(message.model ? { model: message.model } : {}),
        ...(message.provider ? { provider: message.provider } : {}),
      });
    }
  }

  return { errorById, modelById, sortedRawMessages };
}

function assistantGroupErrorForUIMessage(
  message: ThreadUIMessage,
  uiMessages: ThreadUIMessage[],
  rawMessages: ThreadMessagePage["page"],
) {
  if (message.role !== "assistant") return undefined;
  if (typeof message.order !== "number") return undefined;
  if (typeof message.stepOrder !== "number") return undefined;

  // `toUIMessages` can collapse multiple assistant/tool rows into one UI row.
  // Use the next assistant UI row with the same order as the boundary so an
  // abort/error on a later sibling does not bleed into an unrelated message.
  const nextStepOrder = uiMessages
    .filter(
      (candidate) =>
        candidate !== message &&
        candidate.role === "assistant" &&
        candidate.order === message.order &&
        typeof candidate.stepOrder === "number" &&
        candidate.stepOrder > message.stepOrder,
    )
    .reduce<
      number | undefined
    >((next, candidate) => (next == null || candidate.stepOrder < next ? candidate.stepOrder : next), undefined);

  const errors = rawMessages
    .filter((raw) => {
      if (!raw.error) return false;
      if (!isAssistantLikeRawMessage(raw)) return false;
      if (raw.order !== message.order) return false;
      if (raw.stepOrder < message.stepOrder) return false;
      return nextStepOrder == null || raw.stepOrder < nextStepOrder;
    })
    .map((raw) => raw.error);

  return selectChatMessageError(errors);
}

function assistantGroupModelForUIMessage(
  message: ThreadUIMessage,
  uiMessages: ThreadUIMessage[],
  rawMessages: ThreadMessagePage["page"],
): ThreadMessageModelMetadata | undefined {
  if (message.role !== "assistant") return undefined;
  if (typeof message.order !== "number") return undefined;
  if (typeof message.stepOrder !== "number") return undefined;

  const nextStepOrder = uiMessages
    .filter(
      (candidate) =>
        candidate !== message &&
        candidate.role === "assistant" &&
        candidate.order === message.order &&
        typeof candidate.stepOrder === "number" &&
        candidate.stepOrder > message.stepOrder,
    )
    .reduce<
      number | undefined
    >((next, candidate) => (next == null || candidate.stepOrder < next ? candidate.stepOrder : next), undefined);

  const candidates = rawMessages.filter((raw) => {
    if (!isAssistantLikeRawMessage(raw)) return false;
    if (raw.order !== message.order) return false;
    if (raw.stepOrder < message.stepOrder) return false;
    return nextStepOrder == null || raw.stepOrder < nextStepOrder;
  });

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (candidate.model || candidate.provider) {
      return {
        ...(candidate.model ? { model: candidate.model } : {}),
        ...(candidate.provider ? { provider: candidate.provider } : {}),
      };
    }
  }
  return undefined;
}

function normalizeThreadUIMessages(
  rawMessages: ThreadMessagePage["page"],
  uiMessages: ThreadUIMessage[],
) {
  const { errorById, modelById, sortedRawMessages } =
    buildThreadMessageErrorIndexes(rawMessages);

  return uiMessages.map((message) => {
    const error = selectChatMessageError([
      errorById.get(message.id),
      assistantGroupErrorForUIMessage(message, uiMessages, sortedRawMessages),
    ]);
    const modelMetadata =
      modelById.get(message.id) ??
      assistantGroupModelForUIMessage(message, uiMessages, sortedRawMessages);
    return normalizeChatUIMessage({
      ...message,
      ...(error ? { error } : {}),
      ...(modelMetadata?.model ? { model: modelMetadata.model } : {}),
      ...(modelMetadata?.provider ? { provider: modelMetadata.provider } : {}),
    });
  });
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

const REGENERATE_ARTIFACT_PAGE_SIZE = 50;
const REGENERATE_ARTIFACT_MAX_PAGES = 10;

function describeRegenerateUnavailable(args: {
  messages: RecentThreadMessagesPage["page"];
  streams: ThreadStreamArtifact[];
}) {
  const highestMessageOrder = args.messages.reduce(
    (highest, message) => Math.max(highest, message.order),
    Number.NEGATIVE_INFINITY,
  );
  const highestStreamOrder = args.streams.reduce(
    (highest, stream) => Math.max(highest, stream.order),
    Number.NEGATIVE_INFINITY,
  );
  const highestOrder = Math.max(highestMessageOrder, highestStreamOrder);

  if (!Number.isFinite(highestOrder)) {
    return "Regenerate did not start because this thread has no persisted chat messages or stream artifacts.";
  }

  const roles = args.messages
    .filter((message) => message.order === highestOrder)
    .map((message) => `${message.message?.role ?? "unknown"}:${message.status}`)
    .join(", ");
  const streamCount = args.streams.filter(
    (stream) => stream.order === highestOrder,
  ).length;
  const artifactSummary = [
    roles.length > 0 ? `messages=[${roles}]` : "messages=[]",
    `streams=${streamCount}`,
  ].join(", ");

  return `Regenerate did not start because the latest persisted turn at order ${highestOrder} has no assistant message or stream artifact to replace (${artifactSummary}). The previous generation did not persist a recoverable assistant artifact for that turn.`;
}

async function listRecentThreadArtifacts(
  ctx: MutationCtx,
  threadId: string,
): Promise<{
  messages: RecentThreadMessagesPage["page"];
  streams: ThreadStreamArtifact[];
}> {
  const streams = await ctx.runQuery(components.agent.streams.list, {
    threadId,
    statuses: ["streaming", "finished", "aborted"],
  });
  const messages: RecentThreadMessagesPage["page"] = [];
  let cursor: string | null = null;
  for (
    let pageIndex = 0;
    pageIndex < REGENERATE_ARTIFACT_MAX_PAGES;
    pageIndex++
  ) {
    const page = await paperChat.listMessages(ctx, {
      threadId,
      paginationOpts: {
        numItems: REGENERATE_ARTIFACT_PAGE_SIZE,
        cursor,
      },
    });
    messages.push(...page.page);
    if (resolveLatestAssistantTurn({ messages, streams })) break;
    if (page.isDone) break;
    if (!page.continueCursor || page.continueCursor === cursor) break;
    cursor = page.continueCursor;
  }
  return { messages, streams };
}

async function deleteStreamArtifacts(ctx: MutationCtx, streamIds: string[]) {
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
    ...paginationResultValidator(v.any()).fields,
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
      page: toUIMessages(rawPage.page) as ThreadUIMessage[],
    };
    // `toUIMessages` drops the `error` field during the doc→UI
    // conversion and may collapse assistant/tool siblings into one UI
    // message. Attach the relevant raw error back to each UI row so the
    // client can classify and render without a second query.
    // Aborted messages are a special case: the library can persist either
    // the direct abort sentinel or its "Trying to update a message that
    // failed" wrapper when a late stream save races the abort. Both are
    // stop states, not errors; translate them into a clean `aborted: true`
    // boolean so the client renders the stopped pill.
    const page = normalizeThreadUIMessages(rawPage.page, paginated.page);
    return { ...paginated, page, streams };
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                  Regenerate / Clear / Swap model                   */
/* ────────────────────────────────────────────────────────────────── */

export const regenerateLastAssistant = mutation({
  args: { threadId: v.string() },
  returns: v.object({
    started: v.boolean(),
    generationAttemptId: v.optional(v.string()),
    error: v.optional(chatGenerationJobErrorValidator),
  }),
  handler: async (ctx, { threadId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "Wait for the current response before regenerating.",
      );
    }

    const { messages, streams } = await listRecentThreadArtifacts(
      ctx,
      threadId,
    );
    const latestTurn = resolveLatestAssistantTurn({ messages, streams });
    if (!latestTurn) {
      return {
        started: false,
        error: regenerateUnavailableError(
          job.error,
          describeRegenerateUnavailable({ messages, streams }),
        ),
      };
    }
    await assertChatConcurrencyAvailable(ctx, job.userId);

    await purgeAssistantTurnArtifacts(ctx, {
      assistantMessageIds: latestTurn.assistantMessageIds,
      streamIds: latestTurn.streamIds,
    });

    const now = Date.now();
    const generationAttemptId = newChatGenerationAttemptId(now);
    await ctx.db.patch(job._id, {
      isGenerating: true,
      generatingStartedAt: now,
      chatGenerationAttemptId: generationAttemptId,
      error: undefined,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.chat.messages.generateResponse, {
      threadId,
      promptMessageId: latestTurn.promptMessageId,
      generationAttemptId,
      chatModelId: job.chatModelId ?? null,
      chatEffort: await liveChatEffort(ctx, job),
    });
    return { started: true, generationAttemptId };
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
      chatGenerationAttemptId: undefined,
      shouldAbort: undefined,
      messageCount: 0,
      lastMessageAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Switch the chat's model. A preset shortcut passes its effort; otherwise the model runs at its default. */
export const swapModel = mutation({
  args: {
    threadId: v.string(),
    modelId: v.id("models"),
    effort: v.optional(effortValidator),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, modelId, effort }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    const model = await requireAvailableModel(ctx, modelId);
    requireEffort(model, effort);
    requireTaskModel(model, "chat");
    await ctx.db.patch(job._id, { chatModelId: modelId, chatEffort: effort, updatedAt: Date.now() });
    return null;
  },
});

/** Set the chat's reasoning effort; it applies from the next message. */
export const setChatEffort = mutation({
  args: { threadId: v.string(), effort: effortValidator },
  returns: v.null(),
  handler: async (ctx, { threadId, effort }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (!job.chatModelId) throw createError("VALIDATION_ERROR", "Pick a model for this chat first.");
    requireEffort(await requireAvailableModel(ctx, job.chatModelId), effort);
    await ctx.db.patch(job._id, { chatEffort: effort, updatedAt: Date.now() });
    return null;
  },
});

export const setChatWebSearchEnabled = mutation({
  args: {
    threadId: v.string(),
    enabled: v.boolean(),
  },
  returns: v.object({
    outcome: v.union(v.literal("updated"), v.literal("noop")),
  }),
  handler: async (ctx, { threadId, enabled }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if ((job.webSearchEnabled ?? false) === enabled) {
      return { outcome: "noop" as const };
    }
    await ctx.db.patch(job._id, {
      webSearchEnabled: enabled,
      updatedAt: Date.now(),
    });
    return { outcome: "updated" as const };
  },
});

/* ────────────────────────────────────────────────────────────────── */
/*                          Mid-stream abort                          */
/* ────────────────────────────────────────────────────────────────── */

export const abortGeneration = mutation({
  args: {
    threadId: v.string(),
    generationAttemptId: v.string(),
  },
  returns: v.object({ stopped: v.boolean() }),
  handler: async (ctx, { threadId, generationAttemptId }) => {
    const { job } = await authorizeThreadAccess(ctx, threadId);
    if (!job.isGenerating) return { stopped: false };
    if (job.chatGenerationAttemptId !== generationAttemptId) {
      return { stopped: false };
    }
    await ctx.db.patch(job._id, {
      shouldAbort: true,
      updatedAt: Date.now(),
    });
    return { stopped: true };
  },
});

export const shouldAbortInternal = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    generationAttemptId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { jobId, generationAttemptId }) => {
    const job = await ctx.db.get(jobId);
    // A generation whose lock was released or taken by another attempt stops.
    if (
      generationAttemptId !== undefined &&
      job?.chatGenerationAttemptId !== generationAttemptId
    ) {
      return true;
    }
    return job?.shouldAbort === true;
  },
});
