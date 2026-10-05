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
import { listMessages, listStreams, saveMessages, type MessageDoc } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { getConvexSize, v, type Infer, type Value } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { effortValidator } from "../aiModelConfig/validators";
import { availableCredits } from "../billing/accounts";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { requireAvailableModel } from "../models/catalog";
import { errorCodeValidator, parseChatError } from "../../lib/errors/taxonomy";
import { NEW_CHAT_TITLE, titleFrom } from "../../lib/assistant/title";
import { notePart, viewOf } from "../../lib/assistant/view";
import { hasVariants, variantIn, viewOf as actionView } from "../../lib/assistant/actions";
import { CHAT_PROMPT_MAX_CHARS } from "../../lib/extraction/limits";
import { ASSISTANT_REPLIES_AT_ONCE } from "../lib/constants";
import { personName, requireThread, touchThread } from "./access";
import { assistant } from "./agent";
import { CARRIED, CARRY_ON, compactionDue } from "./context";
import { bulkOf, detailsOf } from "./details";
import { allowAlways, carriedOn, covers, noteReply, pausedAt, replyLimitOf } from "./spending";
import { STEPS_SHOWN, declineSteps, healCalls, settleAsked, stepsAt, stepsOfExchange, stopAsking } from "./steps";
import { chatModel, previewOf, requireAssistantModel, writing } from "./threads";
import { askedDetailsValidator, askedEachValidator, assistantPausedValidator } from "./validators";

const FLAG = "assistant.enabled";
const MESSAGES_PAGE_MAX = 50;
/** What one page of messages may read. A message can be tens of kilobytes, so a page of long ones ends early. */
const MESSAGES_PAGE_BYTES = 1024 * 1024;
/** The cursor the agent component's paginator gives for the end of a chat's messages. */
const CHAT_END = "[]";
/** Rows `outcome` reads to find the newest message that isn't an action's result. */
const OUTCOME_ROWS = 4;
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
    .take(ASSISTANT_REPLIES_AT_ONCE * 2);
  let stillWriting = 0;
  for (const other of mine) {
    if (await writing(ctx, other.reply)) stillWriting++;
    else await endDead(ctx, other);
  }
  if (stillWriting >= ASSISTANT_REPLIES_AT_ONCE) {
    throw createError("CONFLICT", `The assistant is already writing ${ASSISTANT_REPLIES_AT_ONCE} replies for you. Wait for one to finish.`);
  }
}

/** Clears the lock of a reply whose action died. What it had cost by then is still one of its sender's last replies. */
async function endDead(ctx: MutationCtx, thread: Doc<"assistantThreads">) {
  if (thread.reply) await noteReply(ctx, thread.reply.senderId, thread.reply.attemptId, thread.reply.spent ?? 0);
  await ctx.db.patch("assistantThreads", thread._id, { reply: undefined });
}

