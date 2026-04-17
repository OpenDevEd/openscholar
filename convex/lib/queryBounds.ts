/** Maximum library items returned in a single browse/list query.
 * Based on practical upper bound of a user's library size. */
export const MAX_LIBRARY_BROWSE = 10_000;

/** Maximum collection memberships loaded for filtering.
 * Matches MAX_LIBRARY_BROWSE since a collection is a subset of library. */
export const MAX_COLLECTION_MEMBERS = 10_000;

/** Maximum extraction jobs listed per user.
 * Users accumulate jobs over time; 500 is generous for any reasonable usage. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;

/** Maximum evidence units loaded per paper.
 * Each extraction run produces evidence; 200 per paper is generous. */
export const MAX_EVIDENCE_UNITS_PER_PAPER = 200;

/** Maximum reviews loaded in a single batch by job.
 * Worst case: 1000 papers x 20 questions = 20,000 reviews. */
export const MAX_REVIEWS_PER_JOB = 20_000;

/** Maximum credit transactions loaded per user.
 * Users accumulate transactions over time; 1,000 is generous. */
export const MAX_CREDIT_TRANSACTIONS = 1_000;

/** Maximum papers in a single screening job.
 * Balances throughput with credit/cost predictability. */
export const MAX_SCREENING_PAPERS_PER_JOB = 200;

/** Maximum screening jobs listed per user.
 * Matches extraction job limit for consistency. */
export const MAX_SCREENING_JOBS_PER_USER = 500;
