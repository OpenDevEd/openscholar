import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type WorkspaceOwner = { kind: "personal"; userId: Id<"users"> } | { kind: "organization"; organizationId: Id<"organizations"> };

/**
 * The workspace of an account or an organization, made if it has none yet: an account's
 * when the account is made, an organization's when the webhook first sees it, and the
 * backfill's for those from before (convex/migrations/workspaces.ts).
 */
export async function ensureWorkspace(ctx: MutationCtx, owner: WorkspaceOwner): Promise<Id<"workspaces">> {
  const existing =
    owner.kind === "personal"
      ? await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", owner.userId)).unique()
      : await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", owner.organizationId)).unique();
  return existing?._id ?? (await ctx.db.insert("workspaces", owner));
}
