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

/** A new search, or a search asked something new, moves its maker's next refresh to a minute from now. */
export async function refreshOnSearch(ctx: MutationCtx, change: Change<DataModel, "searches">) {
  if (!change.newDoc) return;
  if (change.oldDoc && asked(change.oldDoc.data) === asked(change.newDoc.data)) return;
  const { workspaceId, createdBy: userId } = change.newDoc;
  const dueAt = Date.now() + REFRESH_DELAY_MS;
  const row = await ctx.db.query("searchSuggestions").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).unique();
  if (row) await ctx.db.patch("searchSuggestions", row._id, { dueAt });
  else await ctx.db.insert("searchSuggestions", { workspaceId, userId, suggestions: [], dueAt, generating: false });
  await ctx.scheduler.runAt(dueAt, refresh, { workspaceId, userId, dueAt });
}
