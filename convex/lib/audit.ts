import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";

type AuditLogInput = {
  action: string;
  userId?: string;
  metadata?: Record<string, string>;
};

export async function writeAuditLogRecord(
  ctx: Pick<MutationCtx, "db">,
  args: AuditLogInput,
) {
  await ctx.db.insert("auditLogs", {
    action: args.action,
    userId: args.userId,
    metadata: args.metadata,
    timestamp: Date.now(),
  });
}

export const writeAuditLog = internalMutation({
  args: {
    action: v.string(),
    userId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writeAuditLogRecord(ctx, args);
    return null;
  },
});
