import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { loadRevisionConfigurationSnapshot } from "./configurationSnapshot";

type ActiveTopicsCtx = Pick<QueryCtx | MutationCtx, "db">;

/** Reads the activated, migrated Topics switch. Draft saves never affect it. */
export async function readActiveTopicsEnabled(
  ctx: ActiveTopicsCtx,
  library: Doc<"evidenceLibraries">,
): Promise<boolean> {
  if (!library.activeRevisionId) return false;
  const loaded = await loadRevisionConfigurationSnapshot(
    ctx as QueryCtx | MutationCtx,
    library.activeRevisionId,
    { requireComplete: false },
  );
  const payload = loaded.migration.snapshot.sections.find(
    (row) => row.sectionKey === "topics",
  )?.payload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as { enabled?: unknown }).enabled === true
  );
}
