import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Get user by WorkOS ID (internal - for actions)
export const getUserByWorkosIdInternal = internalQuery({
  args: {
    workosId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();
    return user;
  },
});
