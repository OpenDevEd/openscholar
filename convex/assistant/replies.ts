/**
 * An assistant chat's messages and replies (#324). A person sends a message and the
 * assistant writes one reply to it as that person: with their access, on their credits.
 * A chat writes one reply at a time, and the reply being written is the chat's lock
 * (`reply` on its record). The lock names the scheduled action writing the reply, and
 * holds for as long as that action waits to run or runs.
 *
 *   send (mutation)    saves the message, takes the lock, schedules the reply (./run.ts)
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
import { SERVER_MODEL_SLUG } from "../ai/config";
import { effortValidator } from "../aiModelConfig/validators";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { requireAvailableModel } from "../models/catalog";
import { errorCodeValidator, parseChatError } from "../../lib/errors/taxonomy";
import { CHAT_CONCURRENCY_LIMIT, CHAT_PROMPT_MAX_CHARS } from "../../lib/extraction/limits";
import { personName, requireThread, touchThread } from "./access";
import { assistant } from "./agent";
import { compactionDue } from "./context";
import { detailsOf } from "./details";
import { declineSteps, settleAsked, stepsAt, stepsOfExchange, stopAsking } from "./steps";
import { chatModel, previewOf, requireAssistantModel, writing } from "./threads";
import { askedDetailsValidator } from "./validators";

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


/**
 * Refuses a reply that would be one too many being written for a person at once. A reply
 * that waits for an answer runs nothing and isn't one of them; carrying it on is.
 */
async function admit(ctx: MutationCtx, userId: Id<"users">) {
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
    if (thread.asking) throw createError("CONFLICT", "The assistant is waiting for an answer in this chat. Answer it, or stop the reply.");
    await admit(ctx, userId);
    // A reply that was stopped, or died, as it carried on from an answer can leave calls without their results.
    await settleAsked(ctx, threadId);
    const { modelId, effort } = await chatModel(ctx, thread);
    // The model the chat falls back on, or one picked before the rule, is held to it too. So is
    // the server's own default, which runs when nothing picks a model, where the catalog has it.
    const model = modelId
      ? await requireAvailableModel(ctx, modelId)
      : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
    if (model) requireAssistantModel(model);

    // The message, the lock and the scheduled reply commit together, so a second send
    // can't slip in between them.
    const { messageId, message } = await assistant.saveMessage(ctx, { threadId: thread.agentThreadId, userId, prompt: text, skipEmbeddings: true });
    const now = Date.now();
    const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
    await touchThread(ctx, threadId, now);
    const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, {
      threadId,
      agentThreadId: thread.agentThreadId,
      promptMessageId: messageId,
      attemptId,
      senderId: userId,
      // Taken when the message is sent, so a later change only affects the next reply.
      modelId,
      // An effort the catalog has since dropped runs at the model's default.
      effort: effort && model?.reasoningEfforts?.includes(effort) ? effort : undefined,
    });
    await ctx.db.patch("assistantThreads", threadId, { preview: previewOf(text), reply: { attemptId, senderId: userId, order: message.order, startedAt: now, scheduledId } });
    return null;
  },
});

/** What Stop takes for a reply that waits for an answer: no reply is being written then, so it has no attempt of its own. */
const waitingAttempt = (waiting: { order: number; askedAt: number }) => `waiting:${waiting.order}:${waiting.askedAt}`;

