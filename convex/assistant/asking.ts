/**
 * Whether one call of an action asks the person first (decision 12), where the action
 * itself doesn't always: read by the assistant's tools before they run it (./tools.ts).
 * Apart from them, because it reads the database, and from ./steps.ts, where asking is
 * described, because it loads the action registry.
 */
import { v } from "convex/values";
import { internalQuery } from "../lib/functions";
import { USER_ACTIONS } from "../lib/userActionRegistry";

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
