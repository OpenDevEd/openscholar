/** Maximum library items returned in a single browse/list query.
 * Based on practical upper bound of a user's library size. */
export const MAX_LIBRARY_BROWSE = 10_000;

/** Maximum collection memberships loaded for filtering.
 * Matches MAX_LIBRARY_BROWSE since a collection is a subset of library. */
export const MAX_COLLECTION_MEMBERS = 10_000;

/** Most people one Evidence Library grants access to directly, so its team reads in one query (#357). */
export const MAX_LIBRARY_MEMBERS = 1_000;

/** Most active organization members a team page lists; a larger organization gets an error, not a partial list. */
export const MAX_ORGANIZATION_MEMBERS_READ = 1_000;

/** Most Evidence Libraries one organization can make, so its library list reads in one query. */
export const MAX_LIBRARIES_PER_ORGANIZATION = 200;

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

/** Served hosts one mutation writes or prunes; a Coolify listing takes as many batches as it needs. */
export const SERVED_HOSTS_BATCH = 500;

/** Most Evidence Libraries one person is granted directly; another grant is refused, so their grants read in one query. */
export const MAX_LIBRARY_GRANTS_PER_PERSON = 200;

/** Most invitations one library has waiting; another is refused until some are answered, cancelled or expire. */
export const MAX_PENDING_INVITATIONS_PER_LIBRARY = 500;

/** Most invitations waiting for one address across libraries; another is refused until some are answered or expire. */
export const MAX_PENDING_INVITATIONS_PER_EMAIL = 100;

/** Most credentials one library stores: one per credential its configuration names. */
export const MAX_CREDENTIALS_PER_LIBRARY = 500;

/**
 * Of those, the places kept for the credentials a library's own setup writes (its database,
 * storage, application and service credentials: fixed keys, a handful). The credentials
 * people add are refused before they reach these, so setup can always finish.
 */
export const SETUP_CREDENTIALS_RESERVED = 20;

/** Most feature flags the table holds; the registry (lib/feature-flags/registry.ts) names a few dozen. */
export const MAX_FEATURE_FLAGS = 200;

/** Most author profiles one publication links to; a library's update naming more is refused. */
export const MAX_AUTHORS_PER_PUBLICATION = 1_000;

/**
 * Rows a write reads of something it keeps to one per person: a lock of one kind, a pending
 * Zotero sign-in, a Zotero connection, an active membership of one organization. Each write
 * removes the others it reads, so more than this can only be left by a burst, and the next
 * few writes clear it.
 */
export const SINGLE_ROW_CLEANUP = 10;

/**
 * Most accounts read for one email address when someone is invited. A deleted account keeps
 * its address, so this counts every sign-up and deletion of it; past it the invitation is refused.
 */
export const MAX_ACCOUNTS_PER_EMAIL = 100;

/** Most organizations one person is an active member of; past it their reads fail by name, not with a partial list. */
export const MAX_ORGANIZATIONS_PER_PERSON = 200;

/**
 * Most locations of one publication group a topic page reads looking for a public one. It
 * stops at the first, so only a group whose first copies are all private reads this far.
 */
export const MAX_LOCATIONS_READ_PER_GROUP = 100;

/**
 * Most queued or running operations of one library a guard reads. One setup, one deployment
 * and one teardown run at a time, so a library past this is refused as busy, by name.
 */
export const MAX_ACTIVE_OPERATIONS_READ = 50;
