import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";

// Kept apart from ./actor.ts, which reads auth: the database triggers reach these, and must load
// without the modules that load the triggers themselves.

/**
 * A person's own workspace: where a reply of theirs in a chat shared with them from outside
 * acts (convex/assistant/access.ts `replyWorkspace`), and the one the browser names until
 * pages carry theirs (#651).
 */
export async function personalWorkspaceOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<Id<"workspaces">> {
  const workspace = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace._id;
}

/** An organization's workspace, made with it (#650). */
export async function organizationWorkspaceOf(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">): Promise<Id<"workspaces">> {
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  if (!workspace) throw createError("NOT_FOUND", "Workspace not found");
  return workspace._id;
}

