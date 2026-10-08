/**
 * The actions that write for an assistant chat, under its one-reply lock (./replies.ts):
 *
 *   reply     answers the message that was sent, through runTurn (./turn.ts), with the assistant's tools (./tools.ts)
 *   compact   after a reply that read a lot, summarizes the chat so far (./context.ts)
 *
 * They are apart from ./replies.ts because the tools load the action registry, which lists
 * that file's own actions.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { effortValidator } from "../aiModelConfig/validators";
import { refreshAccount } from "../billing/accounts";
import { CALL_TOKENS, estimateCredits, type Pricing } from "../../lib/pricing";
import { errorToLogString } from "../lib/errors";
import { internalAction } from "../lib/functions";
import { ABORT_ERROR_STRING } from "../../lib/ai/abort-signal";
import { assistant } from "./agent";
import { COMPACT_AT_TOKENS, compactedOf, contextSince, summarize } from "./context";
import { lockArgs, turnArgs, usedValidator } from "./replies";
import { CIRCLING, MAX_FAILED_ROUNDS, TOO_MANY_FAILED, askedSteps, circling, toolsFor } from "./tools";
import { RECENT_REQUESTS } from "./validators";
import { runTurn } from "./turn";
import type { ChatErrorEnvelope } from "../../lib/errors/taxonomy";

/**
 * A request that fails before it writes anything is made again rather than ending the reply, up to twice in a row.
 * A failure that passes waits first: what the provider asked for, or a few seconds. A request that sent a paper's
 * PDF by its address and was refused, whatever the provider said, is made again at once with the PDFs downloaded
 * here (./files.ts `withFiles`): some publishers turn away a model provider's fetcher and serve us.
 */
const MAX_RETRIES = 2;
const RETRY_WAIT_MS = [2_000, 10_000];
const MAX_RETRY_WAIT_MS = 60_000;
const PASSING = new Set<ChatErrorEnvelope["class"]>(["rate_limit", "model_unavailable", "network", "provider_5xx"]);

