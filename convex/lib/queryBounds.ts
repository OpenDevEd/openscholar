/** Maximum library items returned in a single browse/list query.
 * Based on practical upper bound of a user's library size. */
export const MAX_LIBRARY_BROWSE = 10_000;

/** Maximum collection memberships loaded for filtering.
 * Matches MAX_LIBRARY_BROWSE since a collection is a subset of library. */
export const MAX_COLLECTION_MEMBERS = 10_000;

/** Most collections one user can make, so every list of their collections stays small. */
export const MAX_COLLECTIONS_PER_USER = 500;

/** Maximum extraction jobs listed per user.
 * Users accumulate jobs over time; 500 is generous for any reasonable usage. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;

/** Maximum evidence units loaded per paper.
 * Each extraction run produces evidence; 200 per paper is generous. */
export const MAX_EVIDENCE_UNITS_PER_PAPER = 200;

/** Maximum reviews loaded in a single batch by job.
 * Worst case: PAPER_LIMIT (1000) × MAX_QUESTIONS_PER_JOB (50) = 50,000
 * reviews (one per result). Kept in sync with the result-table cap used
 * by loadResultsByJob and loadJobDataForReporting. */
export const MAX_REVIEWS_PER_JOB = 50_000;

/** Maximum credit transactions loaded per user.
 * Users accumulate transactions over time; 1,000 is generous. */
export const MAX_CREDIT_TRANSACTIONS = 1_000;

/** Maximum papers in a single screening job.
 * Balances throughput with credit/cost predictability. The Screen-All dialog
 * pages OpenAlex (200/page) to collect up to this many. Stays within
 * MAX_REVIEWS_PER_JOB (1000 × 50 questions = 50,000). */
export const MAX_SCREENING_PAPERS_PER_JOB = 1000;

/** Maximum screening jobs listed per user.
 * Matches extraction job limit for consistency. */
export const MAX_SCREENING_JOBS_PER_USER = 500;
