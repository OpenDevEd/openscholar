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
 *   get (query)       the person's limit in a chat, whether their new chats take it, and what their last replies cost
 *   setReplyLimit     sets or lifts it
 *   setForNewChats    whether the chats they start begin with this chat's
 */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { ASSISTANT_REQUESTS_BEFORE_ASKING } from "../lib/constants";
import { createError } from "../lib/errors";
import { internalMutation, mutation, query } from "../lib/functions";
import { requireThread } from "./access";
import { RECENT_REPLIES, recentCostsValidator } from "./validators";

const FLAG = "assistant.enabled";
/** The largest limit a person can set: fifteen digits, which a number holds exactly. */
export const REPLY_LIMIT_MAX = 999_999_999_999_999;
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
  const replyLimit = (await spenderOf(ctx, userId))?.newChats?.replyLimit;
  if (replyLimit !== undefined) await ctx.db.insert("assistantLimits", { threadId, userId, replyLimit });
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
    /** The chats the person starts begin with this chat's. */
    forNewChats: v.boolean(),
    /** What their last replies cost, oldest first. */
    recent: recentCostsValidator,
  }),
  handler: async (ctx, { threadId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const [limit, spender] = await Promise.all([limitOf(ctx, threadId, userId), spenderOf(ctx, userId)]);
    return { replyLimit: limit?.replyLimit ?? null, forNewChats: spender?.newChats !== undefined && spender.newChats.replyLimit === limit?.replyLimit, recent: (spender?.recent ?? []).map((entry) => entry.credits) };
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
    const replyLimit = limit ?? undefined;
    const [row, spender] = await Promise.all([limitOf(ctx, threadId, userId), spenderOf(ctx, userId)]);
    // New chats that take this chat's limit go on taking it.
    if (spender?.newChats !== undefined && spender.newChats.replyLimit === row?.replyLimit) await ctx.db.patch("assistantSpenders", spender._id, { newChats: replyLimit === undefined ? {} : { replyLimit } });
    if (row) await ctx.db.patch("assistantLimits", row._id, { replyLimit });
    else if (replyLimit !== undefined) await ctx.db.insert("assistantLimits", { threadId, userId, replyLimit });
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
    const replyLimit = on ? await replyLimitOf(ctx, threadId, userId) : undefined;
    const newChats = on ? (replyLimit === undefined ? {} : { replyLimit }) : undefined;
    const spender = await spenderOf(ctx, userId);
    if (spender) await ctx.db.patch("assistantSpenders", spender._id, { newChats });
    else if (newChats) await ctx.db.insert("assistantSpenders", { userId, newChats, recent: [] });
    return null;
  },
});
