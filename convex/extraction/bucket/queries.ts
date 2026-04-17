/**
 * Thin public query so the client bucket UI can show a live "N / LIMIT"
 * counter without the client duplicating the plan lookup.
 */
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { getPaperLimit } from "./limits";

export const getMyPaperLimit = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await getPaperLimit(ctx, user._id);
  },
});
