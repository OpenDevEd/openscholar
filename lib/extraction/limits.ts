

/** Papers a search pulls when it's first picked, and what a search saved without a count pulls; the count can be raised to the plan's limit. */
export const PAPER_PULL_DEFAULT = 200;

/** Most papers one results page shows; an export reads pages of this size. */
export const RESULTS_PAGE_SIZE_MAX = 200;

/** Longest chat prompt the server takes: about 8,000 tokens. */
export const CHAT_PROMPT_MAX_CHARS = 32_000;

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
