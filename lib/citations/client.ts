import type { CitationData } from "./formats";

export type PaperCitationRequest = readonly ["paper-citations", CitationData, string];

export async function loadPaperCitations([, data, locale]: PaperCitationRequest) {
  const { formatCitations } = await import("./formatter");
  return { citations: await formatCitations(data, locale) };
}

export async function loadAdditionalCitation([, record, locale, style]: readonly [
  "citation-style", import("./formats").CitationData, string, import("./formats").CitationStyle,
]): Promise<import("./formats").FormattedCitation> {
  const { formatAdditionalCitation } = await import("./formatter");
  return formatAdditionalCitation(record, locale, style);
}
