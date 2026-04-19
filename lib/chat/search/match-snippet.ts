/**
 * Pure snippet extractor for the chat Sources panel match preview.
 *
 * When `scoreSource` reports that a row matched on `abstract`, `doi`, or
 * `openalexId` (fields not already visible in the row chrome), the row
 * renderer calls this to produce a 60-char window of context around the
 * match plus the highlight ranges to wrap in `<mark>`.
 *
 * Returns `null` when there is no match (or no query / no source) so
 * callers can early-return without rendering anything.
 */

export type Snippet = {
  text: string;
  highlightRanges: Array<[number, number]>;
};

export function extractMatchSnippet(
  _source: string,
  _query: string,
  _maxLen = 60,
): Snippet | null {
  return null;
}
