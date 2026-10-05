/**
 * What a person lets the assistant spend (#346). A reply has no built-in limit: it runs
 * while its sender has credits. A person can set one of their own in a chat, in credits a
 * reply may spend. A reply that reaches it pauses and asks, and carrying it on allows as
 * much again from where it stands. That is Roo Code's rule for its cost limit: asked at
 * the limit, and counted again from there on a yes. People in a shared chat each set their
 * own, and spend their own credits.
 *
 * A reply also pauses after a great many requests, whatever they cost, and asks whether to
 * carry on, as Goose does at its turn limit: a reply that keeps finding something new to
 * do isn't caught by the rules for one going round in circles (./tools.ts).
 *
 * A job that spends credits asks first, with the most it holds (#328). A person can allow
 * jobs in a chat without being asked, up to what one may hold: opencode's "always" for a
 * session, with Roo Code's ceiling on it.
 *
 *   get (query)       the person's limits in a chat, what their new chats start with, and what their last replies cost
 *   jobs (query)      their calls in the chat that held credits, a page at a time
 *   setReplyLimit     sets or lifts a reply's
 *   setAllowance      whether jobs run without asking, and the most one may hold
 *   setForNewChats    whether the chats they start begin with this chat's
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { ASSISTANT_JOB_CAPS, ASSISTANT_REQUESTS_BEFORE_ASKING } from "../lib/constants";
import { createError } from "../lib/errors";
import { internalMutation, mutation, query } from "../lib/functions";
import { requireThread } from "./access";
import { RECENT_REPLIES, recentCostsValidator } from "./validators";

const FLAG = "assistant.enabled";
/** The largest limit a person can set: fifteen digits, which a number holds exactly. */
export const REPLY_LIMIT_MAX = 999_999_999_999_999;
/** Jobs one page of the Spending sheet's list holds at most. */
const JOBS_PAGE_MAX = 50;
/** Rows of a deleted chat, or of a purged account, that one batch deletes. */
const FORGET_LIMITS = 100;

type Reader = Pick<QueryCtx, "db">;
const limitOf = (ctx: Reader, threadId: Id<"assistantThreads">, userId: Id<"users">) =>
  ctx.db.query("assistantLimits").withIndex("by_thread_and_user", (q) => q.eq("threadId", threadId).eq("userId", userId)).unique();
const spenderOf = (ctx: Reader, userId: Id<"users">) => ctx.db.query("assistantSpenders").withIndex("by_user", (q) => q.eq("userId", userId)).unique();

/** Credits a reply to this person may spend in this chat before it pauses. With none, it has no limit. */
export async function replyLimitOf(ctx: Reader, threadId: Id<"assistantThreads">, userId: Id<"users">) {
  return (await limitOf(ctx, threadId, userId))?.replyLimit;
}

type Allowance = { cap?: number };
/** What a person lets the assistant spend in a chat: a reply's limit, and what jobs may hold without asking. */
type Limits = { replyLimit?: number; jobs?: Allowance };
const sameAllowance = (a: Allowance | undefined, b: Allowance | undefined) => (a === undefined) === (b === undefined) && a?.cap === b?.cap;
const sameLimits = (a: Limits, b: Limits) => a.replyLimit === b.replyLimit && sameAllowance(a.jobs, b.jobs);
const limitsIn = (row: Limits | null | undefined): Limits => ({ ...(row?.replyLimit === undefined ? {} : { replyLimit: row.replyLimit }), ...(row?.jobs === undefined ? {} : { jobs: row.jobs }) });

/** What jobs that spend credits may hold in this chat without this person being asked. Undefined when each one asks. */
export async function allowanceOf(ctx: Reader, threadId: Id<"assistantThreads">, userId: Id<"users">) {
  return (await limitOf(ctx, threadId, userId))?.jobs;
}

/** Whether a call that holds `credits` runs without asking: jobs are allowed, this one is within what one may hold, and the balance covers it. */
export const covers = (allowance: Allowance | undefined, credits: number, balance: number) => allowance !== undefined && (allowance.cap === undefined || credits <= allowance.cap) && credits <= balance;

/**
 * Changes what a person lets the assistant spend in a chat. New chats that take this chat's
 * limits go on taking them.
 */