export const send = mutation({
  // `view`: the address of the page the message is sent from, its path and parameters.
  args: { threadId: v.id("assistantThreads"), text: v.string(), view: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { threadId, text, view: address }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    if (!text.trim()) throw createError("VALIDATION_ERROR", "Write a message first.");
    if (text.length > CHAT_PROMPT_MAX_CHARS) {
      throw createError("VALIDATION_ERROR", `A message can be at most ${CHAT_PROMPT_MAX_CHARS.toLocaleString("en")} characters.`);
    }
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    if (await writing(ctx, thread.reply)) throw createError("CONFLICT", "The assistant is still replying in this chat.");
    if (thread.asking?.paused) throw createError("CONFLICT", "The assistant's reply is paused in this chat. Carry it on, or stop it.");
    if (thread.asking) throw createError("CONFLICT", "The assistant is waiting for an answer in this chat. Answer it, or stop the reply.");
    await admit(ctx, userId);
    // A reply that was stopped, or died, around asking the person can leave calls without their results.
    await settleAsked(ctx, threadId);
    await healCalls(ctx, thread.agentThreadId);
    const { modelId, effort } = await chatModel(ctx, thread, userId);
    // The model the chat falls back on, or one picked before the rule, is held to it too. So is
    // the server's own default, which runs when nothing picks a model, where the catalog has it.
    const model = modelId
      ? await requireAvailableModel(ctx, modelId)
      : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
    if (model) requireAssistantModel(model);

    // The message, the lock and the scheduled reply commit together, so a second send
    // can't slip in between them.
    // Where it's sent from and the date go with the message, for the model alone, and stay
    // there, so nothing already sent changes. The note is left out when this person's last
    // message said the same place on the same day and the model still reads that message: it
    // isn't summarized, and no summary is owed that would take its place before this one is
    // answered. In a shared chat each person's messages say their own place.
    const now = Date.now();
    const view = address === undefined ? null : viewOf(address);
    // ponytail: the server's day, in UTC. Send the person's own date with the message if a day's difference near midnight comes to matter.
    const today = new Date(now).toISOString().slice(0, 10);
    const said = thread.view && thread.view.userId === userId && thread.view.order > (thread.compactedThrough ?? -1) && thread.compactionOwed !== true ? thread.view : undefined;
    const moved = (view !== null && view !== said?.address) || today !== said?.day;
    // Changes of the assistant's this person took back with Undo since the model was last told (./undo.ts). They were
    // changes to this person's own records, so someone else's undos wait for a message of theirs.
    const mine = (thread.undone ?? []).filter((entry) => entry.userId === userId);
    const others = (thread.undone ?? []).filter((entry) => entry.userId !== userId);
    const undone: string[] = [];
    for (const { stepId } of mine) {
      const step = await ctx.db.get("assistantSteps", stepId);
      // What the change was, how many it made, what it was about, and whether a bulk one is still being put back.
      if (step) undone.push([step.variant ? `${step.path}#${step.variant}` : step.path, step.batch === undefined ? null : `${step.count ?? step.batch} changes`, step.subject, step.reverting ? "still being put back" : null].filter(Boolean).join(", "));
    }
    if (mine.length && thread.undoneMore) undone.push(`and ${thread.undoneMore} changes before these`);
    const { messageId, message } = await assistant.saveMessage(ctx, {
      threadId: thread.agentThreadId,
      userId,
      // What this person undid goes with their message, whether or not the place changed.
      ...(moved || undone.length
        ? { message: { role: "user" as const, content: [{ type: "text" as const, text }, { type: "text" as const, text: notePart({ page: view ?? undefined, today, chat: threadId, undone }) }] } }
        : { prompt: text }),
      skipEmbeddings: true,
    });
    if (mine.length) await ctx.db.patch("assistantThreads", threadId, { undone: others.length ? others : undefined, undoneMore: undefined });
    const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
    await touchThread(ctx, threadId, now);
    // What the sender lets a reply spend here, if they set a limit (./spending.ts). Taken with the message, like its model.
    const cap = await replyLimitOf(ctx, threadId, userId);
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
      ...(cap === undefined ? {} : { used: { credits: 0, rounds: 0, calls: 0, cap } }),
    });
    // A chat made before it had a message, to share it or to set what it may spend, is named by its first.
    // ponytail: told apart by its title alone, so a chat renamed to exactly the default before its first message is named over. A flag on the chat for "named by hand" if that ever matters.
    const title = thread.preview === undefined && thread.title === NEW_CHAT_TITLE ? titleFrom(text) : "";
    await ctx.db.patch("assistantThreads", threadId, { ...(title ? { title } : {}), preview: previewOf(text), ...(moved ? { view: { ...((view ?? said?.address) === undefined ? {} : { address: view ?? said?.address }), day: today, userId, order: message.order } } : {}), reply: { attemptId, senderId: userId, order: message.order, startedAt: now, scheduledId, spent: 0, ...(cap === undefined ? {} : { cap }) } });
    return null;
  },
});

/** What Stop takes for a reply that waits for an answer: no reply is being written then, so it has no attempt of its own. */
const waitingPrefix = (order: number) => `waiting:${order}:`;
const waitingAttempt = (waiting: { order: number; askedAt: number }) => `${waitingPrefix(waiting.order)}${waiting.askedAt}`;

/** The person's answer to a call the assistant asked about (./steps.ts): run it, or don't. */
export const answer = mutation({
  // `always`, with a yes to a call that spends credits: jobs that hold no more run in this chat without asking from now on (./spending.ts).
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps"), allow: v.boolean(), always: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { threadId, stepId, allow, always }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    const step = await ctx.db.get("assistantSteps", stepId);
    const waiting = thread.asking;
    if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
    if (!waiting || step.order !== waiting.order || step.status !== "asking") throw createError("CONFLICT", "This has already been answered.");
    // It would run with their access, on their records, so the answer is theirs alone.
    if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person the assistant is answering can allow this.");
    let left = (await stepsAt(ctx, threadId, "asking")).filter((other) => other._id !== stepId);
    // A yes to a call that holds more than the person has starts nothing: it waits while they add credits, as its card says.
    const balance = allow && step.credits !== undefined ? await availableCredits(ctx, userId) : 0;
    if (allow && step.credits !== undefined && step.credits > balance) throw createError("INSUFFICIENT_CREDITS", "There aren't enough credits for this yet. Add credits, then allow it.");
    if (allow && always && step.credits !== undefined) {
      // As opencode's "always" does for a session: the rule is kept, and what else waits that it now covers is allowed with it.
      const allowance = await allowAlways(ctx, threadId, userId, step.credits);
      const covered = left.filter((other) => other.credits !== undefined && covers(allowance, other.credits, balance));
      for (const other of covered) await ctx.db.patch("assistantSteps", other._id, { status: "allowed" });
      left = left.filter((other) => !covered.includes(other));
    }
    // It asked with its limit already reached: the last answer starts nothing, and the reply waits to be carried on.
    const paused = left.length ? null : pausedAt(waiting);
    // The answer that lets the reply carry on starts a reply, so it's held to how many a person has at once, before anything changes.
    if (!left.length && !paused) await admit(ctx, waiting.senderId);
    if (allow) await ctx.db.patch("assistantSteps", stepId, { status: "allowed" });
    else await declineSteps(ctx, [step]);
    // Calls it asked about together are answered one by one. The reply carries on after the last.
    if (left.length) return null;
    // The answers are kept, and it runs what was allowed once it's carried on: answering a question isn't agreeing to spend more.
    if (paused) {
      await ctx.db.patch("assistantThreads", threadId, { asking: { ...waiting, paused } });
      return null;
    }
    await goOnFrom(ctx, thread, waiting, { ...(waiting.cap === undefined ? {} : { cap: waiting.cap }), ...(waiting.lap === undefined ? {} : { lap: waiting.lap }) });
    return null;
  },
});

