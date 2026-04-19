import type { Id } from "../_generated/dataModel";

export type SeedChatPaperRow = {
  jobId: Id<"extractionJobs">;
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export const DEFAULT_INCLUDED = true;

export function buildSeedChatPaperRows(
  jobId: Id<"extractionJobs">,
  sourceIds: ReadonlyArray<Id<"extractionJobSources">>,
): SeedChatPaperRow[] {
  return sourceIds.map((sourceId) => ({
    jobId,
    sourceId,
    included: DEFAULT_INCLUDED,
  }));
}
