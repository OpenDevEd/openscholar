/**
 * Whether one call of an action asks the person first (decision 12), where the action
 * itself doesn't always: read by the assistant's tools before they run it (./tools.ts).
 * Apart from them, because it reads the database, and from ./steps.ts, where asking is
 * described, because it loads the action registry.
 */
import { v } from "convex/values";
import { availableCredits } from "../billing/accounts";
import { internalQuery } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { allowanceOf, covers } from "./spending";
import { stepsOfExchange } from "./steps";

export const first = internalQuery({
  // `input` is the call's arguments, as JSON.
  args: { userId: v.id("users"), path: v.string(), input: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, path, input }) => {
    const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
    if (!entry || entry.kind === "query" || !entry.asksFirst) return false;
    try {
      return await entry.asksFirst(ctx, userId, JSON.parse(input));
    } catch (error) {
      // Arguments the check can't read (an ID of another table, say) aren't a reason to ask, and
      // threw here, where nothing caught it: the whole reply failed. The call goes on to run,
      // where a change checks again in its own transaction, and its failure is told to the model.
      console.error(`[assistant] ${path} couldn't be checked for asking first`, error);
      return false;
    }
  },
});

/**
 * How many times a reply has run an action in the exchange it's answering, for telling a bulk
 * change (./steps.ts `BULK`): its steps that ran or are running. A step that asked about a
 * batch isn't one: each of its changes is.
 * ponytail: reads the exchange's newest steps (`STEPS_SHOWN`), so a reply that ran more than that since counts short. An index by action if replies get that long.
 */
export const made = internalQuery({
  args: { threadId: v.id("assistantThreads"), order: v.number(), path: v.string() },
  returns: v.number(),
  handler: async (ctx, { threadId, order, path }) =>
    (await stepsOfExchange(ctx, threadId, order)).filter((step) => step.path === path && step.batch === undefined && (step.status === "done" || step.status === "running")).length,
});

/**
 * What a call of an action that spends credits holds at most, and whether it runs without
 * the person being asked (#328): they allowed jobs in this chat, this one is within what they
 * said one may hold, and their balance covers it. Null for an action that gives no estimate,
 * or whose arguments it can't be read from: that call can't be asked about.
 */
export const spend = internalQuery({
  // `input` is the call's arguments, as JSON.
  args: { threadId: v.id("assistantThreads"), userId: v.id("users"), path: v.string(), input: v.string() },
  returns: v.union(v.null(), v.object({ credits: v.number(), covered: v.boolean() })),
  handler: async (ctx, { threadId, userId, path, input }) => {
    const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
    if (!entry || entry.kind === "query" || !entry.spendsCredits || !entry.estimate) return null;
    let credits: number;
    try {
      credits = Math.ceil(await entry.estimate(ctx, userId, JSON.parse(input)));
    } catch (error) {
      console.error(`[assistant] ${path} couldn't be estimated`, error);
      return null;
    }
    if (!Number.isFinite(credits) || credits < 0) return null;
    return { credits, covered: covers(await allowanceOf(ctx, threadId, userId), credits, await availableCredits(ctx, userId)) };
  },
});
