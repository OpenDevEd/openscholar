import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_LIBRARY_BROWSE } from "../lib/queryBounds";

type LibraryCountCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export async function resolveLibraryCount(
  ctx: LibraryCountCtx,
  userId: Id<"users">,
  storedCount: number | undefined,
): Promise<number> {
  if (storedCount !== undefined) {
    return storedCount;
  }

  const items = await ctx.db
    .query("libraryItems")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_LIBRARY_BROWSE + 1);

  if (items.length > MAX_LIBRARY_BROWSE) {
    throw new ConvexError({
      code: "LIBRARY_COUNT_REPAIR_REQUIRED",
      message:
        "Library counter missing for a user whose library exceeds the bounded recount window.",
    });
  }

  console.error("[library] Missing libraryItemCount; using bounded live recount", {
    userId,
    liveCount: items.length,
  });

  return items.length;
}

export function libraryCountRow(ctx: LibraryCountCtx, userId: Id<"users">) {
  return ctx.db.query("libraryCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

/**
 * How many papers the person has saved: their count row, or before they have one, the count
 * on their user row, recounted when that is missing too.
 */
export async function libraryCount(ctx: LibraryCountCtx, user: Pick<Doc<"users">, "_id" | "libraryItemCount">) {
  const row = await libraryCountRow(ctx, user._id);
  return row ? row.count : resolveLibraryCount(ctx, user._id, user.libraryItemCount);
}
