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
import { capReached, spendingRoom } from "../billing/memberCaps";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { readLibraryRole } from "../evidenceLibraries/access";
import { communityOf } from "../evidenceLibraries/submissions";
import { ADDED_PAPERS_MAX } from "../../lib/evidence-libraries/added-papers";
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
import { planLimit } from "../billing/accounts";
import { replyWorkspace, requireThread, roleIn, touchThread } from "./access";
import { personName } from "../lib/people";
import { actorIn, personalWorkspaceOf } from "../workspaces/actor";
import { assistant } from "./agent";
import { CARRIED, CARRY_ON, compactionDue } from "./context";
import { JOB_ENDED } from "./jobEnds";
import { bulkOf, detailsOf } from "./details";
import { opensOf } from "./links";
import { TOOL_OF, allowAlways, allowTool, carriedOn, covers, noteReply, pausedAt, replyLimitOf } from "./spending";
import { MAX_ASKS, STEPS_SHOWN, aboutOf, declineSteps, healCalls, settleAsked, stepsAt, stepsOfExchange, stopAsking } from "./steps";
import { chatModel, previewOf, requireAssistantModel, writing } from "./threads";
import { filesOf, partsFor, sent } from "./files";
import { readsImages, readsPdfs } from "../../lib/assistant/files";
import { stripProviderPrefix } from "../../lib/ai/model-display";
import { askedDetailsValidator, askedEachValidator, askedPapersValidator, assistantPausedValidator, attachedFilesValidator, jobsEndedValidator, JOBS_TOLD_AT_ONCE, sentFileIdsValidator, webSourcesValidator } from "./validators";
import { searchHref } from "../research/searches";
import { searchSettings } from "../research/searchValidators";

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
 * Refuses a reply that would be one too many being written in a workspace at once: as many
 * as its plan allows (#632; one pool per workspace since #650, as Firecrawl counts a team's),
 * and never more than its share of the deployment's actions. A reply that waits for an
 * answer runs nothing and isn't one of them; carrying it on is.
 */
export async function admit(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const plan = await planLimit(ctx, workspaceId, "assistant_replies");
  const most = Math.min(ASSISTANT_REPLIES_AT_ONCE, plan ?? ASSISTANT_REPLIES_AT_ONCE);
  // Twice the deployment's share, whatever the plan: locks whose action died can't hide live
  // ones behind them. The dead ones found are released here, which keeps the next count honest too.
  const mine = await ctx.db
    .query("assistantThreads")
    .withIndex("by_replyWorkspace", (q) => q.eq("reply.workspaceId", workspaceId))
    .take(ASSISTANT_REPLIES_AT_ONCE * 2);
  let stillWriting = 0;
  for (const other of mine) {
    if (await writing(ctx, other.reply)) stillWriting++;
    else await endDead(ctx, other);
  }
  if (stillWriting >= most) {
    throw createError("CONFLICT", most < ASSISTANT_REPLIES_AT_ONCE
      ? `Your plan lets the assistant write ${most} ${most === 1 ? "reply" : "replies"} for you at once. Wait for one to finish.`
      : `The assistant is already writing ${most} replies for you. Wait for one to finish.`);
  }
}

/** Clears the lock of a reply whose action died. What it had cost by then is still one of its sender's last replies. */
async function endDead(ctx: MutationCtx, thread: Doc<"assistantThreads">) {
  if (thread.reply) await noteReply(ctx, thread.reply.senderId, thread.reply.workspaceId, thread.reply.attemptId, thread.reply.spent ?? 0);
  await ctx.db.patch("assistantThreads", thread._id, { reply: undefined });
}

export const send = mutation({
  // `view`: the address of the page the message is sent from, its path and parameters. `files`: what the person attached to it (./files.ts).
  args: { threadId: v.id("assistantThreads"), text: v.string(), view: v.optional(v.string()), files: sentFileIdsValidator },
  returns: v.null(),
  handler: async (ctx, { threadId, text, view: address, files = [] }) => {
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
    const workspaceId = await replyWorkspace(ctx, userId, thread);
    await admit(ctx, workspaceId);
    // The model reads what the person attached with the message: images as they are, PDFs a range of pages at a time.
    const attached = files.length ? await partsFor(ctx, userId, files) : { parts: [], images: false, pdfs: false };
    const images = attached.parts;
    if (attached.images || attached.pdfs) {
      const { modelId } = await chatModel(ctx, thread, userId);
      const model = modelId ? await ctx.db.get("models", modelId) : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
      const name = model ? stripProviderPrefix(model.name) : "This chat's model";
      if (attached.images && !readsImages(model?.inputModalities)) throw createError("VALIDATION_ERROR", `${name} can't read images. Pick another model for this chat to send them.`);
      if (attached.pdfs && !readsPdfs(model?.inputModalities)) throw createError("VALIDATION_ERROR", `${name} can't read PDFs. Pick another model for this chat to send them.`);
    }
    // A reply that was stopped, or died, around asking the person can leave calls without their results.
    await settleAsked(ctx, threadId);
    await healCalls(ctx, thread.agentThreadId);

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
      if (!step) continue;
      // What the change was, how many it made, what it was about, and how putting a bulk one back went: still at it, or what of it stayed (./bulk.ts).
      const { variant } = variantOf(step);
      undone.push([variant ? `${step.path}#${variant}` : step.path, step.batch === undefined ? null : `${step.count ?? step.batch} changes`, step.subject, step.reverting ? "still being put back" : step.error].filter(Boolean).join(", "));
    }
    const more = (thread.undoneMore ?? []).find((entry) => entry.userId === userId)?.count;
    if (more) undone.push(`and ${more} before these`);
    const { messageId, message } = await assistant.saveMessage(ctx, {
      threadId: thread.agentThreadId,
      userId,
      // What this person undid goes with their message, whether or not the place changed. Their words come first, which is what the chat shows (`typed`).
      ...(moved || undone.length || images.length
        ? { message: { role: "user" as const, content: [{ type: "text" as const, text }, ...images, ...(moved || undone.length ? [{ type: "text" as const, text: notePart({ page: view ?? undefined, today, chat: threadId, undone }) }] : [])] } }
        : { prompt: text }),
      skipEmbeddings: true,
    });
    if (files.length) await sent(ctx, files, { threadId, messageId });
    if (mine.length || more) {
      const counts = (thread.undoneMore ?? []).filter((entry) => entry.userId !== userId);
      await ctx.db.patch("assistantThreads", threadId, { undone: others.length ? others : undefined, undoneMore: counts.length ? counts : undefined });
    }
    // A chat made before it had a message, to share it or to set what it may spend, is named by its first.
    // ponytail: told apart by its title alone, so a chat renamed to exactly the default before its first message is named over. A flag on the chat for "named by hand" if that ever matters.
    const title = thread.preview === undefined && thread.title === NEW_CHAT_TITLE ? titleFrom(text) : "";
    await startReply(ctx, thread, userId, workspaceId, { messageId, order: message.order }, { ...(title ? { title } : {}), preview: previewOf(text), ...(moved ? { view: { ...((view ?? said?.address) === undefined ? {} : { address: view ?? said?.address }), day: today, userId, order: message.order } } : {}) });
    return null;
  },
});