async function setLimits(ctx: MutationCtx, threadId: Id<"assistantThreads">, userId: Id<"users">, change: (now: Limits) => Limits) {
  const [row, spender] = await Promise.all([limitOf(ctx, threadId, userId), spenderOf(ctx, userId)]);
  const now = limitsIn(row);
  const next = change(now);
  if (spender?.newChats !== undefined && sameLimits(limitsIn(spender.newChats), now)) await ctx.db.patch("assistantSpenders", spender._id, { newChats: next });
  if (row) await ctx.db.patch("assistantLimits", row._id, { replyLimit: next.replyLimit, jobs: next.jobs });
  else if (next.replyLimit !== undefined || next.jobs !== undefined) await ctx.db.insert("assistantLimits", { threadId, userId, ...next });
  return next;
}

/**
 * "Always allow in this chat", said to a call that holds `credits`: from now on jobs run
 * without asking up to the smallest listed limit that covers this one. Past the largest
 * listed limit there is none. A limit the person already has that covers it stays as it
 * is, their own number included.
 */
export async function allowAlways(ctx: MutationCtx, threadId: Id<"assistantThreads">, userId: Id<"users">, credits: number) {
  const { jobs } = await setLimits(ctx, threadId, userId, (now) => {
    if (now.jobs && (now.jobs.cap === undefined || now.jobs.cap >= credits)) return now;
    const cap = ASSISTANT_JOB_CAPS.find((listed) => listed >= credits);
    return { ...now, jobs: cap === undefined ? {} : { cap } };
  });
  return jobs;
}

/** Why a reply with more to do pauses before its next request, when it does. */
export function pausedAt({ spent, rounds, cap, lap }: { spent: number; rounds: number; cap?: number; lap?: number }) {
  if (cap !== undefined && spent >= cap) return "credits" as const;
  if (rounds >= (lap ?? ASSISTANT_REQUESTS_BEFORE_ASKING)) return "requests" as const;
  return null;
}

/**
 * What a paused reply carries on with: as much again of what it paused at, counted from
 * where it stands. `limit` is the person's limit as it is now, so one lifted since the
 * reply paused lets it run on without one.
 */
export function carriedOn(waiting: Pick<NonNullable<Doc<"assistantThreads">["asking"]>, "spent" | "rounds" | "cap" | "lap" | "paused">, limit: number | undefined) {
  const cap = waiting.paused === "credits" ? (limit === undefined ? undefined : waiting.spent + limit) : waiting.cap;
  const lap = waiting.paused === "requests" ? waiting.rounds + ASSISTANT_REQUESTS_BEFORE_ASKING : waiting.lap;
  return { ...(cap === undefined ? {} : { cap }), ...(lap === undefined ? {} : { lap }) };
}

/** A chat the person starts begins with what they chose for their new chats. */
export async function startWith(ctx: MutationCtx, threadId: Id<"assistantThreads">, userId: Id<"users">) {
  const limits = limitsIn((await spenderOf(ctx, userId))?.newChats);
  if (limits.replyLimit !== undefined || limits.jobs !== undefined) await ctx.db.insert("assistantLimits", { threadId, userId, ...limits });
}

/**
 * Keeps what a reply cost among the person's last, for the Spending sheet's chart, under the
 * reply's name. Credits for a reply already among them are added to it: a request stopped or
 * failed partway is settled after the reply has ended. Nothing is kept for no credits.
 */
export async function noteReply(ctx: MutationCtx, userId: Id<"users">, reply: string, credits: number) {
  // A reply can outlast its sender's account, paused in someone else's chat: nothing is kept for an account that is gone.
  if (credits <= 0 || !(await ctx.db.get("users", userId))) return;
  const spender = await spenderOf(ctx, userId);
  const kept = spender?.recent ?? [];
  const recent = kept.some((entry) => entry.reply === reply)
    ? kept.map((entry) => (entry.reply === reply ? { reply, credits: entry.credits + credits } : entry))
    : [...kept, { reply, credits }].slice(-RECENT_REPLIES);
  if (spender) await ctx.db.patch("assistantSpenders", spender._id, { recent });
  else await ctx.db.insert("assistantSpenders", { userId, recent });
}

/** A request of a reply that was stopped or failed partway is settled once OpenRouter says what it cost (convex/chat/billing.ts). */
export const settledLate = internalMutation({
  args: { userId: v.id("users"), reply: v.string(), credits: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, reply, credits }) => {
    await noteReply(ctx, userId, reply, credits);
    return null;
  },
});

/** Deletes a batch of a deleted chat's limits. Returns whether more are left. */
export async function forgetLimits(ctx: MutationCtx, threadId: Id<"assistantThreads">) {
  const rows = await ctx.db.query("assistantLimits").withIndex("by_thread_and_user", (q) => q.eq("threadId", threadId)).take(FORGET_LIMITS);
  for (const row of rows) await ctx.db.delete("assistantLimits", row._id);
  return rows.length === FORGET_LIMITS;
}