export const reply = internalAction({
  args: {
    ...lockArgs,
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    senderId: v.id("users"),
    modelId: v.union(v.id("models"), v.null()),
    effort: v.optional(effortValidator),
    // Where the reply stands after its requests before this one.
    used: v.optional(usedValidator),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, agentThreadId, promptMessageId, senderId, modelId, effort, used = { credits: 0, rounds: 0, calls: 0 } }) => {
    const lock = { threadId, attemptId };
    const state = () => ctx.runQuery(internal.assistant.replies.lockState, lock);
    // Ends a reply stopped before the model is called: no credits are held, and the chat shows a stopped reply.
    const stopHere = async () => {
      await assistant.saveMessage(ctx, {
        threadId: agentThreadId,
        promptMessageId,
        message: { role: "assistant", content: "" },
        metadata: { status: "failed", error: ABORT_ERROR_STRING },
        skipEmbeddings: true,
      });
      await ctx.runMutation(internal.assistant.replies.release, lock);
      return null;
    };
    const atStart = await state();
    // A reply whose chat was deleted, or whose lock is another reply's, never starts.
    if (atStart === "gone") return null;
    if (atStart === "stop") return stopHere();
    // How much history the reply's request read, which decides whether a compaction follows it.
    let history = { messages: 0, bytes: 0 };
    // Whether the request sends a paper's PDF by its address.
    let linked = false;
    const turn = { agentThreadId, senderId, modelId, effort };
    const shouldStop = async () => (await state()) !== "writing";
    let read = await compactedOf(ctx, threadId);
    // A compaction that was due and didn't finish is written now, before the request reads the conversation:
    // the exchanges before this one, where the summary doesn't run through them already. What the reply has
    // written of its own exchange is summarized as it goes (./replies.ts).
    if (read.owed && read.answering && (read.compactedThrough ?? -1) < read.answering - 1) {
      try {
        const through = read.answering - 1;
        const { summary, credits } = await summarize(ctx, { ...read, ...turn, through, lastInputTokens: COMPACT_AT_TOKENS, chargeId: `chat:${attemptId}:before:${used.rounds}:summary`, shouldStop });
        // What it cost counts towards what the reply has spent, written or not.
        used = { ...used, credits: used.credits + credits };
        if (!summary) throw new Error("The model wrote an empty summary.");
        await ctx.runMutation(internal.assistant.replies.summarized, { ...lock, summary, through });
        read = { ...read, summary, compactedThrough: through, owed: false };
      } catch (error) {
        // Still owed. The reply goes ahead if the conversation can be read whole, and fails saying so if it can't.
        console.error("[assistant] owed compaction failed", { threadId, error: errorToLogString(error) });
      }
    }
    // What this request holds, on the model it runs on: the most a request costs, or what the person
    // has when that's less, down to the least a reply starts on. It settles to what it cost, and the
    // next request holds again, so what a reply may cost in all is the person's credits and nothing else.
    let balance = (await ctx.runQuery(internal.billing.accounts.forUser, { userId: senderId }))?.balance;
    const cap = async (pricing: Pricing) => {
      const most = estimateCredits(pricing, CALL_TOKENS.chatRequest);
      // The account's copy of the balance can be behind a top-up. When it says the request can't hold the most, it's read again from Autumn.
      if (balance !== undefined && balance < most) balance = (await refreshAccount(ctx, senderId).catch(() => null))?.balance ?? balance;
      // A reply that is under way holds whatever the person has left: its first request settled to what
      // it cost, and the least a reply starts on, asked for again, could stop one the balance still covers.
      const least = used.rounds === 0 ? estimateCredits(pricing, CALL_TOKENS.chatMessage) : 1;
      return Math.max(least, Math.min(most, balance ?? most));
    };
    // A reply makes as many requests as its work takes. One whose actions have all failed, request
    // after request, or whose requests keep doing the same thing to the same end, is going round in
    // circles: this request is its answer, and its actions are refused with the reason, so it says so.
    // The model is told first: its actions are refused with the reason, and most answer there. One that
    // calls an action again gets a request that is its answer, which ends the reply whatever it calls.
    const why = used.told ?? ((used.failed ?? 0) >= MAX_FAILED_ROUNDS ? TOO_MANY_FAILED : circling(used.recent ?? []) ? CIRCLING : null);
    const answer = used.told !== undefined;
    const stopped = () => why;
    // Each action it runs is kept as a step of the exchange it's answering.
    const { tools, approval, resume, planned, made, changes, digest, held } = toolsFor(ctx, { userId: senderId, threadId, order: read.answering ?? 0, attemptId, stopped, halted: shouldStop, made: used.calls, changed: used.changes });
    // A reply that waited for an answer carries on here: what the person allowed runs first,
    // and each result is written where the model's call left off. A Stop ends it between two.
    const allowed = await ctx.runQuery(internal.assistant.steps.allowed, { threadId });
    for (const waiting of allowed) {
      if (!(await resume(waiting))) break;
    }
    if (allowed.length) {
      const now = await state();
      if (now === "gone") return null;
      // What didn't run is declined as the chat is released (./steps.ts).
      if (now === "stop") return stopHere();
    }
    // The calls made before this request, which ran what the person allowed: one that runs a call of its own and fails isn't made again, or the call would run twice.
    const callsBefore = made();
    await runTurn(ctx, {
      agent: assistant,
      feature: "assistant",
      threadId: agentThreadId,
      promptMessageId,
      userId: senderId,
      modelId,
      effort,
      // Each request holds and settles its own credits.
      attemptId: `${attemptId}:${used.rounds}`,
      replyId: attemptId,
      credits: cap,
      lesser: async () => (await refreshAccount(ctx, senderId).catch(() => null))?.balance,
      tools,
      approval,
      answer,
      log: { assistantThreadId: threadId },
      shouldStop,
      // People come back to a chat after a pause, so its cache is kept for an hour.
      cache: "1h",
      contextHandler: contextSince({
        summary: read.summary,
        compactedThrough: read.compactedThrough,
        agentThreadId,
        promptMessageId,
        modelId,
        onHistory: (read) => {
          history = read;
        },
        papers: {
          ...(used.download ? { download: true } : {}),
          linked: () => {
            linked = true;
          },
        },
      }),
      retry: (failure) => made() === callsBefore && (used.retries ?? 0) < MAX_RETRIES && (PASSING.has(failure.class) || (linked && !used.download && failure.class !== "insufficient_credits")),
      release: ({ lastInputTokens, asked, credits, requests, more, failed, retry }) => {
        const calls = askedSteps(asked, held, planned);
        const changed = changes();
        const now = {
          spent: used.credits + credits,
          rounds: used.rounds + requests,
          made: made(),
          ...(Object.keys(changed).length ? { changes: changed } : {}),
          ...(used.cap === undefined ? {} : { cap: used.cap }),
          ...(used.lap === undefined ? {} : { lap: used.lap }),
        };
        const did = digest();
        const recent = [...(used.recent ?? []), ...(did ? [did] : [])].slice(-RECENT_REQUESTS);
        return ctx.runMutation(internal.assistant.replies.release, {
          ...lock,
          // A request that failed before the model answered read nothing: what the one before it read still says how long the conversation is.
          ended: { ...turn, ...history, lastInputTokens: lastInputTokens || (used.tokens ?? 0) },
          spent: now.spent,
          // It makes the request that failed again, or waits for the person's answer, or goes on to its next request, or has ended.
          // A request that was the reply's answer ends it, whatever the model called in it.
          ...(retry
            ? {
                next: {
                  promptMessageId,
                  ...now,
                  tokens: used.tokens ?? 0,
                  failed: used.failed ?? 0,
                  recent: used.recent ?? [],
                  ...(used.told ? { told: used.told } : {}),
                  retries: (used.retries ?? 0) + 1,
                  ...(used.download || !PASSING.has(retry.class) ? { download: true as const } : {}),
                  wait: PASSING.has(retry.class) ? Math.min(retry.retryAfterMs ?? RETRY_WAIT_MS[used.retries ?? 0], MAX_RETRY_WAIT_MS) : 0,
                },
              }
            : calls.length
            ? // A request that asks ran nothing, so the streak of failed ones stands as it was.
              { asking: { promptMessageId, calls, ...now, failed: used.failed ?? 0, recent } }
            : more && !answer
              ?               { next: { promptMessageId, ...now, tokens: lastInputTokens, failed: failed ? (used.failed ?? 0) + 1 : 0, recent, ...(why ? { told: why } : {}), ...(used.download ? { download: true as const } : {}) } }
              : {}),
        });
      },
    });
    return null;
  },
});

