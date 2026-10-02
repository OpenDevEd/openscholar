/**
 * An extraction job's processed and failed paper counts. They live in the job's counts row
 * (./counts.ts). A job the counts worker hasn't reached and the migration hasn't given a row
 * still reads the sharded counters that kept them before (#351), which nothing writes any
 * more; those reads go once every deployment has run migrations/moveExtractionCounts.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readCounts } from "./counts";
import { legacyCounts } from "./legacyCounts";

export type JobCounters = {
  processed: number;
  failed: number;
};

export async function readJobCounters(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<JobCounters> {
  const counts = await readCounts(ctx, jobId, () => legacyCounts(ctx, jobId));
  return { processed: counts.processed ?? 0, failed: counts.failed ?? 0 };
}