/** Starts a reply that waited again, from where it stood, with the limits it now runs to. */
async function goOnFrom(ctx: MutationCtx, thread: Doc<"assistantThreads">, waiting: NonNullable<Doc<"assistantThreads">["asking"]>, limits: { cap?: number; lap?: number }) {
  const now = Date.now();
  const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
  const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, {
    threadId: thread._id,
    agentThreadId: thread.agentThreadId,
    promptMessageId: waiting.promptMessageId,
    attemptId,
    senderId: waiting.senderId,
    modelId: waiting.modelId,
    effort: waiting.effort,
    used: { credits: waiting.spent, rounds: waiting.rounds, calls: waiting.made, ...(waiting.failed ? { failed: waiting.failed } : {}), ...(waiting.recent ? { recent: waiting.recent } : {}), ...(waiting.changes ? { changes: waiting.changes } : {}), ...limits },
  });
  await ctx.db.patch("assistantThreads", thread._id, {
    asking: undefined,
    reply: { attemptId, senderId: waiting.senderId, order: waiting.order, startedAt: now, scheduledId, spent: waiting.spent, ...(limits.cap === undefined ? {} : { cap: limits.cap }) },
  });
}

/**
 * Carries on a reply that paused at a limit (./spending.ts). It may spend as much again
 * as its sender's limit is now, or make as many requests again, from where it stands.
 */
export const carryOn = mutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    const waiting = thread.asking;
    if (!waiting?.paused) throw createError("CONFLICT", "This reply isn't paused.");
    // It spends their credits, so carrying it on is theirs alone.
    if (waiting.senderId !== userId) throw createError("FORBIDDEN", "Only the person the assistant is answering can carry this on.");
    // Carrying it on starts a reply, so it's held to how many a person has at once.
    await admit(ctx, userId);
    await goOnFrom(ctx, thread, waiting, carriedOn(waiting, await replyLimitOf(ctx, threadId, userId)));
    return null;
  },
});

export const lockArgs = { threadId: v.id("assistantThreads"), attemptId: v.string() };

export const turnArgs = { agentThreadId: v.string(), senderId: v.id("users"), modelId: v.union(v.id("models"), v.null()), effort: v.optional(effortValidator) };

/**
 * Where a reply stands after its requests so far: the credits they cost, how many they were,
 * the actions they called, the input tokens the last of them read, how many of them in a
 * row had every action fail, the digests of what the last few did (./tools.ts), why its
 * actions were refused in the last one, when they were, and the credits and the requests
 * it pauses at (./spending.ts).
 */