/**
 * Summarizes the chat through the reply that just ended, under that reply's lock, so the
 * chat takes no message until its next request can start from the summary. A failed or
 * stopped compaction leaves the chat as it was; the next reply that reads a lot tries again.
 *
 * With `resume`, the reply hasn't ended: once the summary is written it goes on from it in
 * an exchange of its own (./replies.ts), or as it was if the summary isn't written.
 */
export const compact = internalAction({
  args: {
    ...lockArgs,
    ...turnArgs,
    through: v.number(),
    lastInputTokens: v.number(),
    resume: v.optional(v.object({ ...turnArgs, promptMessageId: v.string(), used: usedValidator })),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, through, resume, ...turn }) => {
    const lock = { threadId, attemptId };
    let written: { summary: string; credits: number } | undefined;
    const shouldStop = async () => (await ctx.runQuery(internal.assistant.replies.lockState, lock)) !== "writing";
    try {
      if (!(await shouldStop())) {
        // A reply can be summarized more than once as it goes, and one that couldn't be written is tried again after its next request: each try is a charge of its own.
        written = await summarize(ctx, { ...(await compactedOf(ctx, threadId)), ...turn, through, midReply: resume !== undefined, chargeId: `chat:${attemptId}:through:${through}:${resume?.used.rounds ?? "end"}:summary`, shouldStop });
      }
    } catch (error) {
      console.error("[assistant] compaction failed", { threadId, error: errorToLogString(error) });
    }
    if (written && !written.summary) console.error("[assistant] compaction failed", { threadId, error: "The model wrote an empty summary." });
    // One made while the reply is under way counts towards what the reply has spent, whether or not it was written.
    const from = resume && written ? { ...resume, used: { ...resume.used, credits: resume.used.credits + written.credits } } : resume;
    await ctx.runMutation(internal.assistant.replies.release, { ...lock, ...(written?.summary ? { summarized: { summary: written.summary, through } } : {}), ...(from ? { resume: from } : {}) });
    return null;
  },
});

