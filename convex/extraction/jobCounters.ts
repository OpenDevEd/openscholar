/** An extraction job's processed and failed paper counts, from the job's counts row (./counts.ts). */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readCounts } from "./counts";

export type JobCounters = {
  processed: number;
  failed: number;
};

export async function readJobCounters(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<JobCounters> {
  const counts = await readCounts(ctx, jobId);
  return { processed: counts.processed ?? 0, failed: counts.failed ?? 0 };
}
