import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type LibraryCountCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export function libraryCountRow(ctx: LibraryCountCtx, userId: Id<"users">) {
  return ctx.db.query("libraryCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

/** How many papers the person has saved. Everyone gets a count row when their account is made, so a missing one is an empty library. */
export async function libraryCount(ctx: LibraryCountCtx, userId: Id<"users">) {
  return (await libraryCountRow(ctx, userId))?.count ?? 0;
}
