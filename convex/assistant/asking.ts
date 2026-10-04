/**
 * Whether one call of an action asks the person first (decision 12), read by the assistant's
 * tools before they run it (./tools.ts). Apart from them, because it reads the database.
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
    return entry.asksFirst(ctx, userId, JSON.parse(input));
  },
});
