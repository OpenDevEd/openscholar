import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ActiveTopicsCtx = Pick<QueryCtx | MutationCtx, "db">;

/** The Topics switch in a `topics` section payload. */
export function readTopicsEnabled(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as { enabled?: unknown }).enabled === true
  );
}

/**
 * Reads the activated Topics switch. Draft saves never affect it. Revisions
 * saved before version 6 have no `topics` row, and version 6 defaults the
 * switch to off, so a missing row means off.
 */
export async function readActiveTopicsEnabled(
  ctx: ActiveTopicsCtx,
  library: Doc<"evidenceLibraries">,
): Promise<boolean> {
  const revisionId = library.activeRevisionId;
  if (!revisionId) return false;
  const row = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_revisionId_and_sectionKey", (query) =>
      query.eq("revisionId", revisionId).eq("sectionKey", "topics"),
    )
    .unique();
  return readTopicsEnabled(row?.payload);
}