/**
 * Starts a reply to a message saved in the chat, as `userId` acting in `workspaceId`
 * (`replyWorkspace`), under the chat's lock: on the model the chat runs for them, within what
 * they let a reply spend here. `patch` goes to the chat with the lock. The caller has
 * admitted the reply (`admit`) and settled what the last one left (`settleAsked`, `healCalls`).
 */
export async function startReply(ctx: MutationCtx, thread: Doc<"assistantThreads">, userId: Id<"users">, workspaceId: Id<"workspaces">, { messageId, order }: { messageId: string; order: number }, patch: Partial<Doc<"assistantThreads">> = {}) {
  const { modelId, effort } = await chatModel(ctx, thread, userId);
  // The model the chat falls back on, or one picked before the rule, is held to it too. So is
  // the server's own default, which runs when nothing picks a model, where the catalog has it.
  const model = modelId
    ? await requireAvailableModel(ctx, modelId)
    : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
  if (model) requireAssistantModel(model);
  const now = Date.now();
  const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
  await touchThread(ctx, thread._id, now);
  // What the sender lets a reply spend here, if they set a limit (./spending.ts). Taken with the message, like its model.
  const cap = await replyLimitOf(ctx, thread._id, userId);
  const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, {
    threadId: thread._id,
    agentThreadId: thread.agentThreadId,
    promptMessageId: messageId,
    attemptId,
    senderId: userId,
    workspaceId,
    // Taken when the message is sent, so a later change only affects the next reply.
    modelId,
    // An effort the catalog has since dropped runs at the model's default.
    effort: effort && model?.reasoningEfforts?.includes(effort) ? effort : undefined,
    ...(cap === undefined ? {} : { used: { credits: 0, rounds: 0, calls: 0, cap } }),
  });
  await ctx.db.patch("assistantThreads", thread._id, { ...patch, reply: { attemptId, senderId: userId, workspaceId, order, startedAt: now, scheduledId, spent: 0, ...(cap === undefined ? {} : { cap }) } });
}

