import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { toPaperKey } from "../../lib/papers/paper-ref";

/** A paper's key from how a caller names it: its key, or an ID kept before keys, such as an OpenAlex ID in any form. */
export function requirePaperKey(paper: string): string {
  const key = toPaperKey(paper);
  if (!key) throw createError("VALIDATION_ERROR", "Name a paper by its key, such as openalex:W2741809807 or library:<library ID>:<record key>, or by its OpenAlex ID.");
  return key;
}

/** A workspace's saved paper by its key, or by an OpenAlex ID in any form for an OpenAlex paper. */
export async function findItem(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paper: string) {
  const key = toPaperKey(paper);
  if (!key) return null;
  return await ctx.db.query("libraryItems").withIndex("by_workspace_paperKey", (q) => q.eq("workspaceId", workspaceId).eq("paperKey", key)).first();
}
