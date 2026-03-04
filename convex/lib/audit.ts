import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const writeAuditLog = internalMutation({
  args: {
    action: v.string(),
    userId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      action: args.action,
      userId: args.userId,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
    return null;
  },
});
