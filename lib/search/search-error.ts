/**
 * A search failure carrying the upstream HTTP status as a structured field.
 *
 * Why this exists: OpenAlex calls run inside a Next `"use server"` action, and
 * Next strips thrown error *messages* in production builds. Classifying a search
 * failure by regex-scraping the message therefore breaks in prod. Throwing this
 * client-side (after the action returns a structured result) keeps `status` and
 * the real OpenAlex `message` intact so the toast can classify reliably.
 */
export class SearchError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

export interface SearchToastCopy {
  titleKey: "searchInvalidQuery" | "tooManyRequests" | "searchFailed";
  /** i18n key for the description (used when the copy is ours, e.g. rate limit). */
  descriptionKey?: "tooManyRequestsDescription";
  /** Raw description, e.g. OpenAlex's literal reason for a bad query. */
  description?: string;
}

function statusOf(error: unknown): number | null {
  if (error instanceof SearchError) return error.status;
  const s = (error as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  return undefined;
}

/**
 * Map a search failure to the toast title/description. Returns i18n keys (not
 * resolved strings) so it stays pure and testable without the i18n runtime.
 * For a 400 we surface OpenAlex's literal reason as the description.
 */
export function classifySearchError(error: unknown): SearchToastCopy {
  const status = statusOf(error);
  const message = messageOf(error);

  if (status === 429) {
    return {
      titleKey: "tooManyRequests",
      descriptionKey: "tooManyRequestsDescription",
    };
  }

  if (status === 400) {
    return { titleKey: "searchInvalidQuery", description: message };
  }

  return { titleKey: "searchFailed", description: message };
}
