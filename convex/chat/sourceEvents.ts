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

/** Source changes a chat shows: the newest, since one is added each time its sources change. */
const SOURCE_EVENTS_SHOWN = 500;

export const listForThread = query({
  args: { threadId: v.string() },
  returns: v.array(sourceEventReturnValidator),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    // Oldest first, as the chat shows them.
    return (
      await ctx.db
        .query("chatSourceEvents")
        .withIndex("by_thread_createdAt", (q) => q.eq("threadId", threadId))
        .order("desc")
        .take(SOURCE_EVENTS_SHOWN)
    ).reverse();
  },
});
