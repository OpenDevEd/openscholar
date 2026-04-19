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

type RankedField = { score: number; field: ScorerField };

function pickBestField(candidates: ReadonlyArray<RankedField>): RankedField {
  return candidates.reduce((acc, r) => (r.score > acc.score ? r : acc), {
    score: 0,
    field: null,
  });
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

  const best = pickBestField([
    {
      score: fuzzyScore(row.title.toLowerCase(), q) * WEIGHTS.title,
      field: "title",
    },
    {
      score: fuzzyScore(row.authors.join(" ").toLowerCase(), q) * WEIGHTS.authors,
      field: "authors",
    },
    {
      score:
        row.year !== null && String(row.year).includes(q) ? WEIGHTS.year : 0,
      field: "year",
    },
    {
      score:
        row.abstract !== null
          ? fuzzyScore(row.abstract.toLowerCase(), q) * WEIGHTS.abstract
          : 0,
      field: "abstract",
    },
  ]);

  if (best.score === 0) return { score: 0, field: null };
  return { score: Math.min(best.score / WEIGHTS.idExact, 1), field: best.field };
}

/**
 * Filter + rank a row collection by `scoreSource(row, query)`. Rows
 * with score == 0 are dropped; surviving rows sort by score descending,
 * with the original input order preserved as a stable tiebreaker.
 *
 * Empty query returns the input unchanged (every row scores 1 with
 * field=null), so the default order survives.
 */
export function runWeightedSearch<R extends ScorerInput>(
  rows: ReadonlyArray<R>,
  query: string,
): R[] {
  const q = query.trim();
  if (q.length === 0) return rows.slice();

  const scored = rows
    .map((row, index) => ({ row, index, match: scoreSource(row, query) }))
    .filter((entry) => entry.match.score > 0);

  scored.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
  return scored.map((entry) => entry.row);
}
