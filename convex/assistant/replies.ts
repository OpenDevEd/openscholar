/**
 * An assistant chat's messages and replies (#324). A person sends a message and the
 * assistant writes one reply to it as that person: with their access, on their credits.
 * A chat writes one reply at a time, and the reply being written is the chat's lock
 * (`reply` on its record). The lock names the scheduled action writing the reply, and
 * holds for as long as that action waits to run or runs.
 *
 *   send (mutation)    saves the message, takes the lock, schedules `reply`
 *   reply (action)     runs the reply through runTurn (./turn.ts), which releases the lock
 *   stop (mutation)    asks the running reply to stop
 *   messages (query)   the chat's messages, a page at a time
 *   live (query)       the reply being written: who it answers, and its text so far
 */
import { listMessages, listStreams, type MessageDoc } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { effortValidator } from "../aiModelConfig/validators";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { ESTIMATED_CREDITS_PER_CHAT_MESSAGE } from "../lib/constants";
import { createError } from "../lib/errors";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { requireAvailableModel } from "../models/catalog";
import { ABORT_ERROR_STRING } from "../../lib/chat/abort-signal";
import { errorCodeValidator, parseChatError } from "../../lib/errors/taxonomy";
import { CHAT_CONCURRENCY_LIMIT, CHAT_PROMPT_MAX_CHARS } from "../../lib/extraction/limits";
import { personName, requireThread, touchThread } from "./access";
import { assistant } from "./agent";
import { runTurn } from "./turn";

const FLAG = "assistant.enabled";
const MESSAGES_PAGE_MAX = 50;
/** What one page of messages may read. A message can be tens of kilobytes, so a page of long ones ends early. */
const MESSAGES_PAGE_BYTES = 1024 * 1024;
/** Rows of a reply's stream one read returns: the agent component's own limit. */
const DELTAS_PER_READ = 100;
/**
 * Reads of a reply's stream that one `live` read makes: 3,000 rows. A stream gains at most
 * four rows a second (runTurn's throttle) for the ten minutes an action can run, so 2,400.
 * ponytail: `live` reads the stream from its start each time a row is added to it. If
 * replies get long enough for that to cost, send the new rows from a cursor the page keeps.
 */
const LIVE_READS = 30;
/** Chats writing a reply that one sweep checks, oldest first. */
const SWEEP_BATCH = 200;

type Reply = NonNullable<Doc<"assistantThreads">["reply"]>;

/**
 * Whether a reply is still being written: its action is waiting to run or running. An
 * action that ended, or died, without releasing its lock no longer holds the chat.
 */
async function writing(ctx: QueryCtx | MutationCtx, reply: Reply | undefined): Promise<boolean> {
  if (!reply) return false;
  const state = (await ctx.db.system.get(reply.scheduledId))?.state.kind;
  return state === "pending" || state === "inProgress";
}

export const send = mutation({
  args: { threadId: v.id("assistantThreads"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, text }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    if (!text.trim()) throw createError("VALIDATION_ERROR", "Write a message first.");
    if (text.length > CHAT_PROMPT_MAX_CHARS) {
      throw createError("VALIDATION_ERROR", `A message can be at most ${CHAT_PROMPT_MAX_CHARS.toLocaleString("en")} characters.`);
    }
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    if (await writing(ctx, thread.reply)) throw createError("CONFLICT", "The assistant is still replying in this chat.");
    // Twice the limit, so locks whose action died can't hide live ones behind them. The dead
    // ones found are released here, which keeps the next count honest too.
    const mine = await ctx.db
      .query("assistantThreads")
      .withIndex("by_replySender", (q) => q.eq("reply.senderId", userId))
      .take(CHAT_CONCURRENCY_LIMIT * 2);
    let stillWriting = 0;
    for (const other of mine) {
      if (await writing(ctx, other.reply)) stillWriting++;
      else await ctx.db.patch("assistantThreads", other._id, { reply: undefined });
    }
    if (stillWriting >= CHAT_CONCURRENCY_LIMIT) {
      throw createError("CONFLICT", `The assistant is already writing ${CHAT_CONCURRENCY_LIMIT} replies for you. Wait for one to finish.`);
    }
    const model = thread.modelId ? await requireAvailableModel(ctx, thread.modelId) : null;

    // The message, the lock and the scheduled reply commit together, so a second send
    // can't slip in between them.
    const { messageId, message } = await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId, prompt: text, skipEmbeddings: true });
    const now = Date.now();
    const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
    await touchThread(ctx, threadId, now);
    const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.replies.reply, {
      threadId,
      agentThreadId: thread.agentThreadId,
      promptMessageId: messageId,
      attemptId,
      senderId: userId,
      // Taken when the message is sent, so a later change only affects the next reply.
      modelId: thread.modelId ?? null,
      // An effort the catalog has since dropped runs at the model's default.
      effort: thread.effort && model?.reasoningEfforts?.includes(thread.effort) ? thread.effort : undefined,
    });
    await ctx.db.patch("assistantThreads", threadId, { reply: { attemptId, senderId: userId, order: message.order, startedAt: now, scheduledId } });
    return null;
  },
});

