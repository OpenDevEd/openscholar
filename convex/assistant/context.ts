/**
 * What the model is sent, and how that is kept small (#326).
 *
 * A request holds, most stable first: the fixed instructions, the summary once the chat
 * has been compacted, every message since then exactly as it was sent, and the new
 * message. Nothing already sent is rewritten between compactions, so the provider's cache
 * of the conversation stays valid from one request to the next.
 *
 * Compaction is the only rewrite. When a reply's last request was large, the chat's own
 * model writes a summary of everything so far, and the next request starts from that
 * summary. Only the model's view is compacted: the chat keeps every message.
 *
 * A reply that still has work to do when that happens is summarized where it stands, and
 * goes on from the summary by itself, in an exchange of its own that begins with a message
 * telling it to (`CARRY_ON`). This is what opencode does when it compacts inside a turn:
 * a message of its own making follows the summary and continues the work. Each exchange
 * then stays short however long the reply runs, which the agent component needs: it reads
 * the whole of the exchange it answers with every request.
 *
 * A summary only ever covers messages that were read whole, from the previous summary's
 * end, so nothing drops out of the model's view unsummarized. A compaction that fails or
 * is stopped stays owed, and the next reply writes it first.
 */
import { docsToModelMessages, type ContextHandler, type MessageDoc } from "@convex-dev/agent";
import { generateText, type ModelMessage } from "ai";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { releaseCredits, reserveCredits, settleCredits, tokenDetails } from "../billing/charge";
import { resolveOpenRouterModel } from "../chat/provider";
import { callOptions, type Effort } from "../../lib/ai/core/call-options";
import { calculateCostInDollars, usageOf } from "../../lib/ai/core/cost";
import { startAbortPoller } from "../../lib/chat/abort-poller";
import { pickProviderCostUsd } from "../../lib/chat/pick-provider-cost";
import { convertUsdToCredits } from "../../lib/pricing";
import { INSTRUCTIONS } from "./agent";

/** A reply whose last request read more input than this is followed by a compaction. */
export const COMPACT_AT_TOKENS = 50_000;
/** Or more than this share of the model's window, when that is lower. */
export const COMPACT_AT_WINDOW = 0.6;
/** Messages a request reads since the last compaction, and the most a chat holds before one runs. */
export const MAX_CONTEXT_MESSAGES = 400;
/** The same limit in bytes, so reading the history stays inside what one query may read. */
export const MAX_CONTEXT_BYTES = 4 * 1024 * 1024;
/**
 * What one read of the history may take: the limits above and room for the exchanges that
 * end past them before their compaction runs. Half of what a query may read at most, so
 * the read never fails; a history past this is reported as not read whole instead.
 */
const READ_MESSAGES = MAX_CONTEXT_MESSAGES + 100;
const READ_BYTES = 8 * 1024 * 1024;
/**
 * What a reply fails with when its chat's history can't be read whole. The status and the
 * wording are what the error taxonomy reads as a conversation that is too long.
 */
const tooLong = () =>
  Object.assign(new Error("This chat is past the maximum context the assistant can read, and its summary couldn't be written. Start a new chat to carry on."), { statusCode: 400 });
/** The most a summary may be. */
export const SUMMARY_MAX_TOKENS = 8_000;

const SUMMARY_LEAD = "This conversation grew long, so its earlier messages were replaced with this summary:\n\n";
/**
 * The message a reply summarized partway goes on from. The app writes it, the model reads
 * it as the person's, and the chat's page leaves it out (./replies.ts). It names everything
 * left, not the next step alone: told to continue with the next step, GPT-6 Luna did that
 * one step of six and stopped.
 */
/** The name that message is saved under, in place of the agent's, which is what tells it from a message a person wrote, whatever theirs says. */
export const CARRIED = "carry-on";
export const CARRY_ON =
  "Carry on. Do everything the summary lists as unfinished, starting with its next step, and don't do again what it says is done. " +
  "Keep going until all of it is done, then give me the answer I asked for. If you're unsure how to proceed, ask me.";

const SUMMARIZE =
  "Write a summary of this conversation that can replace every message above, so the conversation can carry on from the summary alone. " +
  "Use exactly these headings, in this order, and write \"None\" under a heading with nothing to say: " +
  "Decisions. The person's preferences. Records worked on, each by its ID. Open jobs. Unfinished requests. Next step. Last exchanges. " +
  "Under Last exchanges, write the last few exchanges as plain text, who said what. " +
  "Keep every decision and preference from an earlier summary unless the person changed it. " +
  "Don't call a tool, and don't address the person: write only the summary.";

/** Where a chat's history stands: what is summarized, and through which exchange. */
export type Compacted = { summary?: string; compactedThrough?: number };

/**
 * The chat's messages the model still reads in full, oldest first: the ones after the last
 * compaction, up to an exchange. `whole` is false when the read stopped at its limits
 * before it reached the last compaction, so older messages are missing from it.
 */
export async function historySince(
  ctx: Pick<ActionCtx, "runQuery">,
  args: { agentThreadId: string; compactedThrough?: number; before?: string },
): Promise<{ docs: MessageDoc[]; whole: boolean }> {
  const through = args.compactedThrough ?? -1;
  const read = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: args.agentThreadId,
    order: "desc",
    // A reply that failed or was stopped never reaches the model.
    statuses: ["success"],
    paginationOpts: { numItems: READ_MESSAGES, cursor: null, maximumRowsRead: READ_MESSAGES, maximumBytesRead: READ_BYTES },
    ...(args.before ? { upToAndIncludingMessageId: args.before } : {}),
  });
  // The read reaches the end of that message's exchange. A reply already has responses there after
  // its first request, which the agent hands over with the message itself.
  const exchange = read.page.find((doc) => doc._id === args.before)?.order ?? Infinity;
  return {
    docs: read.page.filter((doc) => doc.order < exchange && doc.order > through).reverse(),
    whole: read.isDone || read.page.some((doc) => doc.order <= through),
  };
}