/** What Stop takes for a reply that waits for an answer: no reply is being written then, so it has no attempt of its own. */
const waitingPrefix = (order: number) => `waiting:${order}:`;
const waitingAttempt = (waiting: { order: number; askedAt: number }) => `${waitingPrefix(waiting.order)}${waiting.askedAt}`;

/** The person's answer to a call the assistant asked about (./steps.ts): run it, or don't. */
/** Adding papers to a community, whose ask lets the person choose where they go (components/assistant/add-papers-ask.tsx). */
const ADD_PAPERS = "evidenceLibraries/assistant:addPapers";

/** A string an argument gives, or null. */
const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * What a paused call to add papers to a community asks, for its card: the community as Add to community shows it,
 * the papers as the call names them, where the assistant meant them to go, and whether the person may publish there.
 * Only for the person it waits on.
 */
export const askedPapers = query({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps") },
  returns: v.union(v.null(), askedPapersValidator),
  handler: async (ctx, { threadId, stepId }) => {
    const person = await requireAuth(ctx);
    await requireThread(ctx, person._id, threadId, "read");
    const step = await ctx.db.get("assistantSteps", stepId);
    if (!step || step.threadId !== threadId || step.userId !== person._id || step.path !== ADD_PAPERS || step.status !== "asking") return null;
    // Arguments too long to keep whole were cut, and don't parse: such a call is asked about with the plain card.
    let args: { libraryId?: unknown; publish?: unknown; papers?: unknown };
    try {
      args = JSON.parse(step.input) as typeof args;
    } catch {
      return null;
    }
    if (typeof args.libraryId !== "string" || !Array.isArray(args.papers)) return null;
    const papers = (args.papers as Array<Record<string, unknown>>).map((paper) => ({ openalexId: text(paper?.openalexId), doi: text(paper?.doi), link: text(paper?.link) }));
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    const library = libraryId ? await ctx.db.get("evidenceLibraries", libraryId) : null;
    if (!library) return null;
    const role = await readLibraryRole(ctx, library, person.clerkId);
    const { name, faviconUrl, owner } = await communityOf(ctx, library._id);
    return {
      libraryId: library._id,
      publish: args.publish === true,
      canPublish: role === "owner" || role === "editor",
      papers: papers.slice(0, ADDED_PAPERS_MAX),
      community: { name, faviconUrl, owner },
    };
  },
});

