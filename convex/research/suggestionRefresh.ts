/**
 * Asks for a person's suggested searches to be written again when they search (#964): a
 * trigger on saved searches, whichever function writes them. No Convex functions live here,
 * so the triggers can load it (../lib/triggers.ts).
 */
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { currentSearch } from "../../lib/research/records";

/** How long after a search the set is written: searches closer together than this are counted once. */
export const REFRESH_DELAY_MS = 60_000;

// Named by its path: the module that defines it is built with these triggers.
const refresh = makeFunctionReference<"action", { workspaceId: Id<"workspaces">; userId: Id<"users">; dueAt: number }, null>("research/suggestionsAction:refresh");

/** What a search asks the engine: its latest question, or its query. */
const asked = (data: DataModel["searches"]["document"]["data"]) => {
  const search = currentSearch(data);
  return search.latestQuestion || search.query;
};

/** Asks for a person's set in a workspace to be written `delay` from now: a later ask moves it. */
async function askForRefresh(ctx: MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, delay: number, askedBy?: Id<"searches">) {
  const dueAt = Date.now() + delay;
  const row = await ctx.db.query("searchSuggestions").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).unique();
  if (row) await ctx.db.patch("searchSuggestions", row._id, { dueAt, ...(askedBy && { askedBy }) });
  else await ctx.db.insert("searchSuggestions", { workspaceId, userId, suggestions: [], dueAt, ...(askedBy && { askedBy }) });
  await ctx.scheduler.runAt(dueAt, refresh, { workspaceId, userId, dueAt });
}

/** A new search, or a search asked something new, moves its maker's next refresh to a minute from now. */
export async function refreshOnSearch(ctx: MutationCtx, change: Change<DataModel, "searches">) {
  if (!change.newDoc) return;
  if (change.oldDoc && asked(change.oldDoc.data) === asked(change.newDoc.data)) return;
  await askForRefresh(ctx, change.newDoc.workspaceId, change.newDoc.createdBy, REFRESH_DELAY_MS, change.newDoc._id);
}

/** Spread of the backfill's refreshes, so its sets aren't all written at once. */
export const BACKFILL_SPREAD_MS = 10 * 60_000;

/**
 * Asks for a set for the maker of a search saved before suggested searches existed, once per person
 * and workspace: a person who has a set, or one already asked for, is left as they are.
 */
export async function backfillFrom(ctx: MutationCtx, search: DataModel["searches"]["document"]) {
  const row = await ctx.db.query("searchSuggestions").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", search.workspaceId).eq("userId", search.createdBy)).unique();
  if (row) return;
  await askForRefresh(ctx, search.workspaceId, search.createdBy, Math.floor(Math.random() * BACKFILL_SPREAD_MS));
}