export const usedValidator = v.object({
  credits: v.number(),
  rounds: v.number(),
  calls: v.number(),
  tokens: v.optional(v.number()),
  failed: v.optional(v.number()),
  recent: v.optional(v.array(v.string())),
  /** How many changes it has called for unasked, by what they change (./tools.ts `kindOf`). */
  changes: v.optional(v.record(v.string(), v.number())),
  told: v.optional(v.string()),
  cap: v.optional(v.number()),
  lap: v.optional(v.number()),
});
/** What a reply's next request starts from: whose it is, the message it answers, and what the reply has used. */
const resumeValidator = v.object({ ...turnArgs, promptMessageId: v.string(), used: usedValidator });

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
    // The reply being written, or the same reply carrying on from an answer that was given as Stop
    // was pressed on it waiting. A reply that has ended, or a later exchange's, isn't this Stop's to stop.
    else if (thread.reply && (thread.reply.attemptId === attemptId || attemptId.startsWith(waitingPrefix(thread.reply.order)))) {
      await ctx.db.patch("assistantThreads", threadId, { reply: { ...thread.reply, stop: true } });
    }
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
    // What the reply's requests have cost in all, for its sender's record once it has ended (./spending.ts).
    spent: v.optional(v.number()),
    summarized: v.optional(v.object({ summary: v.string(), through: v.number() })),
    // The compaction ran while a reply was under way: the reply goes on from here.
    resume: v.optional(resumeValidator),
    // The reply ended on calls it asks the person about (./steps.ts): the message it answers, each call as the step
    // that waits, and what the reply's requests have cost and called so far.
    asking: v.optional(
      v.object({
        promptMessageId: v.string(),
        calls: v.array(v.object({ toolCallId: v.string(), tool: v.string(), path: v.string(), input: v.string(), subject: v.optional(v.string()), credits: v.optional(v.number()), shown: v.optional(v.string()), batch: v.optional(v.number()), variant: v.optional(v.string()) })),
        spent: v.number(),
        rounds: v.number(),
        made: v.number(),
        failed: v.number(),
        recent: v.array(v.string()),
        changes: v.optional(v.record(v.string(), v.number())),
        cap: v.optional(v.number()),
        lap: v.optional(v.number()),
      }),
    ),
    // The reply's request ended on actions that ran (./turn.ts): their results go back to the model in
    // its next request, with what the reply has used so far.
    next: v.optional(
      v.object({
        promptMessageId: v.string(),
        spent: v.number(),
        rounds: v.number(),
        made: v.number(),
        tokens: v.number(),
        failed: v.number(),
        recent: v.array(v.string()),
        changes: v.optional(v.record(v.string(), v.number())),
        told: v.optional(v.string()),
        cap: v.optional(v.number()),
        lap: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, ended, spent, summarized, asking, next, resume }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    if (thread?.reply?.attemptId !== attemptId) return null;
    const current = thread.reply;
    /** Schedules the reply's next request, under the same lock. One stopped meanwhile finds that out there, and shows as stopped. */
    const goOn = async ({ used, ...from }: Infer<typeof resumeValidator>) => {
      const { compacting: _compacting, ...lock } = current;
      const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, { threadId, attemptId, ...from, used });
      const { cap: _cap, ...held } = lock;
      return { ...held, scheduledId, spent: used.credits, ...(used.cap === undefined ? {} : { cap: used.cap }) };
    };
    /**
     * Why the reply pauses before the request it would make next, when it does: it has reached what its sender lets
     * a reply spend, or the requests a reply makes before it asks (./spending.ts). One that was stopped ends at its
     * next request instead, and one whose next request is its answer (./run.ts) makes it.
     */
    const pauseBefore = (used: Infer<typeof usedValidator>) => (current.stop || used.told ? null : pausedAt({ spent: used.credits, rounds: used.rounds, cap: used.cap, lap: used.lap }));
    /** The paused reply, as the chat keeps it until it's carried on: where it stands in `order`, and what it runs to. */
    const pausedFrom = ({ used, ...from }: Infer<typeof resumeValidator>, order: number, paused: NonNullable<ReturnType<typeof pauseBefore>>) => ({
      senderId: current.senderId,
      order,
      promptMessageId: from.promptMessageId,
      modelId: from.modelId,
      ...(from.effort ? { effort: from.effort } : {}),
      spent: used.credits,
      rounds: used.rounds,
      made: used.calls,
      ...(used.failed ? { failed: used.failed } : {}),
      ...(used.recent?.length ? { recent: used.recent } : {}),
      ...(used.changes ? { changes: used.changes } : {}),
      ...(used.cap === undefined ? {} : { cap: used.cap }),
      ...(used.lap === undefined ? {} : { lap: used.lap }),
      paused,
      askedAt: Date.now(),
    });
    if (current.compacting) {
      const kept = summarized && !current.stop ? { summary: summarized.summary, compactedThrough: summarized.through, compactionOwed: undefined } : null;
      if (resume && kept) {
        // Written while the reply was under way. It goes on from the summary in an exchange of its own, which begins
        // with a message telling it to: the summary runs through the exchange it was in, message and all. Its next
        // request reads the summary, not what the last one read.
        const [message] = (await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, agentName: CARRIED, messages: [{ role: "user", content: CARRY_ON }] })).messages;
        const from = { ...resume, promptMessageId: message._id, used: { ...resume.used, tokens: 0 } };
        // A limit it reached is asked about now that the summary is written, so pausing never leaves a conversation unsummarized.
        const paused = pauseBefore(from.used);
        if (paused) {
          await ctx.db.patch("assistantThreads", threadId, { ...kept, reply: undefined, asking: pausedFrom(from, message.order, paused) });
          return null;
        }
        const lock = await goOn(from);
        await ctx.db.patch("assistantThreads", threadId, { ...kept, reply: { ...lock, order: message.order } });
        return null;
      }
      if (resume) {
        // The summary wasn't written, and stays owed. The reply goes on as it was, and is summarized after its next request.
        const paused = pauseBefore(resume.used);
        await ctx.db.patch("assistantThreads", threadId, paused ? { reply: undefined, asking: pausedFrom(resume, current.order, paused) } : { reply: await goOn(resume) });
        return null;
      }
      // A summary that was stopped, or never written, stays owed: the next reply writes it first.
      await ctx.db.patch("assistantThreads", threadId, { reply: undefined, ...(kept ?? { compactionOwed: true }) });
      return null;
    }
    const newest = (await listMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: { numItems: 1, cursor: null }, excludeToolMessages: true })).page[0];
    const written = newest?.message?.role === "assistant" && newest.order === current.order ? previewOf(newest.text ?? "") : "";
    const preview = written ? { preview: written } : {};
    const window = ended?.modelId ? (await ctx.db.get("models", ended.modelId))?.contextLength : undefined;
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
        made: asking.made,
        ...(asking.failed ? { failed: asking.failed } : {}),
        ...(asking.recent.length ? { recent: asking.recent } : {}),
        ...(asking.changes ? { changes: asking.changes } : {}),
        ...(asking.cap === undefined ? {} : { cap: asking.cap }),
        ...(asking.lap === undefined ? {} : { lap: asking.lap }),
        askedAt: now,
      };
      // A conversation as long as a request should read is owed its summary: nothing compacts it while it waits.
      await ctx.db.patch("assistantThreads", threadId, { ...preview, reply: undefined, asking: waiting, ...(compactionDue({ ...ended, window }) ? { compactionOwed: true } : {}) });
      // Stopped as it asked: the stop found nothing running, and takes effect here.
      if (current.stop) await stopAsking(ctx, thread, waiting);
      return null;
    }
    if (ended && next) {
      // The reply goes on, in an action of its own.
      const { lastInputTokens, messages: _messages, bytes: _bytes, ...turn } = ended;
      const limits = { ...(next.cap === undefined ? {} : { cap: next.cap }), ...(next.lap === undefined ? {} : { lap: next.lap }) };
      const from = { ...turn, promptMessageId: next.promptMessageId, used: { credits: next.spent, rounds: next.rounds, calls: next.made, tokens: next.tokens, failed: next.failed, recent: next.recent, ...(next.changes ? { changes: next.changes } : {}), ...(next.told ? { told: next.told } : {}), ...limits } };
      // A conversation as long as a request should read is summarized first, through what the reply
      // has written, and the reply goes on from the summary (./context.ts). A limit it has reached too
      // is asked about once the summary is written.
      if (!current.stop && compactionDue({ ...ended, window })) {
        const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.compact, { threadId, attemptId, ...turn, through: current.order, lastInputTokens, resume: from });
        // Owed from here until a summary is kept, so one that is stopped, or whose action dies, is written by the next reply.
        // The lock holds what the reply has cost so far, for its sender's record if the compaction's action dies.
        await ctx.db.patch("assistantThreads", threadId, { ...preview, compactionOwed: true, reply: { ...current, scheduledId, compacting: true, spent: next.spent } });
        return null;
      }
      // It waits to be carried on, as a reply that asked about an action waits for its answer.
      const paused = pauseBefore(from.used);
      if (paused) {
        await ctx.db.patch("assistantThreads", threadId, { ...preview, reply: undefined, asking: pausedFrom(from, current.order, paused) });
        return null;
      }
      await ctx.db.patch("assistantThreads", threadId, { ...preview, reply: await goOn(from) });
      return null;
    }
    // A reply that carried on from an answer and was stopped, or failed, on the way can leave calls it never ran.
    await settleAsked(ctx, threadId);
    // What it cost is kept among its sender's last replies. One that ended before a request of its own
    // reported in, stopped as it went on, say, has what its lock last held.
    await noteReply(ctx, current.senderId, attemptId, spent ?? current.spent ?? 0);
    // A stopped reply is left alone: whoever stopped it is waiting to write.
    if (ended && !current.stop && compactionDue({ ...ended, window })) {
      const { lastInputTokens, messages: _messages, bytes: _bytes, ...turn } = ended;
      const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.compact, { threadId, attemptId, ...turn, through: current.order, lastInputTokens });
      // Owed from here until a summary is kept, so one whose action dies is written by the next reply.
      // The reply's cost is recorded above: the lock holds none of it, so it isn't recorded again if this action dies.
      await ctx.db.patch("assistantThreads", threadId, { ...preview, compactionOwed: true, reply: { ...current, scheduledId, compacting: true, spent: 0 } });
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
      if (!(await writing(ctx, thread.reply))) await endDead(ctx, thread);
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
  /** Which of its several jobs the action did, for one that has more than one (lib/assistant/actions.ts). */
  variant: v.optional(v.string()),
  /** What it was about: a title, a name or a query from its arguments, or the title or name of what it returned. */
  subject: v.optional(v.string()),
  /** How many things it found, when its result lists any. */
  count: v.optional(v.number()),
  /** The most it holds, on a call that spends credits (#328). */
  credits: v.optional(v.number()),
  /**
   * `failed` also covers a step whose reply died while it ran. `asking`: the person is asked before it runs.
   * `allowed`: they said yes, and it runs once the reply carries on. `declined`: they said no, or stopped the reply.
   */
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("asking"), v.literal("allowed"), v.literal("declined")),
  /** Whether the person reading can answer it (`answer`): it asks, and it would run for them. */
  canAnswer: v.boolean(),
  /** What it would do, for the person who can answer it: its arguments, with the records they name by name (./details.ts). */
  details: askedDetailsValidator,
  /** On a step that asks about a bulk change: how many changes it is, and for the person who can answer it, the first of them, each as what it alone is given. */
  batch: v.optional(v.number()),
  each: askedEachValidator,
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
  /** A reply's message that also ran actions: the reply goes on after it. */
  acted: v.optional(v.boolean()),
  at: v.number(),
});

