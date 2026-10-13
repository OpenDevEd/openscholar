import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { openalexWork, parsePaperKey, toPaperKey } from "../../lib/papers/paper-ref";

/** A paper's key from how a caller names it: its key, or an ID kept before keys, such as an OpenAlex ID in any form. */
export function requirePaperKey(paper: string): string {
  const key = toPaperKey(paper);
  if (!key) throw createError("VALIDATION_ERROR", "Name a paper by its key, such as openalex:W2741809807 or library:<library ID>:<record key>, or by its OpenAlex ID.");
  return key;
}

/**
 * A workspace's saved paper by its key or an older ID. A paper kept before keys is found by the forms its OpenAlex ID was
 * saved in until migrations/paperIdentity gives it its key. The first match counts: a paper saved twice under two forms
 * of its ID is merged when the old field goes.
 */
export async function findItem(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paper: string) {
  const key = toPaperKey(paper);
  if (!key) return null;
  const byKey = await ctx.db.query("libraryItems").withIndex("by_workspace_paperKey", (q) => q.eq("workspaceId", workspaceId).eq("paperKey", key)).first();
  if (byKey) return byKey;
  const work = parsePaperKey(key)?.source === "openalex" ? openalexWork(key.slice("openalex:".length)) : null;
  const older = work ? [`https://openalex.org/${work}`, work] : [key];
  for (const id of older) {
    const item = await ctx.db.query("libraryItems").withIndex("by_workspace_openalexId", (q) => q.eq("workspaceId", workspaceId).eq("openalexId", id)).first();
    if (item) return item;
  }
  return null;
}