export const answer = mutation({
  // `stepIds`: the calls of one action the reply asked about together, answered as one (lib/assistant/step-cards.ts `askedGroups`).
  // `always`, with a yes to calls that spend credits: jobs that hold no more run in this chat without asking from now on (./spending.ts).
  // `publish`, with a yes to adding papers to a community: where the person chose they go, live or to its review queue, whatever the assistant asked.
  args: { threadId: v.id("assistantThreads"), stepIds: v.array(v.id("assistantSteps")), allow: v.boolean(), always: v.optional(v.boolean()), publish: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { threadId, stepIds, allow, always, publish }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "write");
    const waiting = thread.asking;
    if (!waiting) throw createError("CONFLICT", "This has already been answered.");
    const ids = [...new Set(stepIds)];
    if (!ids.length || ids.length > MAX_ASKS) throw createError("VALIDATION_ERROR", `Answer between 1 and ${MAX_ASKS} calls at once.`);
    const steps: Doc<"assistantSteps">[] = [];
    for (const id of ids) {
      const step = await ctx.db.get("assistantSteps", id);
      if (!step || step.threadId !== threadId) throw createError("NOT_FOUND", "That step isn't in this chat.");
      if (step.order !== waiting.order || step.status !== "asking") throw createError("CONFLICT", "This has already been answered.");
      // It would run with their access, on their records, so the answer is theirs alone.
      if (step.userId !== userId) throw createError("FORBIDDEN", "Only the person the assistant is answering can allow this.");
      steps.push(step);
    }
    const answered = new Set<Id<"assistantSteps">>(ids);
    let left = (await stepsAt(ctx, threadId, "asking")).filter((other) => !answered.has(other._id));
    // A yes to calls that hold more than the person has starts nothing: they wait while they add credits, as their card says.
    // The workspace the reply acts in pays for them, within the person's cap there.
    const held = steps.filter((step) => step.credits !== undefined);
    const credits = held.reduce((sum, step) => sum + step.credits!, 0);
    const { available: balance, capped } = allow && held.length ? await spendingRoom(ctx, waiting.workspaceId, userId) : { available: 0, capped: false };
    if (allow && held.length && credits > balance) throw capped ? capReached(credits) : createError("INSUFFICIENT_CREDITS", "There aren't enough credits for this yet. Add credits, then allow it.");
    const tool = TOOL_OF[steps[0].path];
    // What else waits is allowed with them only while the balance covers these calls and each one allowed before it.
    let room = balance - credits;
    const fits = (more: number) => more <= room && ((room -= more), true);
    if (allow && always && tool) {
      // A web search or a PDF read is allowed by its own switch, and so is whatever else waits of the same kind.
      await allowTool(ctx, threadId, userId, tool, true);
      const covered = left.filter((other) => TOOL_OF[other.path] === tool && fits(other.credits ?? 0));
      for (const other of covered) await ctx.db.patch("assistantSteps", other._id, { status: "allowed" });
      left = left.filter((other) => !covered.includes(other));
    } else if (allow && always && held.length) {
      // As opencode's "always" does for a session: the rule is kept, and what else waits that it now covers is allowed with it.
      const allowance = await allowAlways(ctx, threadId, userId, Math.max(...held.map((step) => step.credits!)));
      const covered = left.filter((other) => other.credits !== undefined && !TOOL_OF[other.path] && covers(allowance, other.credits, room) && fits(other.credits));
      for (const other of covered) await ctx.db.patch("assistantSteps", other._id, { status: "allowed" });
      left = left.filter((other) => !covered.includes(other));
    }
    // It asked with its limit already reached: the last answer starts nothing, and the reply waits to be carried on.
    const paused = left.length ? null : pausedAt(waiting);
    // The answer that lets the reply carry on starts a reply, so it's held to how many a workspace has at once, before anything changes.
    // It carries on in the workspace it asked from; its actions are refused there if the sender has left it since.
    const workspaceId = waiting.workspaceId;
    if (!left.length && !paused) await admit(ctx, workspaceId);
    if (allow) for (const step of steps) await ctx.db.patch("assistantSteps", step._id, { status: "allowed", ...(publish !== undefined && step.path === ADD_PAPERS ? { input: JSON.stringify({ ...(JSON.parse(step.input) as object), publish }) } : {}) });
    else await declineSteps(ctx, steps);
    // Calls it asked about together are answered card by card. The reply carries on after the last.
    if (left.length) return null;
    // The answers are kept, and it runs what was allowed once it's carried on: answering a question isn't agreeing to spend more.
    if (paused) {
      await ctx.db.patch("assistantThreads", threadId, { asking: { ...waiting, paused } });
      return null;
    }
    await goOnFrom(ctx, thread, waiting, workspaceId, { ...(waiting.cap === undefined ? {} : { cap: waiting.cap }), ...(waiting.lap === undefined ? {} : { lap: waiting.lap }) });
    return null;
  },
});

