/**
 * Extraction and chat limits. They're the same on every plan, so they're
 * constants shared by the server and the UI.
 */

/** Most papers one extraction job or chat can hold. */
export const PAPER_LIMIT = 1000;

/**
 * Most papers one search in the bucket can pull from OpenAlex: its
 * single-page ceiling without cursor pagination.
 */
export const PAPER_PULL_CAP = 200;

/** Papers a search pulls when it's first picked; never above the cap. */
export const PAPER_PULL_DEFAULT = 200;

/** Most papers one results page shows; an export reads pages of this size. */
export const RESULTS_PAGE_SIZE_MAX = 200;

/** Longest chat prompt the server takes: about 8,000 tokens. */
export const CHAT_PROMPT_MAX_CHARS = 32_000;

/** Chat replies a user can have generating at once. */
export const CHAT_CONCURRENCY_LIMIT = 3;

/**
 * Papers one extraction job works on at once. Measured on the e2e backend with 200
 * papers (#400): 109 s at 5, 38 s at 20, 20 s at 40, once the queue's bookkeeping ran on
 * its worker. The extraction pool runs as many.
 */
export const EXTRACTION_PAPER_CONCURRENCY = 40;

/** Questions answered at once for one paper. */
export const EXTRACTION_QUESTION_CONCURRENCY = 5;

/** How long a leased extraction queue row stays its worker's before recovery takes it back. */
export const EXTRACTION_QUEUE_LEASE_MS = 60_000;
