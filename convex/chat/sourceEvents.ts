import { v } from "convex/values";
import { query } from "../_generated/server";
import { authorizeThreadAccess } from "./auth";

const sourceEventReturnValidator = v.object({
  _id: v.id("chatSourceEvents"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  threadId: v.string(),
  kind: v.literal("sources_updated"),
  boundaryOrder: v.number(),
  createdAt: v.number(),
});

export const listForThread = query({
  args: { threadId: v.string() },
  returns: v.array(sourceEventReturnValidator),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    return await ctx.db
      .query("chatSourceEvents")
      .withIndex("by_thread_createdAt", (q) => q.eq("threadId", threadId))
      .collect();
  },
});
