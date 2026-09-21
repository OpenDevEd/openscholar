import type { CitationData } from "./formats";

export type PaperCitationRequest = readonly ["paper-citations", CitationData, string];

export async function loadPaperCitations([, data, locale]: PaperCitationRequest) {
  const { formatCitations } = await import("./formatter");
  return { citations: await formatCitations(data, locale) };
}