/**
 * A step's status as the chat shows it. One still running when its exchange isn't being
 * answered ended with its reply. One still asking then, or allowed and never run, wasn't run.
 */
function shownStatus(status: Doc<"assistantSteps">["status"], answering: boolean) {
  if (status === "running" && !answering) return "failed" as const;
  if ((status === "asking" || status === "allowed") && !answering) return "declined" as const;
  return status;
}

/** What a person typed: their message's first part. Where they sent it from can follow it (`send`), which only the model reads. */
function typed(row: MessageDoc) {
  const content = row.message?.content;
  if (!Array.isArray(content)) return row.text ?? "";
  const first = content[0];
  return first?.type === "text" ? first.text : "";
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

/**
 * One page of a chat's messages, with its end kept where it is. The agent component pages
 * without recording where a page ended, so a page read with no `endCursor` is so many rows
 * from its start, whatever they are: as a reply adds rows to the newest page, the ones before
 * them drop out of it, and the message it answers takes its steps along. So a page read with
 * no end says where to split, and the page that subscribes then reads each half to a fixed
 * end, the newest one growing with the chat.
 */
async function pageOf<Opts extends { numItems: number; cursor: string | null; endCursor?: string | null }>(list: (opts: Opts) => ReturnType<typeof listMessages>, opts: Opts) {
  const end = opts.endCursor;
  if (!end) {
    // One item can't be split, so a cap that stopped at it has no split to offer.
    if (opts.numItems < 2) return { ...(await list(opts)), pageStatus: null, splitCursor: null };
    const half = Math.ceil(opts.numItems / 2);
    const newer = await list({ ...opts, numItems: half });
    // Nothing is past this half, so there's nothing to split yet.
    if (newer.isDone) return newer;
    // Whether the half read its share or a cap stopped it, its last row is where the split falls.
    const older = await list({ ...opts, cursor: newer.continueCursor, numItems: opts.numItems - half });
    return { ...older, page: [...newer.page, ...older.page], splitCursor: newer.continueCursor, pageStatus: "SplitRecommended" as const };
  }
  const raw = await list(opts);
  // The component calls an empty page the last one. A page read to a fixed end is the last only when that end is the chat's.
  const read = { ...raw, isDone: raw.isDone && end === CHAT_END };
  // A cap stopped it short of its end. The halves it splits into end where it was to end, or the rows between would be in no page.
  if (read.pageStatus === "SplitRequired" && read.continueCursor !== end) return { ...read, continueCursor: end };
  if (read.pageStatus === "SplitRecommended") return read;
  // It reads whole. A page that a cap stops shows nothing until its halves load, so one that holds half of what
  // a page may read is split while it still reads whole. One row can't be split, however large.
  const whole = { ...read, pageStatus: null, splitCursor: null };
  if (read.page.length < 2 || getConvexSize(read.page as Value) < MESSAGES_PAGE_BYTES / 2) return whole;
  const middle = (await list({ ...opts, endCursor: undefined, numItems: Math.ceil(read.page.length / 2) })).continueCursor;
  return middle === read.continueCursor ? whole : { ...read, splitCursor: middle, pageStatus: "SplitRecommended" as const };
}

export const messagesAction = defineUserQuery({
  path: "assistant/replies:messages",
  description:
    "Reads an assistant chat's messages, newest first, a page at a time: what each person wrote, what the assistant replied, and each action it ran on the way. An exchange's actions come with the message they answer. With `stepsAhead`, the newest page also brings the actions of a reply whose message is on an earlier page, and they come again with that message.",
  args: { threadId: v.id("assistantThreads"), stepsAhead: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.union(messageValidator, stepValidator)),
  run: async (ctx, userId, { threadId, stepsAhead, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    // The caps bound a page whatever the caller asks for: with an `endCursor`, `numItems` alone doesn't.
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, MESSAGES_PAGE_MAX), maximumRowsRead: MESSAGES_PAGE_MAX, maximumBytesRead: MESSAGES_PAGE_BYTES };
    const list = (pageOpts: typeof opts) => listMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: pageOpts });
    const read = await pageOf(list, opts);
    const sentBy = await senders(ctx, read.page);
    // Each exchange's steps come with the message it answers, which a page holds once.
    const asked = read.page.filter((row) => row.message?.role === "user");
    // For a reader that asks (`stepsAhead`, the panel), the newest page also brings the steps of an exchange whose
    // message is on a page before it: a long reply's rows fill pages of their own, and its steps would otherwise wait
    // for the person to load back to where it began. They come with the oldest of its rows here, and again with its
    // message when that page loads, under the same IDs, which is why a reader has to ask.
    const begun = new Set(asked.map((row) => row.order));
    const cut = stepsAhead && paginationOpts.cursor === null ? [...new Map(read.page.filter((row) => !begun.has(row.order)).map((row) => [row.order, row])).values()] : [];
    const ran = new Map(await Promise.all([...asked, ...cut].map(async (row) => [row._id, await stepsOfExchange(ctx, threadId, row.order)] as const)));
    // The exchange being answered now, or waiting for the person's answer. A lock whose action died isn't one.
    const answering = (await writing(ctx, thread.reply)) ? thread.reply?.order : thread.asking?.order;
    // What each call that waits for this person would do.
    const reader = thread.asking?.senderId === userId ? await ctx.db.get("users", userId) : null;
    const mine = reader ? await stepsAt(ctx, threadId, "asking") : [];
    const details = new Map(
      await Promise.all(mine.map(async (step) => [step._id, step.batch === undefined ? { details: await detailsOf(ctx, reader!, step.shown ?? step.input) } : await bulkOf(ctx, reader!, step)] as const)),
    );
    const page = read.page.flatMap((row) => {
      const role = row.message?.role;
      // Newest first, like the page: the steps come after the message they answer, so they're listed before it.
      const steps = (ran.get(row._id) ?? []).map((step) => shownStep(step, { userId, answering, asked: details.get(step._id) })).reverse();
      // A row that isn't a message to show still brings the steps it carries.
      if (role !== "user" && role !== "assistant") return steps;
      // The message a reply summarized partway goes on from is the app's own (./context.ts). What the reply did in answer to it is the reply's.
      if (role === "user" && row.agentName === CARRIED) return steps;
      // A message of the reply that only called actions has no text of its own to show.
      if (role === "assistant" && !row.text && row.status === "success" && Array.isArray(row.message?.content) && row.message.content.some((part) => part.type === "tool-call")) return steps;
      const error = row.status === "failed" ? parseChatError(row.error) : null;
      const stopped = error?.class === "aborted";
      // A reply still pending that the chat isn't writing died with its action.
      const pending = row.status === "pending" && answering === row.order;
      const sender = role === "user" && row.userId ? sentBy.get(row.userId) : undefined;
      return [
        // Steps brought by a row of the reply itself were run before it was written, so they're listed after it.
        ...(role === "user" ? steps : []),
        {
          id: row._id,
          role,
          order: row.order,
          text: role === "user" ? typed(row) : (row.text ?? ""),
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
          ...(role === "assistant" && row.tool ? { acted: true } : {}),
          at: row._creationTime,
        },
        ...(role === "user" ? [] : steps),
      ];
    });
    return { ...read, page };
  },
});
export const messages = userQuery(messagesAction);