/** The person's answer to a call the assistant asked about (./steps.ts): run it, or don't. */
export const answer = mutation({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps"), allow: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, stepId, allow }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    const step = await ctx.db.get("assistantSteps", stepId);
    const waiting = thread.asking;
    if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
    if (!waiting || step.order !== waiting.order || step.status !== "asking") throw createError("CONFLICT", "This has already been answered.");
    // It would run with their access, on their records, so the answer is theirs alone.
    if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person the assistant is answering can allow this.");
    const left = (await stepsAt(ctx, threadId, "asking")).filter((other) => other._id !== stepId);
    // The answer that lets the reply carry on starts a reply, so it's held to how many a person has at once, before anything changes.
    if (!left.length) await admit(ctx, waiting.senderId);
    if (allow) await ctx.db.patch("assistantSteps", stepId, { status: "allowed" });
    else await declineSteps(ctx, [step]);
    // Calls it asked about together are answered one by one. The reply carries on after the last.
    if (left.length) return null;
    const now = Date.now();
    const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
    const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, {
      threadId,
      agentThreadId: thread.agentThreadId,
      promptMessageId: waiting.promptMessageId,
      attemptId,
      senderId: waiting.senderId,
      modelId: waiting.modelId,
      effort: waiting.effort,
      used: { credits: waiting.spent, rounds: waiting.rounds },
    });
    await ctx.db.patch("assistantThreads", threadId, { asking: undefined, reply: { attemptId, senderId: waiting.senderId, order: waiting.order, startedAt: now, scheduledId } });
    return null;
  },
});

export const lockArgs = { threadId: v.id("assistantThreads"), attemptId: v.string() };

export const turnArgs = { agentThreadId: v.string(), senderId: v.id("users"), modelId: v.union(v.id("models"), v.null()), effort: v.optional(effortValidator) };

/**
 * What a chat's replies read from its record: its summary, the exchange the summary runs
 * through, whether a compaction is owed, and the exchange being answered now.
 */
export const compacted = internalQuery({
  args: { threadId: v.id("assistantThreads") },
  returns: v.object({ summary: v.optional(v.string()), compactedThrough: v.optional(v.number()), owed: v.boolean(), answering: v.optional(v.number()) }),
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    return {
      ...(thread?.summary ? { summary: thread.summary } : {}),
      ...(thread?.compactedThrough !== undefined ? { compactedThrough: thread.compactedThrough } : {}),
      owed: thread?.compactionOwed === true,
      ...(thread?.reply ? { answering: thread.reply.order } : {}),
    };
  },
});