const lockArgs = { threadId: v.id("assistantThreads"), attemptId: v.string() };

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
    await runTurn(ctx, {
      agent: assistant,
      threadId: agentThreadId,
      promptMessageId,
      userId: senderId,
      modelId,
      effort,
      attemptId,
      credits: ESTIMATED_CREDITS_PER_CHAT_MESSAGE,
      log: { assistantThreadId: threadId },
      shouldStop: async () => (await state()) !== "writing",
      release: () => ctx.runMutation(internal.assistant.replies.release, lock),
    });
    return null;
  },
});

export const stop = mutation({
  args: lockArgs,
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    // A reply that has ended, or a later one, isn't this Stop's to stop.
    if (thread.reply?.attemptId === attemptId) await ctx.db.patch("assistantThreads", threadId, { reply: { ...thread.reply, stop: true } });
    return null;
  },
});

/** Where a reply's lock stands: still its own (`writing`), stopped by someone (`stop`), or gone with its chat or to another reply (`gone`). */
export const lockState = internalQuery({
  args: lockArgs,
  returns: v.union(v.literal("writing"), v.literal("stop"), v.literal("gone")),
  handler: async (ctx, { threadId, attemptId }) => {
    const current = (await ctx.db.get("assistantThreads", threadId))?.reply;
    if (current?.attemptId !== attemptId) return "gone" as const;
    return current.stop ? ("stop" as const) : ("writing" as const);
  },
});

/** Releases a reply's lock when it ends, however it ends. */
export const release = internalMutation({
  args: lockArgs,
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId }) => {
    const current = (await ctx.db.get("assistantThreads", threadId))?.reply;
    if (current?.attemptId === attemptId) await ctx.db.patch("assistantThreads", threadId, { reply: undefined });
    return null;
  },
});

/**
 * The cron's entry (convex/crons.ts). A reply whose action died never releases its lock.
 * Nothing treats such a lock as held (`writing`), and this clears it away.
 */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const held = await ctx.db
      .query("assistantThreads")
      // Chats writing no reply have no start time, and sort before every number.
      .withIndex("by_replyStartedAt", (q) => q.gt("reply.startedAt", 0))
      .take(SWEEP_BATCH);
    for (const thread of held) {
      if (!(await writing(ctx, thread.reply))) await ctx.db.patch("assistantThreads", thread._id, { reply: undefined });
    }
    return null;
  },
});

const messageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  /** A message and the reply to it share an order. */
  order: v.number(),
  text: v.string(),
  /** `pending` is the reply being written, whose text so far `live` has. `stopped` keeps what was written before the stop. */
  status: v.union(v.literal("pending"), v.literal("done"), v.literal("stopped"), v.literal("failed")),
  /** Why a reply failed. One that died with its action has none. */
  error: v.optional(
    v.object({
      code: errorCodeValidator,
      message: v.string(),
      retryAfterMs: v.optional(v.number()),
    }),
  ),
  /** Who sent it, on a person's message. Their name is empty when they gave none. */
  sender: v.optional(v.object({ userId: v.id("users"), name: v.string() })),
  /** The model that wrote it, on a reply. */
  model: v.optional(v.string()),
  at: v.number(),
});

/** Who sent a message, for the people a page of messages names. */
async function senders(ctx: QueryCtx, rows: MessageDoc[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.message?.role === "user" && row.userId ? [row.userId] : [])))];
  const people = await Promise.all(
    ids.map(async (id) => {
      const userId = ctx.db.normalizeId("users", id);
      const person = userId && (await ctx.db.get("users", userId));
      return person ? [[id, { userId: person._id, name: personName(person) }] as const] : [];
    }),
  );
  return new Map(people.flat());
}

