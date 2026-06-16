/**
 * @convex-dev/aggregate wiring for extraction credit totals.
 *
 * Result-stat aggregates were removed after the Report Builder/stat consumers
 * were deleted. Keeping only the cost aggregate avoids low-cardinality
 * per-answer B-tree writes on the result persistence path.
 */

import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { GenericMutationCtx } from "convex/server";
import type { Id } from "../_generated/dataModel";

type RunMutationCtx = { runMutation: GenericMutationCtx<never>["runMutation"] };

/**
 * Plan-04: per-job credit-spend aggregate. Backs `getJobCost` with an
 * O(log n) sum call regardless of job size, and drives the header cost
 * badge's live-updating subscription (namespace isolation means
 * paper-N completing on job-A does not rerun queries for job-B).
 *
 * Namespace: the jobId — one B-tree per job.
 * Key:       a random number in [0, 2^53). No semantic — exists only to
 *            distribute parallel inserts across B-tree leaves. The
 *            previous timestamp-keyed scheme collapsed all writes onto
 *            the rightmost leaf under fan-out, re-creating the OCC
 *            contention the aggregate was supposed to absorb. Reads
 *            (`sum`, `clear`) are namespace-wide and key-agnostic.
 * Id:        opaque unique string per debit (`paperId` for extraction_llm,
 *            or `embed:${paperId}` for embedding). Typed as string because
 *            the aggregate captures both extraction and embedding charges.
 * sumValue:  credits spent for that debit.
 *
 * Cleared on cascade delete via `clearJobCredits` (see below). NOT
 * cleared on cancel — the receipt for already-spent credits must be
 * preserved (partial-work billing integrity).
 */
export const creditsAgg = new DirectAggregate<{
  Namespace: Id<"extractionJobs">;
  Key: number;
  Id: string;
}>(components.creditsAgg);

/**
 * Record one credit-spend entry into `creditsAgg`. Use from the same
 * transaction as `deductCredits` so the aggregate total stays
 * exactly in sync with the ledger.
 *
 * Idempotency is NOT enforced here. `insertIfDoesNotExist` lookups are
 * keyed by (key, id) position — with a random key on every call, two
 * calls with the same id at different keys would create duplicate
 * entries. Callers MUST gate this through a billing flag on the source
 * row (`indexingBilled` and `questionsBilled` on extractionPapers) so
 * recordCreditSpend is called at most once per logical debit. OCC
 * retries within a single mutation invocation are fine because only
 * the committed attempt's writes persist.
 */
export async function recordCreditSpend(
  ctx: RunMutationCtx,
  args: {
    jobId: Id<"extractionJobs">;
    id: string;
    creditsUsed: number;
  },
): Promise<void> {
  await creditsAgg.insertIfDoesNotExist(ctx, {
    namespace: args.jobId,
    key: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    id: args.id,
    sumValue: args.creditsUsed,
  });
}

/**
 * Wipe every entry for a job's namespace. Called from the
 * `deleteExtractionInternal` cascade. One component call (not O(N))
 * because `clear` walks the namespace B-tree directly.
 */
export async function clearJobCredits(
  ctx: RunMutationCtx,
  jobId: Id<"extractionJobs">,
): Promise<void> {
  await creditsAgg.clear(ctx, { namespace: jobId });
}
