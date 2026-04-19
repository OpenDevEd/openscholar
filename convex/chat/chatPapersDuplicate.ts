import type { Id } from "../_generated/dataModel";
import type { SeedChatPaperRow } from "./chatPapersSeed";

export type SourceChatPaperRow = {
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export function cloneChatPapersForDuplicate(
  newJobId: Id<"extractionJobs">,
  sourceRows: ReadonlyArray<SourceChatPaperRow>,
  sourceIdMap: ReadonlyMap<
    Id<"extractionJobSources">,
    Id<"extractionJobSources">
  >,
): SeedChatPaperRow[] {
  const out: SeedChatPaperRow[] = [];
  for (const row of sourceRows) {
    const newSourceId = sourceIdMap.get(row.sourceId);
    if (!newSourceId) continue;
    out.push({ jobId: newJobId, sourceId: newSourceId, included: row.included });
  }
  return out;
}
