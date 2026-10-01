import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_LIBRARY_MEMBERS } from "../lib/queryBounds";

/** Refuses another direct grant once a library has MAX_LIBRARY_MEMBERS people (#357). */
export async function assertLibraryHasRoom(ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">) {
  const members = await ctx.db.query("evidenceLibraryMembers").withIndex("by_libraryId_and_clerkUserId", (q) => q.eq("libraryId", libraryId)).take(MAX_LIBRARY_MEMBERS);
  if (members.length >= MAX_LIBRARY_MEMBERS) {
    throw createError("VALIDATION_ERROR", `A library can have up to ${MAX_LIBRARY_MEMBERS.toLocaleString("en")} people. Remove someone to add another.`);
  }
}
