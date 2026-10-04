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
import { ASSISTANT_HOLD_CREDITS, ESTIMATED_CREDITS_PER_CHAT_MESSAGE } from "../lib/constants";
import { errorToLogString } from "../lib/errors";
import { internalAction } from "../lib/functions";
import { ABORT_ERROR_STRING } from "../../lib/chat/abort-signal";
import { assistant } from "./agent";
import { COMPACT_AT_TOKENS, compactedOf, contextSince, full, summarize } from "./context";
import { lockArgs, turnArgs } from "./replies";
import { OUT_OF_CREDITS, OUT_OF_ROOM, OUT_OF_TIME, askedSteps, toolsFor } from "./tools";
import { runTurn, type Standing } from "./turn";

/**
 * How long a reply runs its actions. Convex ends an action at ten minutes, and a reply is
 * one: past this its actions stop and its next request is its answer, so it ends by saying
 * what it did and what's left, and isn't cut off mid-way with nothing said.
 */
const REPLY_RUNS_MS = 8 * 60_000;

export const reply = internalAction({
  args: {
    ...lockArgs,
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    senderId: v.id("users"),
    modelId: v.union(v.id("models"), v.null()),
    effort: v.optional(effortValidator),
    // How many actions the reply had called before it asked the person something, when it carries on from their answer.
    made: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, agentThreadId, promptMessageId, senderId, modelId, effort, made: madeBefore = 0 }) => {
    const startedAt = Date.now();
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
    // A compaction that was due and didn't finish is written now, before the reply reads the conversation.
    if (read.owed && read.answering) {
      try {
        const through = read.answering - 1;
        const summary = await summarize(ctx, { ...read, ...turn, through, lastInputTokens: COMPACT_AT_TOKENS, chargeId: `chat:${attemptId}:summary`, shouldStop });
        await ctx.runMutation(internal.assistant.replies.summarized, { ...lock, summary, through });
        read = { ...read, summary, compactedThrough: through, owed: false };
      } catch (error) {
        // Still owed. The reply goes ahead if the conversation can be read whole, and fails saying so if it can't.
        console.error("[assistant] owed compaction failed", { threadId, error: errorToLogString(error) });
      }
    }
    // What the reply holds to start: a hold's worth, or what the person has when that's less,
    // down to the least a reply starts on, so a small balance still gets an answer. It holds
    // as much again each time it has cost that (./turn.ts): what a reply may cost is the
    // person's credits, and nothing else.
    let balance = (await ctx.runQuery(internal.billing.accounts.forUser, { userId: senderId }))?.balance;
    // The account's copy of the balance can be behind a top-up. When it says the reply can't hold a whole hold, it's read again from Autumn.
    if (balance !== undefined && balance < ASSISTANT_HOLD_CREDITS) balance = (await refreshAccount(ctx, senderId).catch(() => null))?.balance ?? balance;
    const hold = Math.max(ESTIMATED_CREDITS_PER_CHAT_MESSAGE, Math.min(ASSISTANT_HOLD_CREDITS, balance ?? ASSISTANT_HOLD_CREDITS));
    // Where the reply stands, heard before each of its requests. Its actions stop when it has
    // cost all it could hold, which is when the person's credits have run out; when it has
    // run as long as one action can; and when the conversation is as long as it may get
    // before it's compacted (./context.ts). The model is told why, and answers.
    let step: Standing = { number: 0, credits: 0, held: hold, inputTokens: 0, bytes: 0 };
    // The conversation with what the reply has added to it: each request writes two messages, its calls and their results.
    const grown = (requests: number, bytes: number) => ({ messages: history.messages + 2 * requests, bytes: history.bytes + bytes });
    const stopped = () => {
      if (Date.now() - startedAt >= REPLY_RUNS_MS) return OUT_OF_TIME;
      if (step.credits >= step.held) return OUT_OF_CREDITS;
      return full({ lastInputTokens: step.inputTokens, window: step.window, ...grown(step.number, step.bytes) }) ? OUT_OF_ROOM : null;
    };
    // Each action it runs is kept as a step of the exchange it's answering.
    const { tools, approval, resume, made } = toolsFor(ctx, { userId: senderId, threadId, order: read.answering ?? 0, attemptId, stopped, round: () => step.number, made: madeBefore });
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
      attemptId,
      credits: hold,
      more: ASSISTANT_HOLD_CREDITS,
      tools,
      approval,
      // A reply takes as many requests as its work needs. Once its actions have stopped and
      // the model has been told, a request that would call one anyway is made its answer.
      onStep: (now) => {
        const told = stopped() !== null;
        step = now;
        return told && stopped() !== null;
      },
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
      release: ({ lastInputTokens, asked, requests, bytes }) => {
        const calls = askedSteps(asked);
        return ctx.runMutation(internal.assistant.replies.release, {
          ...lock,
          ended: { ...turn, ...grown(requests, bytes), lastInputTokens },
          ...(calls.length ? { asking: { promptMessageId, calls, made: made() } } : {}),
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