/**
 * Which of its several jobs a step's action did: the kind of change made to the person's
 * research records, or which way a paper moved between the library and a collection.
 */
function variantOf(step: Doc<"assistantSteps">) {
  // A bulk change keeps which job all its changes do: what it was given doesn't say it one by one.
  if (step.variant) return { variant: step.variant };
  if (!hasVariants(step.path)) return {};
  try {
    const variant = variantIn(step.path, JSON.parse(step.input));
    return variant ? { variant } : {};
  } catch {
    // Arguments too long to keep whole were cut, and don't parse.
    return {};
  }
}

/** A step as the chat's page shows it. `asked` is what a call that waits for this person would do. */
function shownStep(
  step: Doc<"assistantSteps">,
  { userId, answering, asked }: { userId: Id<"users">; answering: number | undefined; asked?: { details: NonNullable<Infer<typeof askedDetailsValidator>>; each?: NonNullable<Infer<typeof askedEachValidator>> } },
) {
  return {
    id: step._id,
    role: "step" as const,
    order: step.order,
    action: step.path,
    ...variantOf(step),
    ...(step.subject ? { subject: step.subject } : {}),
    ...(step.count === undefined ? {} : { count: step.count }),
    ...(step.credits === undefined ? {} : { credits: step.credits }),
    status: shownStatus(step.status, answering === step.order),
    ...(step.batch === undefined ? {} : { batch: step.batch }),
    canAnswer: asked !== undefined,
    ...(asked ? { details: asked.details, ...(asked.each ? { each: asked.each } : {}) } : {}),
    ...(step.error ? { error: step.error } : {}),
    canUndo: step.undo !== undefined && step.userId === userId && step.undone !== true,
    undone: step.undone === true,
    at: step.startedAt,
  };
}

