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
  readonly detail: QueryErrorDetail | null;

  constructor(message: string, status: number | null, detail: QueryErrorDetail | null = null) {
    super(message);
    this.name = "SearchError";
    this.status = status;
    this.detail = detail;
  }
}

/** Why OpenAlex rejected a query, and where in the query it stopped. */
export type QueryErrorDetail = {
  problem: string;
  fix?: string;
  near?: { before: string; token: string; after: string };
};

const NEAR = 40;

/**
 * Splits OpenAlex's "problem  Fix: remedy" message and, when it gives a
 * position, cuts the query around it with the failing token on its own.
 */
export function describeQueryError(
  query: string,
  error: { message?: string; position?: number | null },
): QueryErrorDetail {
  const [problem, fix] = (error.message ?? "").split(/\s+Fix:\s+/);
  const at = error.position;
  const detail: QueryErrorDetail = { problem: problem.trim(), ...(fix ? { fix: fix.trim() } : {}) };
  if (typeof at !== "number" || at < 0 || at >= query.length) return detail;
  const token = query.slice(at).match(/^("[^"]*"|[^\s()]+|\S)/)?.[0] ?? "";
  const end = at + token.length;
  return {
    ...detail,
    near: {
      before: (at > NEAR ? "…" : "") + query.slice(Math.max(0, at - NEAR), at),
      token,
      after: query.slice(end, end + NEAR) + (end + NEAR < query.length ? "…" : ""),
    },
  };
}

/** A query OpenAlex rejected, as opposed to a failed request. */
export function rejectedQuery(error: unknown): QueryErrorDetail | null {
  if (!(error instanceof SearchError) || error.status !== 400) return null;
  return error.detail ?? { problem: error.message };
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
