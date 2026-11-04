/**
 * Writing a search query from a research question costs people nothing when they can't pay for it:
 * signed out, out of credits, or on a key that failed. It runs on our key, on a model and within
 * limits the site's admins set. Nothing else AI does is free this way.
 */
export const FREE_QUESTIONS_FLAG = "search.freeQuestions";

/** What applies until an admin changes it. */
export const FREE_QUERY_DEFAULTS = {
  modelId: "anthropic/claude-haiku-5.5",
  effort: "none",
  /** Per UTC day. An address can be a whole university, so it's generous. */
  perAddress: 50,
  perPerson: 200,
  /** Per UTC day across everyone: what the free writing can cost at most. Separate, so bots can't use up the allowance of people signed in. */
  signedOutPerDay: 20_000,
  signedInPerDay: 20_000,
} as const;

/** A question past this is cut: a query needs no more, and it bounds what one call costs. */
export const FREE_QUESTION_MAX = 2_000;

/** The most one free call may write, reasoning included: a query needs far less. An admin who picks a high effort may need this raised. */
export const FREE_QUERY_MAX_OUTPUT_TOKENS = 1_500;

/** Validation failures a free call may ask the model again for. One call shouldn't cost eleven. */
export const FREE_QUERY_MAX_RETRIES = 2;

export const FREE_QUERY_LIMITS = ["perAddress", "perPerson", "signedOutPerDay", "signedInPerDay"] as const;
export type FreeQueryLimit = (typeof FREE_QUERY_LIMITS)[number];
