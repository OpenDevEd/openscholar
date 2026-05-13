/**
 * @convex-dev/aggregate wiring for extractionResults counters (Task 11).
 *
 * Three named DirectAggregate instances cover the 12 counter fields that
 * used to live on `extractionJobStats`:
 *
 *   - resultStatusAgg     — Key = citationStatus. Counts each of the 4
 *                           status buckets per (jobId, questionKey).
 *   - resultAnsweredAgg   — Key = "answered" | "unanswered". Gives
 *                           totalPapers (both keys) and totalAnswered.
 *   - resultConfidenceAgg — Key = confidence (number), sumValue = confidence.
 *                           Gives confidenceCount/Sum + bucket counts via
 *                           numeric bounds. Rows with undefined confidence
 *                           are NOT stored here — unknown is derived as
 *                           totalPapers - confidenceCount.
 *
 * Namespace = [jobId, questionKey] so each question's B-tree is isolated,
 * which is the whole point of the migration: concurrent paper completions
 * no longer OCC-contend on a single `extractionJobStats` row.
 *
 * Usage boundary: the mutation side calls recordResult / forgetResult /
 * clearJobAggregates (live-write + cascade). The query side calls
 * readAggregateCounters, which matches the legacy Counters shape 1:1 so
 * callers can switch over without touching their consumer logic.
 */

