import type { Id } from "../_generated/dataModel";
import type { SeedChatPaperRow } from "./chatPapersSeed";

export type SourceChatPaperRow = {
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export function cloneChatPapersForDuplicate(
  _newJobId: Id<"extractionJobs">,
  sourceRows: ReadonlyArray<SourceChatPaperRow>,
  _sourceIdMap: ReadonlyMap<
    Id<"extractionJobSources">,
    Id<"extractionJobSources">
  >,
): SeedChatPaperRow[] {
  if (sourceRows.length === 0) return [];
  throw new Error("not implemented");
}
