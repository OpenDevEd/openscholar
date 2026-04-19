import type { Id } from "../_generated/dataModel";

export type SeedChatPaperRow = {
  jobId: Id<"extractionJobs">;
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export function buildSeedChatPaperRows(
  _jobId: Id<"extractionJobs">,
  sourceIds: ReadonlyArray<Id<"extractionJobSources">>,
): SeedChatPaperRow[] {
  if (sourceIds.length === 0) return [];
  throw new Error("not implemented");
}
