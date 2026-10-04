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
import { ASSISTANT_REPLY_CREDITS } from "../lib/constants";
import { errorToLogString } from "../lib/errors";
import { internalAction } from "../lib/functions";
import { ABORT_ERROR_STRING } from "../../lib/chat/abort-signal";
import { assistant } from "./agent";
import { COMPACT_AT_TOKENS, compactedOf, contextSince, summarize } from "./context";
import { lockArgs, turnArgs } from "./replies";
import { MAX_STEPS, OUT_OF_CREDITS, OUT_OF_STEPS, askedSteps, forModel, toolsFor } from "./tools";
import { runTurn } from "./turn";

export const reply = internalAction({
  args: {
    ...lockArgs,
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    senderId: v.id("users"),
    modelId: v.union(v.id("models"), v.null()),
    effort: v.optional(effortValidator),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, agentThreadId, promptMessageId, senderId, modelId, effort }) => {
    const lock = { threadId, attemptId };
    const state = () => ctx.runQuery(internal.assistant.replies.lockState, lock);
    const atStart = await state();
    // A reply whose chat was deleted, or whose lock is another reply's, never starts.
    if (atStart === "gone") return null;
    // Stopped while it waited to run: no credits are held and no model is called. The chat shows a stopped reply.
    if (atStart === "stop") {
      await assistant.saveMessage(ctx, {
        threadId: agentThreadId,
        promptMessageId,
        message: { role: "assistant", content: "" },
        metadata: { status: "failed", error: ABORT_ERROR_STRING },
        skipEmbeddings: true,
      });
      await ctx.runMutation(internal.assistant.replies.release, lock);
      return null;
    }
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
    // Where the reply stands, heard before each of its requests. Its actions stop a round
    // before its last request and once it has cost its hold, so the request after is its answer.
    let step = { number: 0, credits: 0 };
    const stopped = () => (step.number >= MAX_STEPS - 2 ? OUT_OF_STEPS : step.credits >= ASSISTANT_REPLY_CREDITS ? OUT_OF_CREDITS : null);
    const order = read.answering ?? 0;
    // Each action it runs is kept as a step of the exchange it's answering.
    const { tools, approval, resume } = toolsFor(ctx, { userId: senderId, threadId, order, attemptId, stopped });
    // A reply that waited for an answer carries on here: what the person allowed runs first,
    // and its result goes where the model's call left off, so the model reads what came of it.
    const allowed = await ctx.runQuery(internal.assistant.steps.allowed, { threadId, order });
    for (const step of allowed) {
      const output = forModel(await resume(step));
      await assistant.saveMessage(ctx, {
        threadId: agentThreadId,
        promptMessageId,
        message: { role: "tool", content: [{ type: "tool-result", toolCallId: step.toolCallId, toolName: step.tool, output: typeof output === "string" ? { type: "text", value: output } : { type: "json", value: output as never } }] },
        skipEmbeddings: true,
      });
    }
    await runTurn(ctx, {
      agent: assistant,
      threadId: agentThreadId,
      promptMessageId,
      userId: senderId,
      modelId,
      effort,
      attemptId,
      credits: ASSISTANT_REPLY_CREDITS,
      tools,
      approval,
      maxSteps: MAX_STEPS,
      onStep: (now) => {
        step = now;
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
      release: ({ lastInputTokens, asked }) => {
        const calls = askedSteps(asked);
        return ctx.runMutation(internal.assistant.replies.release, { ...lock, ended: { ...turn, ...history, lastInputTokens }, ...(calls.length ? { asking: { promptMessageId, calls } } : {}) });
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