export const messagesAction = defineUserQuery({
  path: "assistant/replies:messages",
  description: "Reads an assistant chat's messages, newest first, a page at a time: what each person wrote and what the assistant replied.",
  args: { threadId: v.id("assistantThreads"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(messageValidator),
  run: async (ctx, userId, { threadId, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    const read = await listMessages(ctx, components.agent, {
      threadId: thread.agentThreadId,
      // The caps bound a page whatever the caller asks for: with an `endCursor`, `numItems` alone doesn't.
      paginationOpts: {
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, MESSAGES_PAGE_MAX),
        maximumRowsRead: MESSAGES_PAGE_MAX,
        maximumBytesRead: MESSAGES_PAGE_BYTES,
      },
      excludeToolMessages: true,
    });
    const sentBy = await senders(ctx, read.page);
    // The exchange being answered now. A lock whose action died isn't one.
    const answering = (await writing(ctx, thread.reply)) ? thread.reply?.order : undefined;
    const page = read.page.flatMap((row) => {
      const role = row.message?.role;
      if (role !== "user" && role !== "assistant") return [];
      const error = row.status === "failed" ? parseChatError(row.error) : null;
      const stopped = error?.class === "aborted";
      // A reply still pending that the chat isn't writing died with its action.
      const pending = row.status === "pending" && answering === row.order;
      const sender = role === "user" && row.userId ? sentBy.get(row.userId) : undefined;
      return [
        {
          id: row._id,
          role,
          order: row.order,
          text: row.text ?? "",
          status: pending ? ("pending" as const) : stopped ? ("stopped" as const) : row.status === "success" ? ("done" as const) : ("failed" as const),
          ...(error && !stopped
            ? {
                error: {
                  code: error.class,
                  message: error.message,
                  // The sender's credit balance, which an error can carry, stays out: everyone in the chat reads this.
                  ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
                },
              }
            : {}),
          ...(sender ? { sender } : {}),
          ...(role === "assistant" && row.model ? { model: row.model } : {}),
          at: row._creationTime,
        },
      ];
    });
    return { ...read, page };
  },
});
export const messages = userQuery(messagesAction);
export const messagesForAssistant = assistantQuery(messagesAction);

/** The text a reply's stream holds so far. */
async function textSoFar(ctx: QueryCtx, agentThreadId: string, streamId: string) {
  let text = "";
  let cursor = 0;
  for (let reads = 0; reads < LIVE_READS; reads++) {
    const deltas = await ctx.runQuery(components.agent.streams.listDeltas, { threadId: agentThreadId, cursors: [{ streamId, cursor }] });
    for (const delta of deltas) {
      for (const part of delta.parts) if (part?.type === "text-delta" && typeof part.delta === "string") text += part.delta;
      cursor = delta.end;
    }
    if (deltas.length < DELTAS_PER_READ) break;
  }
  return text;
}

export const live = query({
  args: { threadId: v.id("assistantThreads") },
  returns: v.union(
    v.null(),
    v.object({
      /** What `stop` takes. */
      attemptId: v.string(),
      /** Whose message it answers. */
      senderId: v.id("users"),
      /** The exchange it belongs to, whose `pending` message shows `text`. */
      order: v.number(),
      startedAt: v.number(),
      /** Someone stopped it, and it hasn't ended yet. */
      stopping: v.boolean(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const userId: Id<"users"> = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    const current = thread.reply;
    if (!current || !(await writing(ctx, current))) return null;
    // Newest first. A stream that has just ended still counts: its text stays up until the
    // reply's message holds it and the lock is released, so the page never shows it vanish.
    const streams = await listStreams(ctx, components.agent, {
      threadId: thread.agentThreadId,
      startOrder: current.order,
      includeStatuses: ["streaming", "finished", "aborted"],
    });
    const stream = streams.find((candidate) => candidate.order === current.order);
    return {
      attemptId: current.attemptId,
      senderId: current.senderId,
      order: current.order,
      startedAt: current.startedAt,
      stopping: current.stop === true,
      text: stream ? await textSoFar(ctx, thread.agentThreadId, stream.streamId) : "",
    };
  },
});