/** Keeps the summary a reply wrote before it answered, while the reply still holds the chat. */
export const summarized = internalMutation({
  args: { ...lockArgs, summary: v.string(), through: v.number() },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, summary, through }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    // One handed in after Stop isn't kept: the reply it was written for won't run, and it stays owed.
    if (thread?.reply?.attemptId === attemptId && !thread.reply.stop) await ctx.db.patch("assistantThreads", threadId, { summary, compactedThrough: through, compactionOwed: undefined });
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
    // One that waits for an answer has nothing running to hear the stop, so it ends here.
    if (thread.asking && attemptId === waitingAttempt(thread.asking)) await stopAsking(ctx, thread, thread.asking);
    // A reply that has ended, or a later one, isn't this Stop's to stop.
    else if (thread.reply?.attemptId === attemptId) await ctx.db.patch("assistantThreads", threadId, { reply: { ...thread.reply, stop: true } });
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

/**
 * Releases a reply's lock when it ends, however it ends. What it wrote becomes the chat's
 * preview. A reply that read a lot (`ended`) hands its lock to a compaction instead, and
 * the compaction releases it, with the summary it wrote (`summarized`) if it wrote one.
 */
export const release = internalMutation({
  args: {
    ...lockArgs,
    ended: v.optional(v.object({ ...turnArgs, lastInputTokens: v.number(), messages: v.number(), bytes: v.number() })),
    summarized: v.optional(v.object({ summary: v.string(), through: v.number() })),
    // The reply ended on calls it asks the person about (./steps.ts): the message it answers, each call as the step
    // that waits, and what the reply has used of one reply's credits and rounds so far.
    asking: v.optional(
      v.object({
        promptMessageId: v.string(),
        calls: v.array(v.object({ toolCallId: v.string(), tool: v.string(), path: v.string(), input: v.string(), subject: v.optional(v.string()) })),
        spent: v.number(),
        rounds: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, ended, summarized, asking }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    if (thread?.reply?.attemptId !== attemptId) return null;
    const current = thread.reply;
    if (current.compacting) {
      // A summary that was stopped, or never written, stays owed: the next reply writes it first.
      const kept = summarized && !current.stop;
      await ctx.db.patch("assistantThreads", threadId, {
        reply: undefined,
        ...(kept ? { summary: summarized.summary, compactedThrough: summarized.through, compactionOwed: undefined } : { compactionOwed: true }),
      });
      return null;
    }
    const newest = (await listMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: { numItems: 1, cursor: null }, excludeToolMessages: true })).page[0];
    const written = newest?.message?.role === "assistant" && newest.order === current.order ? previewOf(newest.text ?? "") : "";
    const preview = written ? { preview: written } : {};
    if (ended && asking?.calls.length) {
      // The chat takes no message until every call is answered, or the reply is stopped. Its summary, if one is due, waits for the reply to end.
      const now = Date.now();
      for (const call of asking.calls) {
        await ctx.db.insert("assistantSteps", { threadId, order: current.order, userId: current.senderId, ...call, prompt: asking.promptMessageId, status: "asking", startedAt: now });
      }
      const waiting = {
        senderId: current.senderId,
        order: current.order,
        promptMessageId: asking.promptMessageId,
        modelId: ended.modelId,
        ...(ended.effort ? { effort: ended.effort } : {}),
        spent: asking.spent,
        rounds: asking.rounds,
        askedAt: now,
      };
      await ctx.db.patch("assistantThreads", threadId, { ...preview, reply: undefined, asking: waiting });
      // Stopped as it asked: the stop found nothing running, and takes effect here.
      if (current.stop) await stopAsking(ctx, thread, waiting);
      return null;
    }
    // A reply that carried on from an answer and was stopped, or failed, on the way can leave calls it never ran.
    await settleAsked(ctx, threadId);
    const window = ended?.modelId ? (await ctx.db.get("models", ended.modelId))?.contextLength : undefined;
    // A stopped reply is left alone: whoever stopped it is waiting to write.
    if (ended && !current.stop && compactionDue({ ...ended, window })) {
      const { lastInputTokens, messages: _messages, bytes: _bytes, ...turn } = ended;
      const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.compact, { threadId, attemptId, ...turn, through: current.order, lastInputTokens });
      // Owed from here until a summary is kept, so one whose action dies is written by the next reply.
      await ctx.db.patch("assistantThreads", threadId, { ...preview, compactionOwed: true, reply: { ...current, scheduledId, compacting: true } });
      return null;
    }
    await ctx.db.patch("assistantThreads", threadId, { reply: undefined, ...preview });
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

/** An action the assistant ran while writing a reply (./steps.ts). */
const stepValidator = v.object({
  id: v.string(),
  role: v.literal("step"),
  /** The exchange it belongs to. */
  order: v.number(),
  /** The action it ran, by its path in the registry. */
  action: v.string(),
  /** What it was about: a title, a name or a query from its arguments. */
  subject: v.optional(v.string()),
  /** How many things it found, when its result lists any. */
  count: v.optional(v.number()),
  /** `failed` also covers a step whose reply died while it ran. `asking`: the person is asked before it runs. `declined`: they said no, or stopped the reply. */
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("asking"), v.literal("declined")),
  /** Whether the person reading can answer it (`answer`): it asks, and it would run for them. */
  canAnswer: v.boolean(),
  /** What it would do, for the person who can answer it: its arguments, with the records they name by name (./details.ts). */
  details: askedDetailsValidator,
  /** Why it failed, as the assistant was told. */
  error: v.optional(v.string()),
  /** Whether the person reading can undo it (./undo.ts): it returned what reverses it (#342), it was done for them, and it isn't undone yet. */
  canUndo: v.boolean(),
  undone: v.boolean(),
  at: v.number(),
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
  /** Whether the person reading sent it. */
  mine: v.boolean(),
  /** The model that wrote it, on a reply. */
  model: v.optional(v.string()),
  at: v.number(),
});

/**
 * A step's status as the chat shows it. One the person allowed is running. One still running,
 * or still asking, when its exchange isn't being answered ended with its reply.
 */
function shownStatus(status: Doc<"assistantSteps">["status"], answering: boolean) {
  if (status === "allowed") return answering ? ("running" as const) : ("failed" as const);
  if (status === "running" && !answering) return "failed" as const;
  if (status === "asking" && !answering) return "declined" as const;
  return status;
}

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
  description: "Reads an assistant chat's messages, newest first, a page at a time: what each person wrote, what the assistant replied, and each action it ran on the way.",
  args: { threadId: v.id("assistantThreads"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.union(messageValidator, stepValidator)),
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
    });
    const sentBy = await senders(ctx, read.page);
    // Each exchange's steps come with the message it answers, which a page holds once.
    const asked = read.page.filter((row) => row.message?.role === "user");
    const ran = new Map(await Promise.all(asked.map(async (row) => [row._id, await stepsOfExchange(ctx, threadId, row.order)] as const)));
    // The exchange being answered now, or waiting for the person's answer. A lock whose action died isn't one.
    const answering = (await writing(ctx, thread.reply)) ? thread.reply?.order : thread.asking?.order;
    // What each call that waits for this person would do.
    const reader = thread.asking?.senderId === userId ? await ctx.db.get("users", userId) : null;
    const mine = reader ? await stepsAt(ctx, threadId, "asking") : [];
    const details = new Map(await Promise.all(mine.map(async (step) => [step._id, await detailsOf(ctx, reader!, step.input)] as const)));
    const page = read.page.flatMap((row) => {
      const role = row.message?.role;
      if (role !== "user" && role !== "assistant") return [];
      // Newest first, like the page: the steps come after the message they answer, so they're listed before it.
      const steps = (ran.get(row._id) ?? [])
        .map((step) => ({
          id: step._id,
          role: "step" as const,
          order: step.order,
          action: step.path,
          ...(step.subject ? { subject: step.subject } : {}),
          ...(step.count === undefined ? {} : { count: step.count }),
          status: shownStatus(step.status, answering === step.order),
          canAnswer: details.has(step._id),
          ...(details.has(step._id) ? { details: details.get(step._id)! } : {}),
          ...(step.error ? { error: step.error } : {}),
          canUndo: step.undo !== undefined && step.userId === userId && step.undone !== true,
          undone: step.undone === true,
          at: step.startedAt,
        }))
        .reverse();
      // A message of the reply that only called actions has no text of its own to show.
      if (role === "assistant" && !row.text && row.status === "success" && Array.isArray(row.message?.content) && row.message.content.some((part) => part.type === "tool-call")) return [];
      const error = row.status === "failed" ? parseChatError(row.error) : null;
      const stopped = error?.class === "aborted";
      // A reply still pending that the chat isn't writing died with its action.
      const pending = row.status === "pending" && answering === row.order;
      const sender = role === "user" && row.userId ? sentBy.get(row.userId) : undefined;
      return [
        ...steps,
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
          mine: role === "user" && row.userId === userId,
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
      for (const part of delta.parts) {
        // One stream runs through every step of a reply. Each step's text becomes a message of
        // its own once the step ends, so only the step being written is still live.
        if (part?.type === "start-step") text = "";
        else if (part?.type === "text-delta" && typeof part.delta === "string") text += part.delta;
      }
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
      /** The reply is written, and the chat is summarizing the conversation so far before it takes the next message. */
      compacting: v.boolean(),
      /** The reply waits for the person to answer what it asked. Stop ends it. */
      asking: v.boolean(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const userId: Id<"users"> = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    // A reply that waits for an answer isn't being written, and Stop ends it.
    if (thread.asking) {
      return { attemptId: waitingAttempt(thread.asking), senderId: thread.asking.senderId, order: thread.asking.order, startedAt: thread.asking.askedAt, stopping: false, compacting: false, asking: true, text: "" };
    }
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
      compacting: current.compacting === true,
      asking: false,
      text: stream ? await textSoFar(ctx, thread.agentThreadId, stream.streamId) : "",
    };
  },
});
