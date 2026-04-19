/**
 * Deterministic paper-corpus renderer for chat-mode prompts.
 *
 * Pure function — byte-identical output for a given paper set regardless
 * of insertion order. Sorted by openalexId ascending so the prompt
 * prefix stays stable across turns (prerequisite for prompt caching
 * when the provider layer starts forwarding cache_control; see plan
 * §4i for the rationale).
 */

export interface PaperForCorpus {
  openalexId?: string;
  title: string;
  authors: ReadonlyArray<string>;
  year?: number;
  abstract?: string;
}

/** Escape a handful of characters that would break the XML envelope. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sorts papers by openalexId ascending. Missing IDs sort last (preserves
 * the historical order among those so the output stays deterministic).
 */
export function sortPapersForCorpus<T extends PaperForCorpus>(
  papers: ReadonlyArray<T>,
): T[] {
  const withIds = papers
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !!p.openalexId);
  const withoutIds = papers
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.openalexId);

  withIds.sort((a, b) => {
    if (a.p.openalexId! < b.p.openalexId!) return -1;
    if (a.p.openalexId! > b.p.openalexId!) return 1;
    return 0;
  });
  withoutIds.sort((a, b) => a.i - b.i);

  return [...withIds.map(({ p }) => p), ...withoutIds.map(({ p }) => p)];
}

export function renderPaperCorpus(
  papers: ReadonlyArray<PaperForCorpus>,
): string {
  const sorted = sortPapersForCorpus(papers);
  const blocks: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const id = `P${i + 1}`;
    const oa = p.openalexId ? xmlEscape(p.openalexId) : "";
    const title = xmlEscape(p.title);
    const authors = xmlEscape(p.authors.join(", ") || "Unknown");
    const year = p.year != null ? String(p.year) : "Unknown";
    const abstract =
      p.abstract && p.abstract.trim().length > 0
        ? xmlEscape(p.abstract.trim())
        : "(no abstract available)";
    blocks.push(
      `<paper id="${id}"${oa ? ` openalex="${oa}"` : ""}>\n` +
        `<title>${title}</title>\n` +
        `<year>${year}</year>\n` +
        `<authors>${authors}</authors>\n` +
        `<abstract>${abstract}</abstract>\n` +
        `</paper>`,
    );
  }
  return blocks.join("\n\n");
}
