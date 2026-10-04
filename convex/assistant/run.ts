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
import { ASSISTANT_REPLY_CREDITS, ESTIMATED_CREDITS_PER_CHAT_MESSAGE } from "../lib/constants";
import { errorToLogString } from "../lib/errors";
import { internalAction } from "../lib/functions";
import { ABORT_ERROR_STRING } from "../../lib/chat/abort-signal";
import { assistant } from "./agent";
import { COMPACT_AT_TOKENS, compactedOf, contextSince, summarize } from "./context";
import { lockArgs, turnArgs } from "./replies";
import { MAX_STEPS, OUT_OF_CREDITS, OUT_OF_STEPS, askedSteps, toolsFor } from "./tools";
import { runTurn } from "./turn";

export const reply = internalAction({
  args: {
    ...lockArgs,
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    senderId: v.id("users"),
    modelId: v.union(v.id("models"), v.null()),
    effort: v.optional(effortValidator),
    // What the reply has used of one reply's credits and rounds, and the actions it has called, in its requests
    // before this one, with the input tokens the last of them read.
    used: v.optional(v.object({ credits: v.number(), rounds: v.number(), calls: v.number(), tokens: v.optional(v.number()) })),
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
    const turn = { agentThreadId, senderId, modelId, effort };
    const shouldStop = async () => (await state()) !== "writing";
    let read = await compactedOf(ctx, threadId);
    // A compaction that was due and didn't finish is written now, before the request reads the conversation.
    if (read.owed && read.answering) {
      try {
        const through = read.answering - 1;
        const summary = await summarize(ctx, { ...read, ...turn, through, lastInputTokens: COMPACT_AT_TOKENS, chargeId: `chat:${attemptId}:${used.rounds}:summary`, shouldStop });
        await ctx.runMutation(internal.assistant.replies.summarized, { ...lock, summary, through });
        read = { ...read, summary, compactedThrough: through, owed: false };
      } catch (error) {
        // Still owed. The reply goes ahead if the conversation can be read whole, and fails saying so if it can't.
        console.error("[assistant] owed compaction failed", { threadId, error: errorToLogString(error) });
      }
    }
    // What the reply may cost: what's left of a reply's cap, or what the person has when
    // that's less, down to the least a reply starts on. It holds that much, so a small
    // balance, or a reply that has used its cap and only has to answer, still gets its answer.
    const left = Math.max(0, ASSISTANT_REPLY_CREDITS - used.credits);
    let balance = (await ctx.runQuery(internal.billing.accounts.forUser, { userId: senderId }))?.balance;
    // The account's copy of the balance can be behind a top-up. When it says the reply can't have all it may use, it's read again from Autumn.
    if (balance !== undefined && balance < left) balance = (await refreshAccount(ctx, senderId).catch(() => null))?.balance ?? balance;
    // A reply that is under way holds whatever the person has left: its first request settled to what
    // it cost, and the least a reply starts on, asked for again, could stop one the balance still covers.
    const least = used.rounds === 0 ? ESTIMATED_CREDITS_PER_CHAT_MESSAGE : 1;
    const cap = Math.max(least, Math.min(left, balance ?? left));
    // This action makes one of the reply's requests. Its actions stop a round before the reply's
    // last request, and once the reply has cost what one may, so the request after is its answer.
    const stopped = () => (used.rounds >= MAX_STEPS - 2 ? OUT_OF_STEPS : left <= 0 ? OUT_OF_CREDITS : null);
    // Each action it runs is kept as a step of the exchange it's answering.
    const { tools, approval, resume, made } = toolsFor(ctx, { userId: senderId, threadId, order: read.answering ?? 0, attemptId, stopped, made: used.calls });
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
    await runTurn(ctx, {
      agent: assistant,
      threadId: agentThreadId,
      promptMessageId,
      userId: senderId,
      modelId,
      effort,
      // Each request holds and settles its own credits.
      attemptId: `${attemptId}:${used.rounds}`,
      credits: cap,
      tools,
      approval,
      // The last request one reply may make is its answer.
      answer: used.rounds >= MAX_STEPS - 1,
      log: { assistantThreadId: threadId },
      shouldStop,
      // People come back to a chat after a pause, so its cache is kept for an hour.
      cache: "1h",
      contextHandler: contextSince({
        summary: read.summary,
        compactedThrough: read.compactedThrough,
        agentThreadId,
        promptMessageId,
        onHistory: (read) => {
          history = read;
        },
      }),
      release: ({ lastInputTokens, asked, credits, requests, more }) => {
        const calls = askedSteps(asked);
        const now = { spent: used.credits + credits, rounds: used.rounds + requests, made: made() };
        return ctx.runMutation(internal.assistant.replies.release, {
          ...lock,
          // A request that failed before the model answered read nothing: what the one before it read still says how long the conversation is.
          ended: { ...turn, ...history, lastInputTokens: lastInputTokens || (used.tokens ?? 0) },
          // It waits for the person's answer, or goes on to its next request, or has ended.
          ...(calls.length ? { asking: { promptMessageId, calls, ...now } } : more ? { next: { promptMessageId, ...now, tokens: lastInputTokens } } : {}),
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
 */
export const compact = internalAction({
  args: { ...lockArgs, ...turnArgs, through: v.number(), lastInputTokens: v.number() },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, through, ...turn }) => {
    const lock = { threadId, attemptId };
    let summary: string | undefined;
    const shouldStop = async () => (await ctx.runQuery(internal.assistant.replies.lockState, lock)) !== "writing";
    try {
      if (!(await shouldStop())) {
        summary = await summarize(ctx, { ...(await compactedOf(ctx, threadId)), ...turn, through, chargeId: `chat:${attemptId}:summary`, shouldStop });
      }
    } catch (error) {
      console.error("[assistant] compaction failed", { threadId, error: errorToLogString(error) });
    }
    await ctx.runMutation(internal.assistant.replies.release, { ...lock, ...(summary ? { summarized: { summary, through } } : {}) });
    return null;
  },
});