/** Starts a reply that waited again, from where it stood, in `workspaceId`, with the limits it now runs to. */
async function goOnFrom(ctx: MutationCtx, thread: Doc<"assistantThreads">, waiting: NonNullable<Doc<"assistantThreads">["asking"]>, workspaceId: Id<"workspaces">, limits: { cap?: number; lap?: number }) {
  const now = Date.now();
  const attemptId = `${now}:${Math.random().toString(36).slice(2)}`;
  const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.reply, {
    threadId: thread._id,
    agentThreadId: thread.agentThreadId,
    promptMessageId: waiting.promptMessageId,
    attemptId,
    senderId: waiting.senderId,
    workspaceId,
    modelId: waiting.modelId,
    effort: waiting.effort,
    used: { credits: waiting.spent, rounds: waiting.rounds, calls: waiting.made, ...(waiting.failed ? { failed: waiting.failed } : {}), ...(waiting.recent ? { recent: waiting.recent } : {}), ...(waiting.changes ? { changes: waiting.changes } : {}), ...(waiting.download ? { download: waiting.download } : {}), ...limits },
  });
  await ctx.db.patch("assistantThreads", thread._id, {
    asking: undefined,
    reply: { attemptId, senderId: waiting.senderId, workspaceId, order: waiting.order, startedAt: now, scheduledId, spent: waiting.spent, ...(limits.cap === undefined ? {} : { cap: limits.cap }) },
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
    // Carrying it on starts a reply, so it's held to how many a workspace has at once.
    const workspaceId = waiting.workspaceId;
    await admit(ctx, workspaceId);
    await goOnFrom(ctx, thread, waiting, workspaceId, carriedOn(waiting, await replyLimitOf(ctx, threadId, userId)));
    return null;
  },
});

export const lockArgs = { threadId: v.id("assistantThreads"), attemptId: v.string() };

// `workspaceId`: the one the reply acts in and pays from; absent on one scheduled before replies named theirs (#650), until slice 8.
export const turnArgs = { agentThreadId: v.string(), senderId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), modelId: v.union(v.id("models"), v.null()), effort: v.optional(effortValidator) };

/**
 * Where a reply stands after its requests so far: the credits they cost, how many they were,
 * the actions they called, the input tokens the last of them read, how many of them in a
 * row had every action fail, the digests of what the last few did (./tools.ts), why its
 * actions were refused in the last one, when they were, and the credits and the requests
 * it pauses at (./spending.ts), how many times its next request has been made again after
 * failing, and whether its papers' PDFs are downloaded to be sent (./run.ts).
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
  retries: v.optional(v.number()),
  download: v.optional(v.literal(true)),
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
      // A request waiting to be made again hears the Stop now, not when its wait ends: it runs at once, and ends there stopped (./run.ts).
      const waiting = await ctx.db.system.get("_scheduled_functions", thread.reply.scheduledId);
      const now = waiting?.state.kind === "pending" && waiting.scheduledTime > Date.now() && waiting.name.endsWith("run:reply") ? waiting : null;
      if (now) await ctx.scheduler.cancel(now._id);
      const scheduledId = now ? await ctx.scheduler.runAfter(0, internal.assistant.run.reply, now.args[0]) : thread.reply.scheduledId;
      await ctx.db.patch("assistantThreads", threadId, { reply: { ...thread.reply, stop: true, scheduledId } });
    } else return null;
    // Stop drops what the chat would have gone on to: every job that ended before it is told with no readout (./jobs.ts).
    // A job that ends after it is told as usual, and a job still running keeps going, with its own Cancel.
    await ctx.db.patch("assistantThreads", threadId, { stoppedAt: Date.now() });
    return null;
  },
});

/**
 * Where a reply's lock stands: still its own (`writing`), to be stopped (`stop`), or gone with its
 * chat or to another reply (`gone`). It is stopped by someone, or because its sender can no longer
 * write in the chat: their account isn't active, the chat was taken back from them, or its
 * workspace closed (./access.ts). They couldn't stop it themselves by then, and it runs on their
 * credits.
 */