export const stepsAction = defineUserQuery({
  path: "assistant/replies:steps",
  description:
    "Reads the actions the assistant ran in answer to one message of a chat, newest first, a page at a time. A chat's messages come with the newest of each exchange's steps; this reads the ones before them, when a reply ran more. A reply that was summarized partway carries on in the exchanges after its own: `through` names the last of them to read.",
  args: { threadId: v.id("assistantThreads"), order: v.number(), through: v.optional(v.number()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(stepValidator),
  run: async (ctx, userId, { threadId, order, through, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    const read = await ctx.db
      .query("assistantSteps")
      .withIndex("by_thread_and_order", (q) => q.eq("threadId", threadId).gte("order", order).lte("order", through ?? order))
      .order("desc")
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, STEPS_SHOWN) });
    const answering = (await writing(ctx, thread.reply)) ? thread.reply?.order : thread.asking?.order;
    // A step that waits for the person is among the newest, which come with the chat's messages, where what it would do is shown.
    return { ...read, page: read.page.map((step) => shownStep(step, { userId, answering })) };
  },
});
export const steps = userQuery(stepsAction);
export const stepsForAssistant = assistantQuery(stepsAction);
export const messagesForAssistant = assistantQuery(messagesAction);

/** The text and visible activity of the current model step. */
async function textSoFar(ctx: QueryCtx, agentThreadId: string, streamId: string) {
  let text = "";
  let writing = false;
  let cursor = 0;
  for (let reads = 0; reads < LIVE_READS; reads++) {
    const deltas = await ctx.runQuery(components.agent.streams.listDeltas, { threadId: agentThreadId, cursors: [{ streamId, cursor }] });
    for (const delta of deltas) {
      for (const part of delta.parts) {
        // One stream runs through every step of a reply. Each step's text becomes a message of
        // its own once the step ends, so only the step being written is still live.
        if (part?.type === "start-step") {
          text = "";
          writing = false;
        } else if (part?.type === "text-delta" && typeof part.delta === "string") {
          text += part.delta;
          writing = true;
          // It has gone on from its text to a call's arguments, to reasoning, or to the end of the step.
        } else if (typeof part?.type === "string" && (part.type.startsWith("tool-") || part.type === "finish-step" || part.type === "reasoning-start")) writing = false;
      }
      cursor = delta.end;
    }
    if (deltas.length < DELTAS_PER_READ) break;
  }
  return { text, writing };
}

