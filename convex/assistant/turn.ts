/**
 * One assistant reply (./replies.ts), from the credit hold to the released lock.
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
import { resolveOpenRouterModel, type Pricing } from "../ai/provider";
import { createError, errorToLogString } from "../lib/errors";
import { callOptions, type Effort } from "../../lib/ai/core/call-options";
import { aggregateUsage, calculateCostInDollars, usageOf } from "../../lib/ai/core/cost";
import type { Usage } from "../../lib/ai/core/types";
import { startAbortPoller } from "../../lib/ai/abort-poller";
import { ABORT_ERROR_STRING, isAbortLike } from "../../lib/ai/abort-signal";
import { pickProviderCostUsd } from "../../lib/ai/pick-provider-cost";
import { classifyChatError, serializeChatError } from "../../lib/errors/taxonomy";
import { convertUsdToCredits } from "../../lib/pricing";

export const STOP_ABORT_POLL_INTERVAL_MS = 500;
/** How long a request waits for the model to start answering, reasoning included, and then between parts of its answer. */
const FIRST_CHUNK_MS = 120_000;
const CHUNK_MS = 90_000;
/** What a request those ended fails with: shown as the model service's error (lib/errors/taxonomy.ts). */
const STALLED = Object.assign(new Error("The model stopped answering."), { name: "TimeoutError" });

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
  /** The reply this request is part of, for its sender's record of what replies cost, when a charge is settled after it ended. */
  replyId?: string;
  /** Credits held before the reply starts, worked out at the price of the model it runs on (lib/pricing/estimate.ts). */
  credits: (pricing: Pricing) => number | Promise<number>;
  /** Asked when that hold is refused: what to hold in its place, when the person turns out to have less. */
  lesser?: () => Promise<number | undefined>;
  tools?: ToolSet;
  /** This request is the reply's answer: the model can't call a tool in it. */
  answer?: boolean;
  /** The reply's rule for asking the person before a tool call runs (the AI SDK's `toolApproval`). A call it asks about ends the reply there, unanswered. */
  approval?: (options: { toolCall: { toolCallId: string; toolName: string; input: unknown } }) => unknown;
  /** IDs for the log lines. */
  log: Record<string, unknown>;
  /** Read every STOP_ABORT_POLL_INTERVAL_MS while the reply streams; true stops it. */
  shouldStop: () => Promise<boolean>;
  /**
   * Releases the reply's lock. Runs whether the reply finished, failed or was stopped, with
   * the input tokens the provider reported for the reply's last request (0 when none finished).
   */
  release: (outcome: {
    lastInputTokens: number;
    /** The tool calls the reply ended on, which wait for the person's answer. */
    asked: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    /** What its requests cost, in credits, and how many it made. */
    credits: number;
    requests: number;
    /** It ended on tool calls that all ran: their results wait to go back to the model, in the reply's next request. */
    more: boolean;
    /** Every one of those calls failed: none did what it was called for. */
    failed: boolean;
  }) => Promise<unknown>;
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

  // Poll the stop flag every 500ms; when flipped, abort the signal
  // we pass into agent.streamText, which cascades through the
  // library's DeltaStreamer → AI SDK streamText → OpenRouter fetch.
  const abortController = new AbortController();
  const stopAbortPoller = startAbortPoller({
    readFlag: turn.shouldStop,
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
  // the provider's fetch wrapper (see convex/ai/openrouterFetch.ts).
  // The header lands on the initial HTTP response frame, so this ref
  // is populated even when the client aborts the stream mid-flight.
  // That is what lets stopped turns bill from OpenRouter's
  // /api/v1/generation record via chat/billing.ts settleFromOpenRouter.
  let capturedGenerationId: string | undefined;
  let capturedModelSlug: string | undefined;
  let streamErrored = false;
  // The stream ended without the person's Stop: its writer gave up on it, or the timeout ended it.
  let endedUnstopped = false;
  let streamAbortedByUser = false;
  let streamReturned = false;
  // Credits for this turn are held under chargeId until the turn settles.
  const chargeId = `chat:${turn.attemptId ?? crypto.randomUUID()}`;
  let reserved = false;
  let settledOrScheduled = false;
  /** What the request was charged, once it's settled here. */
  let charged: number | undefined;
  // A turn can take several model steps (tool calls). Each completed step
  // adds its cost; a step still running at a stop or error is billed from
  // its OpenRouter generation record.
  let completedUsd = 0;
  let completedTokens = 0;
  // The tool calls the reply asked the person about, which it ended on without running.
  const asked: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
  const stepUsages: Usage[] = [];
  // The request called tools, and every call has its result: they ran. A request cut short
  // by the provider, at its length or by a filter, can name a call that never runs.
  let ranTools = false;
  let allFailed = false;
  const completedGenerations = new Set<string>();
  let finished = false;

  try {
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

    const held = await turn.credits(pricing);
    // The account's copy of the balance can be behind a charge just made. A hold it led to that is refused is tried again at what the person really has.
    const lesser = async () => {
      const credits = await turn.lesser?.();
      return credits !== undefined && credits > 0 && credits < held && (await reserveCredits(ctx, { userId, chargeId, credits }));
    };
    if (!(await reserveCredits(ctx, { userId, chargeId, credits: held })) && !(await lesser())) {
      const account = await ctx.runQuery(internal.billing.accounts.forUser, { userId });
      const availableCredits = account?.balance ?? 0;
      throw createError(
        "AI_INSUFFICIENT_CREDITS",
        "Not enough credits for this chat message.",
        {
          requiredCredits: held,
          availableCredits,
          deficitCredits: Math.max(0, held - availableCredits),
        },
      );
    }
    reserved = true;

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
          // A reply with tools makes one request to the model here. The tools it calls run in
          // it, and their results go back to the model in the reply's next request, which is an
          // action of its own (./run.ts), as the durable agents of other runtimes take one
          // request a step. A reply is then as long as its work, and not as long as one
          // action may run. The request that has to be the reply's answer can't call a tool,
          // so a reply never ends on actions it hasn't told the person about. Only that one is
          // forced: taking the tools away voids the provider's cache of the conversation, and a
          // model that isn't told why can answer with nothing. Every other limit is the tools' own to refuse.
          ...(turn.tools
            ? { tools: turn.tools, ...(turn.approval ? { toolApproval: turn.approval as never } : {}), stopWhen: isStepCount(1), ...(turn.answer ? { toolChoice: "none" as const } : {}) }
            : {}),
          // Retries serve no user when the stream is live — the user
          // is watching and would prefer a fast failure or a clean
          // abort over a ~2s wait for a retry that mid-stream can't
          // salvage anyway.
          maxRetries: 0,
          // A provider that stops streaming leaves the person on "Thinking" for as long as the action may run: one
          // request sat for seven minutes. The request ends here instead, and fails (failStalledReply), so they can send again.
          timeout: { firstChunkMs: FIRST_CHUNK_MS, chunkMs: CHUNK_MS },
          // Claude caches the context and earlier turns; the thread id keeps
          // every turn on the same upstream host so that cache stays warm.
          providerOptions: callOptions(model, { cache: turn.cache ?? true, sessionId: threadId, effort: turn.effort }),
          onStepEnd: async ({ usage, providerMetadata, content }) => {
            for (const part of content) {
              if (part.type === "tool-approval-request" && !part.isAutomatic) asked.push({ toolCallId: part.toolCall.toolCallId, toolName: part.toolCall.toolName, input: part.toolCall.input });
            }
            const calls = content.filter((part) => part.type === "tool-call").length;
            const results = content.filter((part) => part.type === "tool-result" || part.type === "tool-error");
            ranTools = calls > 0 && results.length >= calls;
            // A tool tells the model why it failed in an `error` field of what it returns.
            allFailed = ranTools && results.every((part) => part.type === "tool-error" || (typeof part.output === "object" && part.output !== null && "error" in part.output));
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
            // A stream ends this way for a Stop, and also when the agent's own writer gives
            // up on it, as when part of a reply can't be saved. Only the first is the
            // person's doing. The second is a failure, which the agent has already marked
            // on the reply's message with its reason, and it must not show as a stop.
            if (abortController.signal.aborted) {
              streamAbortedByUser = true;
              console.info("[chat] stream aborted by user", { ...log, threadId, stepCount: steps.length });
            } else {
              streamErrored = true;
              // Or the timeout above ended it. Which one is told once the stream has returned (failStalledReply):
              // the SDK doesn't wait for what this callback starts.
              endedUnstopped = true;
              console.error("[chat] stream ended without a stop: by its writer, or by the timeout", { ...log, threadId, stepCount: steps.length });
            }
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
      // A reply the timeout ended is still pending: its text so far is kept, and it fails with the model service's error.
      if (endedUnstopped && (await failStalledReply(ctx, threadId, promptMessageId, { model: capturedModelSlug, provider: "openrouter" }).catch(() => false))) {
        console.error("[chat] the model stopped answering: the request timed out", { ...log, threadId });
        await recordError(STALLED).catch(() => {});
      }
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
      await ctx.scheduler.runAfter(0, internal.billing.openRouter.settleFromOpenRouter, {
        userId,
        chargeId,
        generationId: unfinishedGeneration,
        ...(turn.replyId ? { reply: turn.replyId } : {}),
        extraUsd: completedUsd,
        earlierTokens: tokenCounts(aggregateUsage(stepUsages)),
        attempt: 0,
      });
      settledOrScheduled = true;
    } else if (completedTokens > 0) {
      const usd = completedUsd;
      charged = convertUsdToCredits({ usd }) || 1;
      await settleCredits(ctx, {
        userId,
        chargeId,
        credits: charged,
        usage: {
          kind: "chat",
          description: "Chat message",
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
    // A reply that failed or was stopped keeps none of its last message, so nothing in it waits for an answer.
    await turn.release({
      lastInputTokens: stepUsages.at(-1)?.inputTokens ?? 0,
      asked: finished && !streamErrored && !streamAbortedByUser ? asked : [],
      // What it was charged, the least a request costs included. One stopped or failed partway is settled later, from what its finished steps cost.
      credits: charged ?? (convertUsdToCredits({ usd: completedUsd }) || 0),
      requests: stepUsages.length,
      more: finished && !streamErrored && !streamAbortedByUser && ranTools && asked.length === 0,
      failed: allFailed,
    });
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
  statuses: Array<"pending" | "failed"> = ["pending", "failed"],
): Promise<{ _id: string; status?: string; error?: string } | null> {
  const promptMessages = await ctx.runQuery(
    components.agent.messages.getMessagesByIds,
    { messageIds: [promptMessageId as never] },
  );
  const promptOrder = promptMessages[0]?.order;
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 20, cursor: null },
    statuses,
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
/** What the agent fails a reply with when its stream was aborted by anything but its own signal (@convex-dev/agent streamText). */
const AGENT_ABORTED = "streamText aborted";

/**
 * Fails a reply the stream timeout ended (`timeout` in runTurn) with the model service's error,
 * keeping what it had written: finalizeMessage consolidates its stream deltas into it first, as a
 * stopped reply's are (persistAssistantAbortSentinel). The agent has usually failed it already,
 * with its generic abort text. A reply its writer failed keeps the writer's own reason, and is
 * left as it is. Returns whether it failed one.
 */
async function failStalledReply(ctx: ActionCtx, threadId: string, promptMessageId: string, metadata: { model?: string; provider?: string }): Promise<boolean> {
  const target = await findPendingAssistantForPrompt(ctx, threadId, promptMessageId);
  if (!target || (target.status === "failed" && target.error !== AGENT_ABORTED)) return false;
  const error = serializeChatError(classifyChatError(STALLED));
  await ctx
    .runMutation(components.agent.messages.finalizeMessage, { messageId: target._id as never, result: { status: "failed", error } })
    .catch((err) => console.error("[chat] failed to finalize a reply that timed out", { threadId, err: errorToLogString(err) }));
  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId: target._id,
    patch: { status: "failed", error, ...(metadata.model ? { model: metadata.model } : {}), ...(metadata.provider ? { provider: metadata.provider } : {}) },
  });
  return true;
}

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
