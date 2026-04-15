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

/** Maximum papers in a single extraction job.
 * Matches screening limit -- balances throughput with cost predictability. */
export const MAX_EXTRACTION_PAPERS_PER_JOB = 200;

/** Maximum extraction jobs listed per user. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;
