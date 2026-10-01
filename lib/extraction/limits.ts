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

/** Papers one extraction job works on at once. */
export const EXTRACTION_PAPER_CONCURRENCY = 5;

/** Questions answered at once for one paper. */
export const EXTRACTION_QUESTION_CONCURRENCY = 5;
