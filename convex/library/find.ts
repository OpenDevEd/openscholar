import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { workUrl } from "../../lib/openalex/work-id";

/** A paper's ID as the library keeps it. The assistant gives the bare ID as often as the whole one, and both are the same paper. */
export const canonical = (openalexId: string) => workUrl(openalexId) ?? openalexId;

/** A workspace's saved paper by its ID. One saved under the ID as it was given, before the library kept one form, is still found by that. */
export async function findItem(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, openalexId: string) {
  const byId = (id: string) => ctx.db.query("libraryItems").withIndex("by_workspace_openalexId", (q) => q.eq("workspaceId", workspaceId).eq("openalexId", id)).unique();
  const kept = canonical(openalexId);
  const ids = new Set([kept, openalexId, workUrl(openalexId)?.split("/").at(-1)]);
  for (const id of ids) {
    if (!id) continue;
    const item = await byId(id);
    if (item) return item;
  }
  return null;
}
