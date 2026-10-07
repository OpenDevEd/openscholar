import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { countOf, libraryMembersOf, personGrantsOf } from "../lib/listCounts";
import { MAX_LIBRARY_GRANTS_PER_PERSON, MAX_LIBRARY_MEMBERS } from "../lib/queryBounds";

/** Refuses another direct grant once a library has MAX_LIBRARY_MEMBERS people (#357), from its count. */
export async function assertLibraryHasRoom(ctx: QueryCtx, libraryId: Id<"evidenceLibraries">) {
  if ((await countOf(ctx, libraryMembersOf(libraryId))) >= MAX_LIBRARY_MEMBERS) {
    throw createError("VALIDATION_ERROR", `A library can have up to ${MAX_LIBRARY_MEMBERS.toLocaleString("en")} people. Remove someone to add another.`);
  }
}

/** Refuses another direct grant once a person has MAX_LIBRARY_GRANTS_PER_PERSON, so their grants read in one query (#427), from their count. */
export async function assertPersonHasRoom(ctx: QueryCtx, clerkUserId: string) {
  if ((await countOf(ctx, personGrantsOf(clerkUserId))) >= MAX_LIBRARY_GRANTS_PER_PERSON) {
    throw createError("VALIDATION_ERROR", `This person already has access to ${MAX_LIBRARY_GRANTS_PER_PERSON.toLocaleString("en")} libraries. Remove them from one to add another.`);
  }
}