export const lockState = internalQuery({
  args: lockArgs,
  returns: v.union(v.literal("writing"), v.literal("stop"), v.literal("gone")),
  handler: async (ctx, { threadId, attemptId }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    const current = thread?.reply;
    if (!thread || current?.attemptId !== attemptId) return "gone" as const;
    if (current.stop) return "stop" as const;
    const sender = await ctx.db.get("users", current.senderId);
    const role = sender?.state === "active" ? await roleIn(ctx, sender, thread) : null;
    return role === "owner" || role === "write" ? ("writing" as const) : ("stop" as const);
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
        calls: v.array(v.object({ toolCallId: v.string(), tool: v.string(), path: v.string(), input: v.string(), subject: v.optional(v.string()), credits: v.optional(v.number()), shown: v.optional(v.string()), batch: v.optional(v.number()), variant: v.optional(v.string()), outside: v.optional(v.literal(true)), undoable: v.optional(v.literal(true)) })),
        spent: v.number(),
        rounds: v.number(),
        made: v.number(),
        failed: v.number(),
        recent: v.array(v.string()),
        changes: v.optional(v.record(v.string(), v.number())),
        cap: v.optional(v.number()),
        lap: v.optional(v.number()),
        download: v.optional(v.literal(true)),
      }),
    ),
    // The reply's request ended on actions that ran (./turn.ts): their results go back to the model in
    // its next request, with what the reply has used so far. Or it failed, and is made again after `wait` ms.
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
        retries: v.optional(v.number()),
        download: v.optional(v.literal(true)),
        wait: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, attemptId, ended, spent, summarized, asking, next, resume }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    if (thread?.reply?.attemptId !== attemptId) return null;
    const current = thread.reply;
    /** Schedules the reply's next request, under the same lock. One stopped meanwhile finds that out there, and shows as stopped. */
    const goOn = async ({ used, ...from }: Infer<typeof resumeValidator>, wait = 0) => {
      const { compacting: _compacting, ...lock } = current;
      const workspaceId = current.workspaceId;
      const scheduledId = await ctx.scheduler.runAfter(wait, internal.assistant.run.reply, { threadId, attemptId, ...from, workspaceId, used });
      const { cap: _cap, ...held } = lock;
      return { ...held, workspaceId, scheduledId, spent: used.credits, ...(used.cap === undefined ? {} : { cap: used.cap }) };
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
      workspaceId: current.workspaceId,
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
      ...(used.download ? { download: used.download } : {}),
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
        // Named as a step that runs is named: by the record its arguments give by ID, such as the extraction it would stop.
        const subject = call.subject ?? (await aboutOf(ctx, { userId: current.senderId, workspaceId: current.workspaceId }, call.input));
        await ctx.db.insert("assistantSteps", { threadId, order: current.order, userId: current.senderId, workspaceId: current.workspaceId, ...call, ...(subject ? { subject } : {}), prompt: asking.promptMessageId, status: "asking", startedAt: now });
      }
      const waiting = {
        senderId: current.senderId,
        workspaceId: current.workspaceId,
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
        ...(asking.download ? { download: asking.download } : {}),
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
      const from = { ...turn, promptMessageId: next.promptMessageId, used: { credits: next.spent, rounds: next.rounds, calls: next.made, tokens: next.tokens, failed: next.failed, recent: next.recent, ...(next.changes ? { changes: next.changes } : {}), ...(next.told ? { told: next.told } : {}), ...(next.retries ? { retries: next.retries } : {}), ...(next.download ? { download: next.download } : {}), ...limits } };
      // A conversation as long as a request should read is summarized first, through what the reply
      // has written, and the reply goes on from the summary (./context.ts). A limit it has reached too
      // is asked about once the summary is written.
      // A request made again after failing added nothing to summarize, and keeps its wait: the next one that answers is summarized after.
      if (!current.stop && !next.retries && compactionDue({ ...ended, window })) {
        const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.compact, { threadId, attemptId, ...turn, workspaceId: current.workspaceId, through: current.order, lastInputTokens, resume: from });
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
      await ctx.db.patch("assistantThreads", threadId, { ...preview, reply: await goOn(from, next.wait) });
      return null;
    }
    // A reply that carried on from an answer and was stopped, or failed, on the way can leave calls it never ran.
    await settleAsked(ctx, threadId);
    // What it cost is kept among its sender's last replies. One that ended before a request of its own
    // reported in, stopped as it went on, say, has what its lock last held.
    await noteReply(ctx, current.senderId, current.workspaceId, attemptId, spent ?? current.spent ?? 0);
    // A stopped reply is left alone: whoever stopped it is waiting to write.
    if (ended && !current.stop && compactionDue({ ...ended, window })) {
      const { lastInputTokens, messages: _messages, bytes: _bytes, ...turn } = ended;
      const scheduledId = await ctx.scheduler.runAfter(0, internal.assistant.run.compact, { threadId, attemptId, ...turn, workspaceId: current.workspaceId, through: current.order, lastInputTokens });
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
  /** Its action only reads. */
  reads: v.optional(v.literal(true)),
  /** On a step that only reads: the reply's request it was called in. Calls made together share one. */
  request: v.optional(v.number()),
  /** Which of its several jobs the action did, for one that has more than one (lib/assistant/actions.ts). */
  variant: v.optional(v.string()),
  /** What it was about: a title, a name or a query from its arguments, or the title or name of what it returned. */
  subject: v.optional(v.string()),
  /** Where it leads, in the app: the results of what it looked up, by a query or by filters alone, as a new search. */
  href: v.optional(v.string()),
  /** The page of the one record it acted on, such as the extraction it paused, which its subject opens. */
  opens: v.optional(v.string()),
  /** How many things it found, when its result lists any. */
  count: v.optional(v.number()),
  /** On a web search (#648): the pages it found, which the reply cites. */
  sources: webSourcesValidator,
  /** The most it holds, on a call that spends credits (#328). */
  credits: v.optional(v.number()),
  /** On a call that asks first: other people see what it does. With `undoable`, that is the only reason it asks; without, it can't be undone either. Neither: it asks because it can't be undone. */
  outside: v.optional(v.literal(true)),
  undoable: v.optional(v.literal(true)),
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
  /** Its undo reaches outside the account, and runs on its own (./undo.ts `runAction`). */
  undoAction: v.optional(v.literal(true)),
  undone: v.boolean(),
  at: v.number(),
});

