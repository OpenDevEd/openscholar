/**
 * One reply, from the credit hold to the released lock. The paper chat
 * (convex/chat/messages.ts) and the assistant (./replies.ts) both run their replies
 * through `runTurn`, so a stop, a provider error and a bill behave the same in both.
 *
 *   hold the credits (throws AI_INSUFFICIENT_CREDITS)
 *   resolve the model through OpenRouter
 *   agent.streamText with saveStreamDeltas
 *   settle the credits, from the steps' usage or OpenRouter's generation record
 *   release the lock, always
 */
import { listMessages, type Agent, type ContextHandler, type ContextOptions } from "@convex-dev/agent";
import { isStepCount, type ToolSet } from "ai";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { releaseCredits, reserveCredits, settleCredits, tokenCounts, tokenDetails } from "../billing/charge";
import { LEASE_RENEW_MS } from "../chat/concurrency";
import { resolveOpenRouterModel } from "../chat/provider";
import { createError, errorToLogString } from "../lib/errors";
import { callOptions, type Effort } from "../../lib/ai/core/call-options";
import { aggregateUsage, calculateCostInDollars, usageOf } from "../../lib/ai/core/cost";
import type { Usage } from "../../lib/ai/core/types";
import { startAbortPoller } from "../../lib/chat/abort-poller";
import { ABORT_ERROR_STRING, isAbortLike } from "../../lib/chat/abort-signal";
import { pickProviderCostUsd } from "../../lib/chat/pick-provider-cost";
import { classifyChatError, serializeChatError } from "../../lib/errors/taxonomy";
import { convertUsdToCredits } from "../../lib/pricing";

export const STOP_ABORT_POLL_INTERVAL_MS = 500;

export type Turn = {
  agent: Agent;
  /** The agent component's thread. */
  threadId: string;
  promptMessageId: string;
  /** Who the reply runs as: their credits pay for it. */
  userId: Id<"users">;
  /** Null runs the server's default model. */
  modelId: Id<"models"> | null;
  effort?: Effort;
  /** Names this run of the reply. Its credits are held under it. */
  attemptId?: string;
  /** Credits held before the reply starts. */
  credits: number;
  tools?: ToolSet;
  /** Requests to the model one reply may make while it uses its tools. */
  maxSteps?: number;
  /** The paper chat the reply is in, which its charge is recorded under. */
  jobId?: Id<"extractionJobs">;
  /** IDs for the log lines. */
  log: Record<string, unknown>;
  /** Read every STOP_ABORT_POLL_INTERVAL_MS while the reply streams; true stops it. */
  shouldStop: () => Promise<boolean>;
  /** Called every LEASE_RENEW_MS, where a lock is one that has to be renewed. */
  renewLease?: () => Promise<unknown>;
  /**
   * Releases the reply's lock. Runs whether the reply finished, failed or was stopped, with
   * the input tokens the provider reported for the reply's last request (0 when none finished).
   */
  release: (outcome: { lastInputTokens: number }) => Promise<unknown>;
  /** What the model is sent, in place of the agent's own choice of recent messages. */
  contextHandler?: ContextHandler;
  contextOptions?: ContextOptions;
  /** How long Claude keeps the conversation cached: five minutes, or an hour (`"1h"`) at a dearer write. */
  cache?: "1h";
  /** Keeps a failure where the caller shows it, besides the failed message. A stop isn't one. */
  recordError?: (error: unknown) => Promise<unknown>;
  clearError?: () => Promise<unknown>;
};

