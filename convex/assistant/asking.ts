/**
 * Whether one call of an action asks the person first (decision 12), where the action
 * itself doesn't always: read by the assistant's tools before they run it (./tools.ts).
 * Apart from them, because it reads the database, and from ./steps.ts, where asking is
 * described, because it loads the action registry.
 */
import { v } from "convex/values";
import { availableCredits } from "../billing/accounts";
import { readConvexErrorData } from "../lib/errors";
import { internalQuery } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { actingAs } from "../lib/userActions";
import { TOOL_OF, allowanceOf, covers, toolAllowed } from "./spending";
import { DOCK_FULL, STARTS } from "./jobEnds";
import { JOBS_DOCKED } from "./validators";

export const first = internalQuery({
  // `input` is the call's arguments, as JSON.
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), path: v.string(), input: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, workspaceId, path, input }) => {
    const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
    if (!entry || entry.kind === "query" || !entry.asksFirst) return false;
    try {
      return await entry.asksFirst(ctx, await actingAs(ctx, userId, workspaceId, "assistant"), JSON.parse(input));
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
 * What a call of an action that spends credits holds at most, and whether it runs without
 * the person being asked (#328): they allowed jobs in this chat, this one is within what they
 * said one may hold, and their balance covers it. Null for an action that gives no estimate,
 * or whose arguments it can't be read from: that call can't be asked about. `refused` when
 * the estimate itself says why these arguments won't do, in the action's own words: the
 * model is told that, and can call it again with ones that will.
 */
/** Why an action that calls an outside service would refuse a call, from its `check`, before the person is asked about it. Null when nothing it can read refuses it. */
export const check = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), path: v.string(), input: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { userId, workspaceId, path, input }) => {
    const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
    if (entry?.kind !== "action" || !entry.check) return null;
    try {
      await entry.check(ctx, await actingAs(ctx, userId, workspaceId, "assistant"), JSON.parse(input));
      return null;
    } catch (error) {
      const refused = readConvexErrorData(error)?.message;
      if (refused) return refused;
      console.error(`[assistant] ${path} couldn't be checked`, error);
      return null;
    }
  },
});

export const spend = internalQuery({
  // `input` is the call's arguments, as JSON.
  args: { threadId: v.id("assistantThreads"), userId: v.id("users"), workspaceId: v.id("workspaces"), path: v.string(), input: v.string() },
  returns: v.union(v.null(), v.object({ credits: v.number(), covered: v.boolean() }), v.object({ refused: v.string() })),
  handler: async (ctx, { threadId, userId, workspaceId, path, input }) => {
    const entry = USER_ACTIONS.find((candidate) => candidate.path === path);
    if (!entry || entry.kind === "query" || !entry.spendsCredits || !entry.estimate) return null;
    // A job its chat couldn't dock would be refused as it starts: it's refused before anyone is asked to pay for it.
    if (STARTS[path] && (await ctx.db.query("assistantJobs").withIndex("by_thread", (q) => q.eq("threadId", threadId)).take(JOBS_DOCKED)).length >= JOBS_DOCKED) return { refused: DOCK_FULL };
    let credits: number;
    try {
      credits = Math.ceil(await entry.estimate(ctx, await actingAs(ctx, userId, workspaceId, "assistant"), JSON.parse(input), { threadId }));
    } catch (error) {
      const refused = readConvexErrorData(error)?.message;
      if (refused) return { refused };
      console.error(`[assistant] ${path} couldn't be estimated`, error);
      return null;
    }
    if (!Number.isFinite(credits) || credits < 0) return null;
    // A web search or a PDF read is covered by its own switch in the chat; anything else by what jobs may hold.
    const tool = TOOL_OF[path];
    const balance = await availableCredits(ctx, workspaceId);
    return { credits, covered: tool ? (await toolAllowed(ctx, threadId, userId, tool)) && credits <= balance : covers(await allowanceOf(ctx, threadId, userId), credits, balance) };
  },
});
