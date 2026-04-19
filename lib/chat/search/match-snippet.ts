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

const ELLIPSIS = "\u2026";

export function extractMatchSnippet(
  source: string,
  query: string,
  maxLen = 60,
): Snippet | null {
  const q = query.trim();
  if (q.length === 0 || source.length === 0) return null;

  const idx = source.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;

  const start = Math.max(0, idx - Math.floor((maxLen - q.length) / 2));
  const end = Math.min(source.length, start + maxLen);
  const windowed = source.slice(start, end);
  const prefix = start > 0 ? ELLIPSIS : "";
  const suffix = end < source.length ? ELLIPSIS : "";

  const text = `${prefix}${windowed}${suffix}`;
  const matchStart = prefix.length + (idx - start);
  const matchEnd = matchStart + q.length;
  return { text, highlightRanges: [[matchStart, matchEnd]] };
}
