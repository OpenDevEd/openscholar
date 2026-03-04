/**
 * XSS-safe text highlighting component.
 *
 * Uses text splitting instead of dangerouslySetInnerHTML to render
 * search query matches with <mark> elements. React's JSX auto-escapes
 * all text content, eliminating XSS attack vectors from user input or
 * AI-generated answers containing HTML.
 */

interface TextSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Split text into segments based on a search query.
 *
 * Returns an array of segments where matching portions are flagged with
 * `isMatch: true`. Matching is case-insensitive. Special regex characters
 * in the query are escaped to match literally.
 */
export function splitTextByQuery(text: string, query: string): TextSegment[] {
  if (!query || !query.trim()) {
    return [{ text, isMatch: false }];
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  const queryLower = query.toLowerCase();

  return parts
    .filter((part) => part !== "")
    .map((part) => ({
      text: part,
      isMatch: part.toLowerCase() === queryLower,
    }));
}

/**
 * React component that renders text with highlighted search matches.
 *
 * Matching segments are wrapped in <mark> elements with highlight styling.
 * All text is rendered via JSX (auto-escaped), never via innerHTML.
 */
export function HighlightedText({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const segments = splitTextByQuery(text, query);

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.isMatch ? (
          <mark
            key={i}
            className="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          seg.text
        )
      )}
    </span>
  );
}
