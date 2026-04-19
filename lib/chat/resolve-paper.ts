/**
 * Paper-reference resolution for chat-mode responses.
 *
 * Pure function: given a chunk of text and the live source set for the
 * chat, find every citation group and return the byte span plus the
 * resolved papers. A "group" is one pair of square brackets in the
 * assistant's text; it may contain a single citation (`[P3]`) or
 * multiple comma-separated ones (`[P1, P3, P7]`). The combined form
 * was observed in real production messages — Gemini routinely emits up
 * to ten papers inside one bracket pair.
 *
 * Lookup is by **stable `position`**, not array index. The paper whose
 * `position === N` becomes `[P{N}]`. Positional gaps are first-class:
 * if a source at position 2 was excluded (soft-hidden from the prompt)
 * but a past assistant message still cites `[P2]`, the resolver returns
 * `null` — the pill renders as `unresolved`. If the caller instead
 * passes a `chatPapers`-joined list that keeps every source in the
 * array and only toggles the `included` flag, `[P2]` still resolves
 * and the pill renders `excluded` (still clickable). Both render paths
 * come from `classifyCitationState`.
 *
 * The parser is intentionally narrow: it only matches well-formed
 * brackets of `[P<n>]` (case-insensitive) or the combined form.
 * Anything else falls through as text — a deliberate trade-off so
 * broken output is visible to the user, not silently rendered as
 * clickable-but-wrong pills.
 */

import type { Id } from "@/convex/_generated/dataModel";

export interface ResolvablePaper {
  sourceId: Id<"extractionJobSources">;
  chatPaperId: Id<"chatPapers">;
  position: number;
  title: string;
  authors: ReadonlyArray<string>;
  year: number | null;
  abstract: string | null;
  doi: string | null;
  pdfUrl: string | null;
  openalexId: string | null;
  included: boolean;
}

export interface PaperCitation<P extends ResolvablePaper = ResolvablePaper> {
  /** 1-based number from the text (e.g. `3` for `[P3]`); lines up with `position`. */
  index: number;
  /** The paper whose `position` equals `index`, or `null` when no such paper is live. */
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

  const byPosition = new Map<number, P>();
  for (const p of papers) byPosition.set(p.position, p);

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
      const paper = Number.isFinite(index)
        ? (byPosition.get(index) ?? null)
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
