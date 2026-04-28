/**
 * Deterministic paper-corpus renderer for chat-mode prompts.
 *
 * Pure function. Emits the full `<papers count="N">...</papers>` XML
 * envelope. Each paper's `id` attribute is its `promptId` — anchored
 * on the upstream `position` field, not the array index — so excluding
 * a source leaves a stable hole in the emitted id sequence instead of
 * renumbering surviving papers. See `filterAndPreservePositions` for
 * the upstream gap-preserving filter step.
 */

export type CorpusSource = {
  sourceId: string;
  position: number;
  openalexId?: string;
  title: string;
  authors: ReadonlyArray<string>;
  year?: number;
  abstract?: string;
  doi?: string;
  pdfUrl?: string;
  citedByCount?: number;
  venueName?: string;
  workType?: string;
};

export type CorpusSourceForPrompt = CorpusSource & {
  promptId: `P${number}`;
};

export function toPromptId(position: number): `P${number}` {
  return `P${position}`;
}

export function filterAndPreservePositions(
  sources: ReadonlyArray<CorpusSource>,
  includedSourceIds: ReadonlySet<string>,
): CorpusSourceForPrompt[] {
  const out: CorpusSourceForPrompt[] = [];
  for (const s of sources) {
    if (!includedSourceIds.has(s.sourceId)) continue;
    out.push({ ...s, promptId: toPromptId(s.position) });
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPaperCorpus(
  papers: ReadonlyArray<CorpusSourceForPrompt>,
): string {
  if (papers.length === 0) {
    return `<papers count="0"></papers>`;
  }
  const blocks = papers.map((p) => {
    const oa = p.openalexId ? xmlEscape(p.openalexId) : "";
    const title = xmlEscape(p.title);
    const authors = xmlEscape(p.authors.join(", ") || "Unknown");
    const year = p.year != null ? String(p.year) : "Unknown";
    const abstract =
      p.abstract && p.abstract.trim().length > 0
        ? xmlEscape(p.abstract.trim())
        : "(no abstract available)";
    // Optional metric tags. Omitted entirely (not rendered as "Unknown")
    // when the upstream source has no value, so non-OpenAlex papers do
    // not pollute the prompt with empty signals.
    const venueTag =
      p.venueName && p.venueName.trim().length > 0
        ? `<venue>${xmlEscape(p.venueName.trim())}</venue>\n`
        : "";
    const typeTag =
      p.workType && p.workType.trim().length > 0
        ? `<type>${xmlEscape(p.workType.trim())}</type>\n`
        : "";
    // 0 is meaningful for citedByCount — render it as-is.
    const citedByTag =
      typeof p.citedByCount === "number"
        ? `<citedBy>${p.citedByCount}</citedBy>\n`
        : "";
    return (
      `<paper id="${p.promptId}"${oa ? ` openalex="${oa}"` : ""}>\n` +
      `<title>${title}</title>\n` +
      `<year>${year}</year>\n` +
      `<authors>${authors}</authors>\n` +
      venueTag +
      typeTag +
      citedByTag +
      `<abstract>${abstract}</abstract>\n` +
      `</paper>`
    );
  });
  return `<papers count="${papers.length}">\n${blocks.join("\n\n")}\n</papers>`;
}
