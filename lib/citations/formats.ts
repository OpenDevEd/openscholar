export const CITATION_FORMATS = [
	{ id: "apa", label: "APA 7", style: "apa" },
	{ id: "harvard", label: "Harvard (Cite Them Right)", style: "harvard-cite-them-right" },
	{ id: "chicago", label: "Chicago 18 (author–date)", style: "chicago-author-date" },
	{ id: "mla", label: "MLA 9", style: "modern-language-association" },
	{ id: "vancouver", label: "Vancouver (NLM)", style: "nlm-citation-sequence" },
	{ id: "bibtex", label: "BibTeX", style: null },
] as const;

export type CitationFormat = (typeof CITATION_FORMATS)[number]["id"];
export type Citations = Record<CitationFormat, string>;
export type CitationResponse = { citations: Citations | null };

export type CitationName = { literal: string } | { family: string; given?: string };
export type CitationDate = { "date-parts": number[][] } | { literal: string };
export type CitationData = {
	id: string;
	type: string;
	title: string;
	"citation-key": string;
	[field: string]: string | number | CitationName[] | CitationDate | undefined;
};
