/**
 * Paper-reference resolution for chat-mode responses.
 *
 * Pure function: given a chunk of text and the ordered paper set for the
 * job, find every `[P{n}]` token and return byte offsets + resolved paper
 * (or `null` when the index is out of range). A renderer can splice the
 * matches into React nodes; this module has no React dependency.
 *
 * Mirrors the `[P1]..[PN]` ids emitted by `renderPaperCorpus`
 * (lib/chat/render-corpus.ts) — the paper at position `index - 1` in the
 * sorted corpus becomes `[P{index}]` in the assistant's response.
 */

export interface ResolvablePaper {
  openalexId?: string;
  title: string;
  authors: ReadonlyArray<string>;
  year?: number;
  abstract?: string;
  doi?: string;
}

export interface PaperReferenceMatch<P extends ResolvablePaper = ResolvablePaper> {
  /** Byte offset of the opening `[` in the source text. */
  start: number;
  /** Byte offset one past the closing `]`. */
  end: number;
  /** The 1-based index as it appeared in the text. */
  index: number;
  /** The paper at `index - 1`, or `null` when the index is out of range. */
  paper: P | null;
}

const PAPER_REFERENCE_RE = /\[P(\d+)\]/g;

export function resolvePaperReference<P extends ResolvablePaper>(
  text: string,
  papers: ReadonlyArray<P>,
): PaperReferenceMatch<P>[] {
  if (!text) return [];
  // Scope a fresh regex per call so interleaved calls don't clobber
  // `lastIndex` on a module-level stateful instance.
  const re = new RegExp(PAPER_REFERENCE_RE.source, "g");
  const out: PaperReferenceMatch<P>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const index = Number.parseInt(m[1], 10);
    const paper =
      Number.isFinite(index) && index >= 1 && index <= papers.length
        ? papers[index - 1]
        : null;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      index,
      paper,
    });
  }
  return out;
}
