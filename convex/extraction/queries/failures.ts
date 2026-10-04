/**
 * A job's failures as counts, for its callouts (#422): papers that failed per error code, and
 * failed answers, those that can be retried and those that can't per code. They come from the
 * job's counts row (../resultCounts.ts), so the query reads a few counters however large the
 * job is, and returns a field per code instead of a list.
 */
import { v, type VFloat64, type VOptional } from "convex/values";
import { ERROR_CODES, type ErrorCode } from "../../../lib/errors/taxonomy";
import { assistantQuery, defineUserQuery, userQuery } from "../../lib/userActions";
import { ownJob } from "../access";
import { readPaperErrorCounts, readResultCounts } from "../resultCounts";

type PerCode = Partial<Record<ErrorCode, number>>;
const perCode = v.object(Object.fromEntries(ERROR_CODES.map((code) => [code, v.optional(v.number())])) as { [Code in ErrorCode]: VOptional<VFloat64> });

export const countJobFailuresAction = defineUserQuery({
  path: "extraction/queries:countJobFailures",
  description:
    "Counts an extraction job's failures: the papers that failed per error code, the failed answers that can be retried, and those that can't per error code, " +
    "with how many answers the job asked for and how many it has.",
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ asked: v.number(), answered: v.number(), retryable: v.number(), permanent: perCode, paperErrors: perCode }),
  run: async (ctx, userId, { jobId }) => {
    if (!(await ownJob(ctx, userId, jobId))) return { asked: 0, answered: 0, retryable: 0, permanent: {}, paperErrors: {} };
    const [counts, paperErrors] = await Promise.all([readResultCounts(ctx, jobId), readPaperErrorCounts(ctx, jobId)]);
    return { asked: counts.total, answered: counts.completed, retryable: counts.retryable, permanent: counts.permanent as PerCode, paperErrors: paperErrors as PerCode };
  },
});
export const countJobFailures = userQuery(countJobFailuresAction);
export const countJobFailuresForAssistant = assistantQuery(countJobFailuresAction);