const summaryMessage = (summary: string): ModelMessage => ({ role: "system", content: SUMMARY_LEAD + summary });

/**
 * The context of one reply: the summary, then the history since it, then the new message.
 * `onHistory` hears how much history that was, which decides whether a compaction follows.
 */
export function contextSince(args: Compacted & { agentThreadId: string; promptMessageId: string; onHistory: (history: { messages: number; bytes: number }) => void }): ContextHandler {
  return async (ctx, { inputMessages, inputPrompt, existingResponses }) => {
    const { docs, whole } = await historySince(ctx, { agentThreadId: args.agentThreadId, compactedThrough: args.compactedThrough, before: args.promptMessageId });
    // Answering from part of the conversation would lose the rest without a word.
    if (!whole) throw tooLong();
    // What the reply has written of its own exchange counts with the history: a reply that runs long is most of
    // it. Bytes as Convex counts them: a character outside ASCII is two to four.
    args.onHistory({ messages: docs.length + existingResponses.length, bytes: new TextEncoder().encode(JSON.stringify([docs, existingResponses])).length });
    return [...(args.summary ? [summaryMessage(args.summary)] : []), ...docsToModelMessages(docs), ...inputMessages, ...inputPrompt, ...existingResponses];
  };
}

/** Whether a reply that just ended should be followed by a compaction. */
export function compactionDue(reply: { lastInputTokens: number; window?: number; messages: number; bytes: number }) {
  const tokens = Math.min(COMPACT_AT_TOKENS, reply.window ? reply.window * COMPACT_AT_WINDOW : COMPACT_AT_TOKENS);
  // The reply added at least its message and its answer to what the request read.
  return reply.lastInputTokens > tokens || reply.messages + 2 >= MAX_CONTEXT_MESSAGES || reply.bytes >= MAX_CONTEXT_BYTES;
}

/**
 * Writes the summary that replaces everything through `through`. One call on the chat's
 * own model, reading the same instructions, summary and history its last reply read, so
 * the provider serves them from cache. It has its own hold and its own line in the usage
 * ledger, charged to the person whose reply made it due. Returns what it cost with it: a
 * summary written while a reply is under way counts towards what the reply has spent.
 */
export async function summarize(
  ctx: ActionCtx,
  args: Compacted & {
    agentThreadId: string;
    through: number;
    senderId: Id<"users">;
    modelId: Id<"models"> | null;
    effort?: Effort;
    lastInputTokens: number;
    chargeId: string;
    /** Read every half second while the summary is written; true stops it. */
    shouldStop: () => Promise<boolean>;
  },
): Promise<{ summary: string; credits: number }> {
  const { model, modelSlug, pricing } = await resolveOpenRouterModel(ctx, args.modelId);
  const history = await historySince(ctx, { agentThreadId: args.agentThreadId, compactedThrough: args.compactedThrough });
  // A summary of part of the range would mark the rest as summarized too.
  if (!history.whole) throw tooLong();
  const docs = history.docs.filter((doc) => doc.order <= args.through);
  const estimate = calculateCostInDollars({ inputTokens: args.lastInputTokens, outputTokens: SUMMARY_MAX_TOKENS }, pricing);
  const held = convertUsdToCredits({ usd: estimate }) || 1;
  if (!(await reserveCredits(ctx, { userId: args.senderId, chargeId: args.chargeId, credits: held }))) throw new Error("Not enough credits to summarize the conversation.");
  // Started once nothing before the call can fail, so it's always stopped below.
  const stopped = new AbortController();
  const stopPolling = startAbortPoller({ readFlag: args.shouldStop, onAbort: () => stopped.abort() });
  let settled = false;
  try {
    const result = await generateText({
      model,
      system: INSTRUCTIONS,
      messages: [...(args.summary ? [summaryMessage(args.summary)] : []), ...docsToModelMessages(docs), { role: "user", content: SUMMARIZE }],
      // The earlier summary is a system message of ours.
      allowSystemInMessages: true,
      abortSignal: stopped.signal,
      maxOutputTokens: SUMMARY_MAX_TOKENS,
      maxRetries: 1,
      providerOptions: callOptions(model, { cache: "1h", sessionId: args.agentThreadId, effort: args.effort }),
    });
    const usage = usageOf({ usage: result.usage, providerMetadata: result.providerMetadata });
    const usd = pickProviderCostUsd(result.providerMetadata) ?? calculateCostInDollars({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, pricing);
    const credits = convertUsdToCredits({ usd }) || 1;
    await settleCredits(ctx, {
      userId: args.senderId,
      chargeId: args.chargeId,
      credits,
      usage: { kind: "chat", description: "Conversation summary", model: modelSlug, ...tokenDetails(usage), costUsd: usd },
    });
    settled = true;
    const summary = result.text.trim();
    if (!summary) throw new Error("The model wrote an empty summary.");
    return { summary, credits };
  } finally {
    await stopPolling();
    if (!settled) await releaseCredits(ctx, { userId: args.senderId, chargeId: args.chargeId }).catch(() => {});
  }
}

/** What a chat's replies read from its record. */
export const compactedOf = (ctx: ActionCtx, threadId: Id<"assistantThreads">) => ctx.runQuery(internal.assistant.replies.compacted, { threadId });