/**
 * What the assistant is doing in a chat, or how its last reply ended, for its mark to show
 * (lib/assistant/activity.ts). `order` is the exchange it is about, when there is one.
 */
const activityValidator = v.object({
  phase: v.union(v.literal("idle"), v.literal("thinking"), v.literal("searching"), v.literal("writing"), v.literal("waiting"), v.literal("stopping"), v.literal("complete"), v.literal("failed"), v.literal("stopped")),
  order: v.union(v.number(), v.null()),
});

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
      /** The reply waits for the person: to answer what it asked, or to carry it on from a pause. Stop ends it. */
      asking: v.boolean(),
      /** Why it paused, when it did (./spending.ts). */
      paused: v.union(v.null(), assistantPausedValidator),
      /**
       * For the person it answers alone, whose credits it spends: what its requests have cost so
       * far, and the credits it pauses at when they set a limit.
       */
      spent: v.optional(v.number()),
      cap: v.optional(v.number()),
      text: v.string(),
      /** What it is doing now: thinking, searching, writing, waiting for the person, or stopping. */
      activity: activityValidator,
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const userId: Id<"users"> = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    // A reply that waits for an answer isn't being written, and Stop ends it.
    /** What a reply has cost and may cost is its sender's to see. */
    const spending = (of: { senderId: Id<"users">; spent?: number; cap?: number }) => (of.senderId === userId ? { spent: of.spent ?? 0, ...(of.cap === undefined ? {} : { cap: of.cap }) } : {});
    if (thread.asking) {
      return {
        attemptId: waitingAttempt(thread.asking),
        senderId: thread.asking.senderId,
        order: thread.asking.order,
        startedAt: thread.asking.askedAt,
        stopping: false,
        compacting: false,
        asking: true,
        paused: thread.asking.paused ?? null,
        ...spending(thread.asking),
        text: "",
        activity: { phase: "waiting" as const, order: thread.asking.order },
      };
    }
    const current = thread.reply;
    if (!current || !(await writing(ctx, current))) return null;
    // Newest first. A request's stream finishes in the write that saves its message, so one
    // that has finished has nothing the page doesn't hold already. Between two of a reply's
    // requests there is none, and the text is empty.
    const streams = await listStreams(ctx, components.agent, {
      threadId: thread.agentThreadId,
      startOrder: current.order,
      includeStatuses: ["streaming", "aborted"],
    });
    const stream = streams.find((candidate) => candidate.order === current.order);
    const output = stream ? await textSoFar(ctx, thread.agentThreadId, stream.streamId) : { text: "", writing: false };
    const running = await ctx.db
      .query("assistantSteps")
      .withIndex("by_thread_order_status", (q) => q.eq("threadId", threadId).eq("order", current.order).eq("status", "running"))
      .take(STEPS_SHOWN);
    const searching = running.some((step) => actionView(step.path).searching);
    const phase = current.stop ? ("stopping" as const) : current.compacting ? ("thinking" as const) : searching ? ("searching" as const) : running.length ? ("thinking" as const) : output.writing ? ("writing" as const) : ("thinking" as const);
    return {
      attemptId: current.attemptId,
      senderId: current.senderId,
      order: current.order,
      startedAt: current.startedAt,
      stopping: current.stop === true,
      compacting: current.compacting === true,
      asking: false,
      paused: null,
      ...spending(current),
      text: output.text,
      activity: { phase, order: current.order },
    };
  },
});

/**
 * How a chat's last reply ended, for the assistant's mark while none is being written: it
 * reads one message, not the conversation. `live` says what a reply at work is doing.
 */
export const outcome = query({
  args: { threadId: v.id("assistantThreads") },
  returns: activityValidator,
  handler: async (ctx, { threadId }) => {
    const userId: Id<"users"> = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId);
    // The newest message a person or the assistant wrote. A reply's last can also hold a call, and results come after
    // the call they answer, so a few rows are read and the results passed over.
    const rows = (await listMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: { numItems: OUTCOME_ROWS, cursor: null, maximumRowsRead: OUTCOME_ROWS, maximumBytesRead: MESSAGES_PAGE_BYTES } })).page;
    const newest = rows.find((row) => row.message?.role === "assistant" || row.message?.role === "user");
    // A message with no reply to it: the reply failed before it wrote anything. So did one that was summarized and never carried on.
    if (newest?.message?.role === "user") return { phase: "failed" as const, order: newest.order };
    if (newest?.message?.role !== "assistant") return { phase: "idle" as const, order: null };
    const stopped = newest.status === "failed" && parseChatError(newest.error)?.class === "aborted";
    return { phase: stopped ? ("stopped" as const) : newest.status === "success" && newest.text?.trim() ? ("complete" as const) : ("failed" as const), order: newest.order };
  },
});
