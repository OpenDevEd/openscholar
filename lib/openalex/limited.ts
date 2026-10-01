/**
 * An OpenAlex action's answer when the caller's requests ran out (#355). Server actions
 * lose thrown messages in production, so the limit travels as data and the page turns
 * it back into an error with `unlessLimited`.
 */
export type OpenAlexLimited = { openAlexLimited: true };

export const OPENALEX_LIMITED: OpenAlexLimited = { openAlexLimited: true };

/** Thrown in the browser for a limited answer; pages show the limit message for it. */
export class OpenAlexLimitedError extends Error {
  constructor() {
    super("Too many searches in a short time. Wait a minute and try again.");
    this.name = "OpenAlexLimitedError";
  }
}

export function isOpenAlexLimited(value: unknown): value is OpenAlexLimited {
  return typeof value === "object" && value !== null && (value as OpenAlexLimited).openAlexLimited === true;
}

/** The action's answer, or OpenAlexLimitedError when the caller's requests ran out. */
export async function unlessLimited<T>(answer: Promise<T | OpenAlexLimited>): Promise<T> {
  const value = await answer;
  if (isOpenAlexLimited(value)) throw new OpenAlexLimitedError();
  return value;
}