export async function runTurn(ctx: ActionCtx, turn: Turn): Promise<void> {
  const { agent, threadId, promptMessageId, userId, log } = turn;
  const recordError = async (error: unknown) => {
    if (!turn.recordError || classifyChatError(error).class === "aborted") return;
    await turn.recordError(error);
  };

  // After Stop, a cancellation error is the stop arriving, not a failure: this runtime ends
  // the provider's request with an error of its own ("The signal has been aborted")
  // instead of an aborted stream, most often before the first token. Any other error, such
  // as a rate limit that landed as Stop was pressed, is still the failure it is.
  const isStop = (error: unknown) =>
    abortController.signal.aborted && (isAbortLike(error) || /abort/i.test(error instanceof Error ? error.message : String(error)));

  // Abort wiring (plans/chat-stop-streaming/01-action-abort-wiring.md).
  // Poll the stop flag every 500ms; when flipped, abort the signal
  // we pass into agent.streamText, which cascades through the
  // library's DeltaStreamer → AI SDK streamText → OpenRouter fetch.
  const abortController = new AbortController();
  // The poller also renews this generation's lock, so a long reply isn't
  // taken for one that died (convex/chat/concurrency.ts).
  let leaseRenewedAt = Date.now();
  const stopAbortPoller = startAbortPoller({
    readFlag: async () => {
      if (turn.renewLease && Date.now() - leaseRenewedAt >= LEASE_RENEW_MS) {
        leaseRenewedAt = Date.now();
        await turn.renewLease();
      }
      return await turn.shouldStop();
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
  const chargeId = `chat:${turn.attemptId ?? crypto.randomUUID()}`;
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
    if (!(await reserveCredits(ctx, { userId, chargeId, credits: turn.credits }))) {
      const account = await ctx.runQuery(internal.billing.accounts.forUser, { userId });
      const availableCredits = account?.balance ?? 0;
      throw createError(
        "AI_INSUFFICIENT_CREDITS",
        "Not enough credits for this chat message.",
        {
          requiredCredits: turn.credits,
          availableCredits,
          deficitCredits: Math.max(0, turn.credits - availableCredits),
        },
      );
    }
    reserved = true;

    const { model, modelSlug, pricing } = await resolveOpenRouterModel(
      ctx,
      turn.modelId,
      {
        generationIdSink: (id) => {
          capturedGenerationId = id;
        },
      },
    );
    capturedModelSlug = modelSlug;

    try {
      await agent.streamText(
        ctx,
        { threadId, userId },
        {
          promptMessageId,
          model,
          // Context is assembled from trusted server-owned system messages.
          allowSystemInMessages: true,
          abortSignal: abortController.signal,
          // A reply with tools takes a step for each round of calls, up to its limit. The last
          // step it's allowed is for its answer: it can't call a tool there, so it never ends
          // on actions it hasn't told the person about. It's also made to answer once its
          // requests have cost what was held for it, so a reply spends at most one request past its hold.
          ...(turn.tools
            ? {
                tools: turn.tools,
                stopWhen: isStepCount(turn.maxSteps ?? 1),
                prepareStep: ({ stepNumber }: { stepNumber: number }) =>
                  (turn.maxSteps && stepNumber >= turn.maxSteps - 1) || (convertUsdToCredits({ usd: completedUsd }) || 0) >= turn.credits ? { toolChoice: "none" as const } : undefined,
              }
            : {}),
          // Retries serve no user when the stream is live — the user
          // is watching and would prefer a fast failure or a clean
          // abort over a ~2s wait for a retry that mid-stream can't
          // salvage anyway.
          maxRetries: 0,
          // Claude caches the context and earlier turns; the thread id keeps
          // every turn on the same upstream host so that cache stays warm.
          providerOptions: callOptions(model, { cache: turn.cache ?? true, sessionId: threadId, effort: turn.effort }),
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
              ...log,
              threadId,
              stepCount: steps.length,
            });
          },
          onError: async ({ error }) => {
            if (isStop(error)) {
              streamAbortedByUser = true;
              return;
            }
            streamErrored = true;
            // This runs with the ORIGINAL provider error (429 w/
            // retry-after, etc.) but only if the agent's own
            // `call.fail` → `finalizeMessage` path did not throw.
            // When finalizeMessage DOES throw (stream-had-error-
            // chunks case), this never runs and we fall back to the
            // inner catch below.
            await recordError(error)
              .then(() => {
                generationErrorRecordedFromOnError = true;
              })
              .catch((err) => {
                console.error("[chat] failed to record generation error", {
                  ...log,
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
        {
          saveStreamDeltas: { chunking: "word", throttleMs: 250 },
          ...(turn.contextHandler ? { contextHandler: turn.contextHandler } : {}),
          ...(turn.contextOptions ? { contextOptions: turn.contextOptions } : {}),
        },
      );
      streamReturned = true;
    } catch (err) {
      // A cancellation after Stop is the stop arriving (see isStop), handled below with every other stop.
      const stopped = isStop(err);
      if (stopped) streamAbortedByUser = true;
      else streamErrored = true;
      // The agent's `streamText` wrapper re-throws stream errors
      // (node_modules/@convex-dev/agent/src/vercel/client/streamText.ts).
      // We land here for every stream-time failure — and sometimes
      // before onError got a chance, when the agent's call.fail
      // itself threw inside finalizeMessage. Force-transition the
      // stuck pending assistant to `failed` so the UI can render an
      // alert instead of an empty bubble.
      // NOTE: with a mock model, abort is not an error path: AI SDK swallows
      // AbortError and converts it to an {type:"abort"} stream chunk, and
      // agent.streamText returns normally. On the deployed runtime the
      // provider's request can reject instead, which lands here.
      if (!stopped && !envelopePatchedFromOnError) {
        if (!generationErrorRecordedFromOnError) {
          await recordError(err).catch((recordErr) => {
            console.error("[chat] failed to record generation error", {
              ...log,
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
            ...log,
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
            agent,
            threadId,
            promptMessageId,
            err,
            { model: capturedModelSlug, provider: "openrouter" },
          ).catch((saveErr) => {
            console.error("[chat] failed to save standalone chat error", {
              ...log,
              threadId,
              err: errorToLogString(saveErr),
            });
          });
        }
      }
    }

    if (streamReturned && !streamErrored && !streamAbortedByUser && turn.clearError) {
      await turn.clearError().catch((err) => {
        console.error("[chat] failed to clear generation error", {
          ...log,
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
      // assistant row so the message list's isAbortErrorString
      // detection enriches aborted:true and drops the error from
      // the UI page. Idempotent vs. the agent library's own
      // start.ts:170-178 listener — both paths write identical
      // values (same DOMException toString result).
      const marked = await persistAssistantAbortSentinel(
        ctx,
        threadId,
        promptMessageId,
      ).catch((err) => {
        console.error("[chat] failed to persist abort sentinel", {
          ...log,
          threadId,
          err: errorToLogString(err),
        });
        return true;
      });
      // Stopped before the reply had a message of its own: it gets one, so the thread shows the stop.
      if (!marked) {
        await agent
          .saveMessage(ctx, {
            threadId,
            promptMessageId,
            message: { role: "assistant", content: "" },
            metadata: { status: "failed", error: ABORT_ERROR_STRING },
            skipEmbeddings: true,
          })
          .catch((err) => {
            console.error("[chat] failed to save a stopped reply", { ...log, threadId, err: errorToLogString(err) });
          });
      }
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
        ...(turn.jobId ? { jobId: turn.jobId } : {}),
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
          ...(turn.jobId ? { jobId: turn.jobId } : {}),
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
    await recordError(err).catch((recordErr) => {
      console.error("[chat] failed to record generation error", {
        ...log,
        threadId,
        err: errorToLogString(recordErr),
      });
    });
    await saveStandaloneErrorMessage(
      ctx,
      agent,
      threadId,
      promptMessageId,
      err,
      capturedModelSlug
        ? { model: capturedModelSlug, provider: "openrouter" }
        : undefined,
    ).catch((saveErr) => {
      console.error("[chat] failed to save standalone chat error", {
        ...log,
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
    // Stop the poller BEFORE releasing the lock. The release clears the
    // stop flag; if a poll tick raced past that clear we could — in
    // theory — spuriously abort the very next turn (impossible under the
    // current per-thread lock, but defence in depth). See plan § 3
    // placement notes.
    await stopAbortPoller();
    await turn.release({ lastInputTokens: stepUsages.at(-1)?.inputTokens ?? 0 });
  }
}

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
 * alert instead of the stopped pill because the message list's
 * isAbortErrorString detection has nothing to fire on.
 *
 * Writes the literal `ABORT_ERROR_STRING` (not a serialized envelope)
 * because that's what the message list's `isAbortErrorString(error)`
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
  await ctx
    .runMutation(components.agent.messages.finalizeMessage, {
      messageId: target._id as never,
      result: { status: "failed", error: ABORT_ERROR_STRING },
    })
    // It throws when the stream it replays holds an error chunk. The patch below still marks the row.
    .catch((err) => {
      console.error("[chat] failed to finalize a stopped reply", { threadId, err: errorToLogString(err) });
    });
  // A row the agent had already failed with the runtime's own abort error keeps that error
  // through finalizeMessage, so the sentinel is written over it.
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId: target._id,
    patch: { status: "failed", error: ABORT_ERROR_STRING },
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
  agent: Agent,
  threadId: string,
  promptMessageId: string,
  rawError: unknown,
  metadata?: { model?: string; provider?: string },
) {
  const envelope = classifyChatError(rawError);
  const serialized = serializeChatError(envelope);
  await agent.saveMessage(ctx, {
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