/** Deletes a batch of a purged account's limits, then its own record. Returns whether everything is gone. */
export async function purgeSpending(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("assistantLimits").withIndex("by_user", (q) => q.eq("userId", userId)).take(FORGET_LIMITS);
  for (const row of rows) await ctx.db.delete("assistantLimits", row._id);
  if (rows.length === FORGET_LIMITS) return false;
  const spender = await spenderOf(ctx, userId);
  if (spender) await ctx.db.delete("assistantSpenders", spender._id);
  return true;
}

export const get = query({
  args: { threadId: v.id("assistantThreads") },
  returns: v.object({
    /** Credits a reply may spend before it pauses; null is no limit. */
    replyLimit: v.union(v.number(), v.null()),
    /** Jobs that spend credits run without asking: the most one may hold, null being any amount. Null when each one asks. */
    allowance: v.union(v.null(), v.object({ cap: v.union(v.number(), v.null()) })),
    /**
     * What the chats the person starts begin with, null being no limit; absent until they choose.
     * A chat whose limit this equals is one new chats take theirs from: changing it there changes this.
     */
    newChats: v.optional(v.union(v.number(), v.null())),
    /** What their last replies cost, oldest first. */
    recent: recentCostsValidator,
  }),
  handler: async (ctx, { threadId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const [limit, spender] = await Promise.all([limitOf(ctx, threadId, userId), spenderOf(ctx, userId)]);
    return { replyLimit: limit?.replyLimit ?? null, allowance: limit?.jobs ? { cap: limit.jobs.cap ?? null } : null, ...(spender?.newChats === undefined ? {} : { newChats: spender.newChats.replyLimit ?? null }), recent: (spender?.recent ?? []).map((entry) => entry.credits) };
  },
});

/**
 * The person's calls in this chat that held credits, the largest hold first, a page at a
 * time: what the Spending sheet's settings for jobs decide for, each shown as one that
 * would run or would ask.
 */
export const jobs = query({
  args: { threadId: v.id("assistantThreads"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("assistantSteps"), action: v.string(), subject: v.optional(v.string()), credits: v.number() })),
  handler: async (ctx, { threadId, paginationOpts }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const read = await ctx.db
      .query("assistantSteps")
      // Only a step that holds credits has a number here.
      .withIndex("by_thread_user_credits", (q) => q.eq("threadId", threadId).eq("userId", userId).gte("credits", 0))
      .order("desc")
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, JOBS_PAGE_MAX) });
    return { ...read, page: read.page.map((step) => ({ id: step._id, action: step.path, ...(step.subject ? { subject: step.subject } : {}), credits: step.credits! })) };
  },
});

export const setReplyLimit = mutation({
  // `limit`: a whole number of credits from 1, or null for no limit.
  args: { threadId: v.id("assistantThreads"), limit: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { threadId, limit }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > REPLY_LIMIT_MAX)) throw createError("VALIDATION_ERROR", "A limit is a whole number of credits, from 1.");
    await setLimits(ctx, threadId, userId, ({ replyLimit: _was, ...rest }) => (limit === null ? rest : { ...rest, replyLimit: limit }));
    return null;
  },
});

export const setAllowance = mutation({
  // `allowance`: null to be asked before every job that spends credits; else the most one may hold without asking, a whole number of credits from 1, or null for any amount.
  args: { threadId: v.id("assistantThreads"), allowance: v.union(v.null(), v.object({ cap: v.union(v.number(), v.null()) })) },
  returns: v.null(),
  handler: async (ctx, { threadId, allowance }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const cap = allowance?.cap ?? null;
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > REPLY_LIMIT_MAX)) throw createError("VALIDATION_ERROR", "A limit is a whole number of credits, from 1.");
    await setLimits(ctx, threadId, userId, ({ jobs: _was, ...rest }) => (allowance === null ? rest : { ...rest, jobs: cap === null ? {} : { cap } }));
    return null;
  },
});

export const setForNewChats = mutation({
  args: { threadId: v.id("assistantThreads"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, on }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const newChats = on ? limitsIn(await limitOf(ctx, threadId, userId)) : undefined;
    const spender = await spenderOf(ctx, userId);
    if (spender) await ctx.db.patch("assistantSpenders", spender._id, { newChats });
    else if (newChats) await ctx.db.insert("assistantSpenders", { userId, newChats, recent: [] });
    return null;
  },
});
