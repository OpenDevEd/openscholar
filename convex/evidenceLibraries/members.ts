import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_LIBRARY_GRANTS_PER_PERSON, MAX_LIBRARY_MEMBERS } from "../lib/queryBounds";

/** Refuses another direct grant once a library has MAX_LIBRARY_MEMBERS people (#357). */
export async function assertLibraryHasRoom(ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">) {
  const members = await ctx.db.query("evidenceLibraryMembers").withIndex("by_libraryId_and_clerkUserId", (q) => q.eq("libraryId", libraryId)).take(MAX_LIBRARY_MEMBERS);
  if (members.length >= MAX_LIBRARY_MEMBERS) {
    throw createError("VALIDATION_ERROR", `A library can have up to ${MAX_LIBRARY_MEMBERS.toLocaleString("en")} people. Remove someone to add another.`);
  }
}

/** Refuses another direct grant once a person has MAX_LIBRARY_GRANTS_PER_PERSON, so their grants read in one query (#427). */
export async function assertPersonHasRoom(ctx: Pick<QueryCtx, "db">, clerkUserId: string) {
  const grants = await ctx.db.query("evidenceLibraryMembers").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId)).take(MAX_LIBRARY_GRANTS_PER_PERSON);
  if (grants.length >= MAX_LIBRARY_GRANTS_PER_PERSON) {
    throw createError("VALIDATION_ERROR", `This person already has access to ${MAX_LIBRARY_GRANTS_PER_PERSON.toLocaleString("en")} libraries. Remove them from one to add another.`);
  }
}
