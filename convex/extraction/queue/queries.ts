import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { extractionPaperQueueValidator } from "../validators";

export const getPaperQueueItem = internalQuery({
  args: { queueId: v.id("extractionPaperQueue") },
  returns: v.union(v.null(), extractionPaperQueueValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.queueId);
  },
});