import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type {
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { Id } from "../_generated/dataModel";

type RunMutationCtx = { runMutation: GenericMutationCtx<never>["runMutation"] };
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

type AnsweredKey = "answered" | "unanswered";

type Namespace = [Id<"extractionJobs">, string];

export const resultStatusAgg = new DirectAggregate<{
  Namespace: Namespace;
  Key: CitationStatus;
  Id: string;
}>(components.resultStatusAgg);

export const resultAnsweredAgg = new DirectAggregate<{
  Namespace: Namespace;
  Key: AnsweredKey;
  Id: string;
}>(components.resultAnsweredAgg);

export const resultConfidenceAgg = new DirectAggregate<{
  Namespace: Namespace;
  Key: number;
  Id: string;
}>(components.resultConfidenceAgg);

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
 * Id:        opaque unique string per debit (resultId for extraction_llm,
 *            or `embed:${paperId}` for embedding). Typed as string
 *            because the aggregate captures both per-question results
 *            and per-paper embedding charges — a mixed-ID namespace
 *            needs the string union.
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

/**
 * Minimal result shape the helpers need — structurally compatible with
 * Doc<"extractionResults"> so callers can pass the doc straight through
 * after ctx.db.get / ctx.db.query.
 */
export type ResultForAggregate = {
  _id: Id<"extractionResults">;
  jobId: Id<"extractionJobs">;
  questionKey: string;
  answer: string | boolean | number | string[] | null;
  confidence?: number;
  citationStatus: CitationStatus;
};

function isAnswered(answer: ResultForAggregate["answer"]): boolean {
  return answer !== null && answer !== undefined;
}

/**
 * Record one extractionResult into all 3 aggregates. Uses
 * insertIfDoesNotExist so a retried mutation (OCC) or a backfill pass
 * over already-recorded rows is a no-op.
 */
export async function recordResult(
  ctx: RunMutationCtx,
  result: ResultForAggregate,
): Promise<void> {
  const namespace: Namespace = [result.jobId, result.questionKey];
  const id = result._id;

  await resultStatusAgg.insertIfDoesNotExist(ctx, {
    namespace,
    key: result.citationStatus,
    id,
  });
  await resultAnsweredAgg.insertIfDoesNotExist(ctx, {
    namespace,
    key: isAnswered(result.answer) ? "answered" : "unanswered",
    id,
  });
  if (typeof result.confidence === "number") {
    await resultConfidenceAgg.insertIfDoesNotExist(ctx, {
      namespace,
      key: result.confidence,
      id,
      sumValue: result.confidence,
    });
  }
}

/**
 * Reverse recordResult. deleteIfExists tolerates drift (e.g. an aggregate
 * that never captured this result on a live-write retry) — the cascade
 * must not throw if the row is absent.
 */
export async function forgetResult(
  ctx: RunMutationCtx,
  result: ResultForAggregate,
): Promise<void> {
  const namespace: Namespace = [result.jobId, result.questionKey];
  const id = result._id;

  await resultStatusAgg.deleteIfExists(ctx, {
    namespace,
    key: result.citationStatus,
    id,
  });
  await resultAnsweredAgg.deleteIfExists(ctx, {
    namespace,
    key: isAnswered(result.answer) ? "answered" : "unanswered",
    id,
  });
  if (typeof result.confidence === "number") {
    await resultConfidenceAgg.deleteIfExists(ctx, {
      namespace,
      key: result.confidence,
      id,
    });
  }
}

/**
 * Drop every (jobId, questionKey) B-tree across all 3 instances. Called
 * from the cascade-delete path instead of a per-result forgetResult loop
 * (O(Q) component calls vs O(Q×P)).
 */
export async function clearJobAggregates(
  ctx: RunMutationCtx,
  jobId: Id<"extractionJobs">,
  questionKeys: string[],
): Promise<void> {
  for (const questionKey of questionKeys) {
    const namespace: Namespace = [jobId, questionKey];
    await Promise.all([
      resultStatusAgg.clear(ctx, { namespace }),
      resultAnsweredAgg.clear(ctx, { namespace }),
      resultConfidenceAgg.clear(ctx, { namespace }),
    ]);
  }
}

export type Counters = {
  totalPapers: number;
  totalAnswered: number;
  groundedCount: number;
  bestEffortCount: number;
  insufficientEvidenceCount: number;
  extractionErrorCount: number;
  confidenceSum: number;
  confidenceCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unknownConfidenceCount: number;
};

/**
 * Slim per-question summary used by `createExtractionReportSnapshot`.
 * Shape matches the fields that report generation reads off the legacy
 * `extractionJobStats` row, so swapping reads requires no downstream change.
 */
export type AggregateQuestionSummary = {
  questionKey: string;
  totalPapers: number;
  totalAnswered: number;
  groundedCount: number;
  bestEffortCount: number;
  confidenceSum: number;
  confidenceCount: number;
};

/**
 * Read the 12 counters for one (jobId, questionKey) out of the 3
 * aggregates. Shape matches the legacy `extractionJobStats` row so
 * callers can swap reads with no downstream change.
 *
 * Batches reads per aggregate to minimize component round trips: 5
 * component calls total (countBatch×3 + count + sum), independent of
 * how many status/bucket dimensions we expose.
 */
export async function readAggregateCounters(
  ctx: RunQueryCtx,
  jobId: Id<"extractionJobs">,
  questionKey: string,
): Promise<Counters> {
  const namespace: Namespace = [jobId, questionKey];

  const [statusCounts, answeredCounts, confidenceCount, confidenceSum, bucketCounts] =
    await Promise.all([
      resultStatusAgg.countBatch(ctx, [
        { namespace, bounds: { eq: "grounded" } },
        { namespace, bounds: { eq: "best_effort" } },
        { namespace, bounds: { eq: "insufficient_evidence" } },
        { namespace, bounds: { eq: "extraction_error" } },
      ]),
      resultAnsweredAgg.countBatch(ctx, [
        { namespace },
        { namespace, bounds: { eq: "answered" } },
      ]),
      resultConfidenceAgg.count(ctx, { namespace }),
      resultConfidenceAgg.sum(ctx, { namespace }),
      resultConfidenceAgg.countBatch(ctx, [
        { namespace, bounds: { lower: { key: 0.8, inclusive: true } } },
        {
          namespace,
          bounds: {
            lower: { key: 0.5, inclusive: true },
            upper: { key: 0.8, inclusive: false },
          },
        },
        { namespace, bounds: { upper: { key: 0.5, inclusive: false } } },
      ]),
    ]);

  const [grounded, bestEffort, insufficientEvidence, extractionError] = statusCounts;
  const [totalPapers, totalAnswered] = answeredCounts;
  const [highConfidence, mediumConfidence, lowConfidence] = bucketCounts;

  return {
    totalPapers,
    totalAnswered,
    groundedCount: grounded,
    bestEffortCount: bestEffort,
    insufficientEvidenceCount: insufficientEvidence,
    extractionErrorCount: extractionError,
    confidenceSum,
    confidenceCount,
    highConfidenceCount: highConfidence,
    mediumConfidenceCount: mediumConfidence,
    lowConfidenceCount: lowConfidence,
    unknownConfidenceCount: totalPapers - confidenceCount,
  };
}

/**
 * Read the 4-field summary (totalPapers / totalAnswered / groundedCount /
 * bestEffortCount) for every question on a job in one batched call per
 * aggregate. `createExtractionReportSnapshot` consumes the same shape the
 * legacy `extractionJobStats` table returned.
 *
 * Questions with zero activity still surface as rows (all zeros), so the
 * returned length always equals `questionKeys.length` — this matches the
 * report builder's gating condition for using the pre-aggregated path.
 */
export async function readAggregateSummariesByQuestion(
  ctx: RunQueryCtx,
  jobId: Id<"extractionJobs">,
  questionKeys: string[],
): Promise<AggregateQuestionSummary[]> {
  if (questionKeys.length === 0) return [];

  const statusQueries = questionKeys.flatMap((qk) => {
    const namespace: Namespace = [jobId, qk];
    return [
      { namespace, bounds: { eq: "grounded" as const } },
      { namespace, bounds: { eq: "best_effort" as const } },
    ];
  });
  const answeredQueries = questionKeys.flatMap((qk) => {
    const namespace: Namespace = [jobId, qk];
    return [
      { namespace },
      { namespace, bounds: { eq: "answered" as const } },
    ];
  });
  const confidenceCountQueries = questionKeys.map((qk) => ({
    namespace: [jobId, qk] as Namespace,
  }));

  const [statusCounts, answeredCounts, confidenceCounts, confidenceSums] =
    await Promise.all([
      resultStatusAgg.countBatch(ctx, statusQueries),
      resultAnsweredAgg.countBatch(ctx, answeredQueries),
      resultConfidenceAgg.countBatch(ctx, confidenceCountQueries),
      resultConfidenceAgg.sumBatch(ctx, confidenceCountQueries),
    ]);

  return questionKeys.map((questionKey, i) => ({
    questionKey,
    totalPapers: answeredCounts[i * 2],
    totalAnswered: answeredCounts[i * 2 + 1],
    groundedCount: statusCounts[i * 2],
    bestEffortCount: statusCounts[i * 2 + 1],
    confidenceSum: confidenceSums[i],
    confidenceCount: confidenceCounts[i],
  }));
}
