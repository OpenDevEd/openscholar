import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type LibraryCountCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export function libraryCountRow(ctx: LibraryCountCtx, workspaceId: Id<"workspaces">) {
  return ctx.db.query("libraryCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
}

/** How many papers the workspace has saved. Every account gets a count row when it's made, so a missing one is an empty library. */
export async function libraryCount(ctx: LibraryCountCtx, workspaceId: Id<"workspaces">) {
  return (await libraryCountRow(ctx, workspaceId))?.count ?? 0;
}
