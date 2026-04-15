import type { SubscriptionPlan } from "../../lib/billing/entitlements";

/** Maximum library items returned in a single browse/list query.
 * Based on practical upper bound of a user's library size. */
export const MAX_LIBRARY_BROWSE = 10_000;

/** Maximum collection memberships loaded for filtering.
 * Matches MAX_LIBRARY_BROWSE since a collection is a subset of library. */
export const MAX_COLLECTION_MEMBERS = 10_000;

/** Maximum credit transactions loaded per user.
 * Users accumulate transactions over time; 1,000 is generous. */
export const MAX_CREDIT_TRANSACTIONS = 1_000;

/** Maximum papers in a single screening job.
 * Balances throughput with credit/cost predictability. */
export const MAX_SCREENING_PAPERS_PER_JOB = 200;

/** Maximum screening jobs listed per user. */
export const MAX_SCREENING_JOBS_PER_USER = 500;

/** Per-tier extraction paper limits. Single source of truth for v7.1 per-tier differentiation.
 * All tiers resolve to 1,000 in v7.0; edit this map only to adjust limits. */
export const EXTRACTION_LIMITS_BY_TIER: Record<SubscriptionPlan, number> = {
  free: 1_000,
  go: 1_000,
  pro: 1_000,
  enterprise: 1_000,
};

/** Maximum papers in a single extraction job.
 * Derived from per-tier map -- the global upper bound across all plans.
 * Existing callers import this unchanged; per-user limits use getExtractionLimitForUser. */
export const MAX_EXTRACTION_PAPERS_PER_JOB = Math.max(
  ...Object.values(EXTRACTION_LIMITS_BY_TIER),
);

/** Maximum extraction jobs listed per user. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;

/** Maximum extraction results fetched in internal .take() bounds.
 * Decoupled from the user-facing paper limit -- sized for 1,000 papers x ~10 questions.
 * Only internal query/mutation code uses this; user-facing cap remains MAX_EXTRACTION_PAPERS_PER_JOB. */
export const MAX_EXTRACTION_RESULTS_QUERY = 10_000;
