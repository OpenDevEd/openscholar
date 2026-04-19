/**
 * Pure weighted scorer for the chat Sources panel search box.
 *
 * Produces a 0..1 score per row against a query, plus the field that
 * produced the best match. Used by:
 * - cmdk's `filter` prop to rank visible rows in the search popover
 * - the row renderer to decide whether to show a match-snippet line
 *   (when the hit came from `abstract`, `doi`, or `openalexId` rather
 *   than fields already visible in the row chrome).
 *
 * Weights (D6, locked 2026-04-19):
 *   idExact 5 · title 3 · authors 2 · year 1 · abstract 0.5
 *
 * The output `score` is normalized to 0..1 so the cmdk contract is
 * honored: cmdk expects each item's score in [0, 1], where 0 hides the
 * row and 1 is the best possible match.
 */

export type ScorerField =
  | "title"
  | "authors"
  | "year"
  | "abstract"
  | "doi"
  | "openalexId"
  | null;

export type SearchMatch = {
  score: number;
  field: ScorerField;
};

export type ScorerInput = {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
  openalexId: string | null;
};

const WEIGHTS = {
  idExact: 5,
  title: 3,
  authors: 2,
  year: 1,
  abstract: 0.5,
} as const;

// Cheap substring scorer in [0, 1]. A leading-token match boosts above
// a mid-string match so "marine" matches "marine algae" stronger than
// "submarine". A non-match returns 0.
function fuzzyScore(haystack: string, needle: string): number {
  if (needle.length === 0) return 1;
  const idx = haystack.indexOf(needle);
  if (idx === -1) return 0;
  if (idx === 0 || haystack[idx - 1] === " ") return 1;
  return 0.7;
}

export function scoreSource(row: ScorerInput, query: string): SearchMatch {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { score: 1, field: null };

  if (row.doi !== null && row.doi.toLowerCase() === q) {
    return { score: 1, field: "doi" };
  }
  if (row.openalexId !== null && row.openalexId.toLowerCase() === q) {
    return { score: 1, field: "openalexId" };
  }

  const titleScore = fuzzyScore(row.title.toLowerCase(), q) * WEIGHTS.title;
  const ranked: Array<{ score: number; field: ScorerField }> = [
    { score: titleScore, field: "title" },
  ];
  const best = ranked.reduce((acc, r) => (r.score > acc.score ? r : acc));
  if (best.score === 0) return { score: 0, field: null };
  return { score: Math.min(best.score / WEIGHTS.idExact, 1), field: best.field };
}