/** The app's message that tells the chat jobs its replies started have ended (./jobEnds.ts): which, and how each ended. The reply to it is the assistant's readout. */
const eventValidator = v.object({
  id: v.string(),
  role: v.literal("event"),
  order: v.number(),
  ended: jobsEndedValidator,
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
  /** Who sent it, on a person's message. Their name is empty when they gave none; their photo, when they have one. */
  sender: v.optional(v.object({ userId: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) })),
  /** Whether the person reading sent it. */
  mine: v.boolean(),
  /** The model that wrote it, on a reply. */
  model: v.optional(v.string()),
  /** A reply's message that also ran actions: the reply goes on after it. */
  acted: v.optional(v.boolean()),
  /** What a person's message carried (./files.ts). */
  files: attachedFilesValidator,
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

/** Who sent a message, for the people a page of messages names: someone whose account is gone by the name their tombstone keeps. */
async function senders(ctx: QueryCtx, rows: MessageDoc[]) {
  const ids = [...new Set(rows.flatMap((row) => (row.message?.role === "user" && row.userId ? [row.userId] : [])))];
  const people = await Promise.all(
    ids.map(async (id) => {
      const userId = ctx.db.normalizeId("users", id);
      const person = userId && (await ctx.db.get("users", userId));
      if (person) return [[id, { userId: person._id, name: personName(person), ...(person.avatarUrl ? { imageUrl: person.avatarUrl } : {}) }] as const];
      const gone = userId && (await ctx.db.query("clerkDeletedUsers").withIndex("by_userId", (q) => q.eq("userId", userId)).unique());
      return userId && gone?.name ? [[id, { userId, name: gone.name }] as const] : [];
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
  returns: paginationResultValidator(v.union(messageValidator, stepValidator, eventValidator)),
  run: async (ctx, { userId }, { threadId, stepsAhead, paginationOpts }) => {
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
    // They're named as the workspace the reply acts in calls them, while the reader can still act there.
    const acting = thread.asking && reader ? thread.asking.workspaceId : null;
    const workspaceId = acting && reader && (await actorIn(ctx, reader, acting)) ? acting : null;
    const details = new Map(
      await Promise.all(mine.map(async (step) => [step._id, step.batch === undefined ? { details: withoutVariant(await detailsOf(ctx, reader!, workspaceId, step.shown ?? step.input), step) } : bulkWithoutVariant(await bulkOf(ctx, reader!, workspaceId, step), step)] as const)),
    );
    // What each person's message carried: images as parts of it, PDFs as notes the model reads them by.
    const attached = new Map(
      await Promise.all(
        asked.filter((row) => Array.isArray(row.message?.content) && row.message.content.length > 1).map(async (row) => [row._id, await filesOf(ctx, row._id)] as const),
      ),
    );
    // The jobs each of the app's job-ended messages told the chat of.
    const told = new Map<string, Doc<"assistantJobEnds">[]>(
      await Promise.all(
        read.page
          .filter((row) => row.message?.role === "user" && row.agentName === JOB_ENDED)
          .map(async (row) => [row._id, await ctx.db.query("assistantJobEnds").withIndex("by_thread_and_order", (q) => q.eq("threadId", threadId).eq("order", row.order)).take(JOBS_TOLD_AT_ONCE)] as const),
      ),
    );
    const page = read.page.flatMap((row): Array<Infer<typeof messageValidator> | Infer<typeof stepValidator> | Infer<typeof eventValidator>> => {
      const role = row.message?.role;
      // Newest first, like the page: the steps come after the message they answer, so they're listed before it.
      const steps = (ran.get(row._id) ?? []).map((step) => shownStep(step, { userId, answering, asked: details.get(step._id) })).reverse();
      // A row that isn't a message to show still brings the steps it carries.
      if (role !== "user" && role !== "assistant") return steps;
      // The message a reply summarized partway goes on from is the app's own (./context.ts). What the reply did in answer to it is the reply's.
      if (role === "user" && row.agentName === CARRIED) return steps;
      // The app told the chat its jobs ended: an event, and the reply to it is the readout.
      if (role === "user" && row.agentName === JOB_ENDED) {
        const ended = (told.get(row._id) ?? []).map(({ kind, jobId, status, stepId }) => ({ kind, jobId, status, stepId }));
        return [...steps, { id: row._id, role: "event" as const, order: row.order, ended, at: row._creationTime }];
      }
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
          ...(attached.get(row._id)?.length ? { files: attached.get(row._id) } : {}),
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
/** A call's details without the `kind` that only says which of its jobs it does, which its card's title already says. */
function withoutVariant(details: Array<{ name: string; value: string }>, step: Doc<"assistantSteps">) {
  const { variant } = variantOf(step);
  return variant ? details.filter((detail) => !(detail.name === "kind" && detail.value === variant)) : details;
}

/** A bulk change's details, shared and each, without that `kind` either. */
function bulkWithoutVariant(bulk: { details: Array<{ name: string; value: string }>; each: Array<Array<{ name: string; value: string }>> }, step: Doc<"assistantSteps">) {
  return { details: withoutVariant(bulk.details, step), each: bulk.each.map((change) => withoutVariant(change, step)) };
}

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

/** The actions that look papers up by a query and settings, without saving a search. */
const LOOKUPS = new Set(["research/papers:search", "research/papers:count"]);

/** Where a step that looked papers up leads: the results of its query and settings, opened as a new search. */
function hrefOf(step: Doc<"assistantSteps">) {
  if (!LOOKUPS.has(step.path)) return {};
  try {
    const { query, ...rest } = JSON.parse(step.input) as Record<string, unknown>;
    const settings = Object.fromEntries(Object.entries(rest).filter(([key]) => key in searchSettings)) as Parameters<typeof searchHref>[1];
    const href = searchHref(typeof query === "string" ? query : undefined, settings, new Date(step.startedAt).getFullYear());
    return href ? { href } : {};
  } catch {
    // Arguments too long to keep whole were cut, and don't parse.
    return {};
  }
}

/** The page of the record the step acted on, which its card's subject opens. */
function opened(step: Doc<"assistantSteps">) {
  const opens = opensOf(step.path, step.input);
  return opens ? { opens } : {};
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
    ...(step.reads ? { reads: true as const } : {}),
    ...(step.request === undefined ? {} : { request: step.request }),
    ...variantOf(step),
    ...(step.subject ? { subject: step.subject } : {}),
    ...hrefOf(step),
    ...opened(step),
    ...(step.count === undefined ? {} : { count: step.count }),
    ...(step.sources?.length ? { sources: step.sources } : {}),
    ...(step.credits === undefined ? {} : { credits: step.credits }),
    ...(step.outside ? { outside: true as const } : {}),
    ...(step.undoable ? { undoable: true as const } : {}),
    status: shownStatus(step.status, answering === step.order),
    ...(step.batch === undefined ? {} : { batch: step.batch }),
    canAnswer: asked !== undefined,
    ...(asked ? { details: asked.details, ...(asked.each ? { each: asked.each } : {}) } : {}),
    ...(step.error ? { error: step.error } : {}),
    canUndo: step.undo !== undefined && step.userId === userId && step.undone !== true,
    ...(step.undo?.action ? { undoAction: true as const } : {}),
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
  run: async (ctx, { userId }, { threadId, order, through, paginationOpts }) => {
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
