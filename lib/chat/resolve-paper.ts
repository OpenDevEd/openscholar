/**
 * Paper-reference resolution for chat-mode responses.
 *
 * Pure function: given a chunk of text and the ordered paper set for the
 * job, find every citation group and return the byte span plus the
 * resolved papers. A "group" is one pair of square brackets in the
 * assistant's text; it may contain a single citation (`[P3]`) or
 * multiple comma-separated ones (`[P1, P3, P7]`). The combined form
 * was observed in real production messages — Gemini routinely emits up
 * to ten papers inside one bracket pair.
 *
 * Mirrors the `[P1]..[PN]` ids emitted by `renderPaperCorpus`
 * (lib/chat/render-corpus.ts) — the paper at position `index - 1` in
 * the sorted corpus becomes `[P{index}]` in the assistant's response.
 *
 * The parser is intentionally narrow: it only matches well-formed
 * brackets of `[P<n>]` (case-insensitive) or the combined form.
 * Anything else falls through as text — a deliberate trade-off so
 * broken output is visible to the user, not silently rendered as
 * clickable-but-wrong pills.
 */

export interface ResolvablePaper {
  openalexId?: string;
  title: string;
  authors: ReadonlyArray<string>;
  year?: number;
  abstract?: string;
  doi?: string;
  pdfUrl?: string;
}

export interface PaperCitation<P extends ResolvablePaper = ResolvablePaper> {
  /** 1-based index from the text (e.g. `3` for `[P3]`). */
  index: number;
  /** The paper at `index - 1`, or `null` when the index is out of range. */
  paper: P | null;
}

export interface PaperCitationGroup<P extends ResolvablePaper = ResolvablePaper> {
  /** Byte offset of the opening `[` in the source text. */
  start: number;
  /** Byte offset one past the closing `]`. */
  end: number;
  /** Verbatim bracket text (for debugging / key generation). */
  raw: string;
  /** One entry per paper cited inside this bracket. */
  citations: PaperCitation<P>[];
}

// Outer matcher: one or more `P<n>` comma-separated inside square brackets.
// Case-insensitive so lowercase `[p1]` drift still resolves.
const GROUP_RE = /\[\s*[Pp]\d+(?:\s*,\s*[Pp]\d+)*\s*\]/g;
// Inner matcher: each `P<n>` reference inside a group.
const INNER_RE = /[Pp](\d+)/g;

export function resolvePaperReferences<P extends ResolvablePaper>(
  text: string,
  papers: ReadonlyArray<P>,
): PaperCitationGroup<P>[] {
  if (!text) return [];

  const groups: PaperCitationGroup<P>[] = [];
  const outer = new RegExp(GROUP_RE.source, GROUP_RE.flags);

  let m: RegExpExecArray | null;
  while ((m = outer.exec(text)) !== null) {
    const raw = m[0];
    const inner = new RegExp(INNER_RE.source, INNER_RE.flags);
    const citations: PaperCitation<P>[] = [];
    let im: RegExpExecArray | null;
    while ((im = inner.exec(raw)) !== null) {
      const index = Number.parseInt(im[1], 10);
      const paper =
        Number.isFinite(index) && index >= 1 && index <= papers.length
          ? papers[index - 1]
          : null;
      citations.push({ index, paper });
    }
    if (citations.length > 0) {
      groups.push({
        start: m.index,
        end: m.index + raw.length,
        raw,
        citations,
      });
    }
  }

  return groups;
}
