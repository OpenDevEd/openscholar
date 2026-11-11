export const CITATION_FORMATS = [
	{ id: "apa", label: "APA 7", style: "apa" },
	{ id: "harvard", label: "Harvard (Cite Them Right)", style: "harvard-cite-them-right" },
	{ id: "chicago", label: "Chicago 18 (author–date)", style: "chicago-author-date" },
	{ id: "mla", label: "MLA 9", style: "modern-language-association" },
	{ id: "vancouver", label: "Vancouver (NLM)", style: "nlm-citation-sequence" },
	{ id: "bibtex", label: "BibTeX", style: null },
] as const;

export type CitationStyle = { label: string } & (
  | { id: CitationFormat; asset?: undefined }
  | { id: string; asset: string }
);

export type CitationFormat = (typeof CITATION_FORMATS)[number]["id"];
export type FormattedCitation = { text: string; html: string | null };
export type Citations = Record<CitationFormat, FormattedCitation>;

type CitationName = { literal: string } | { family: string; given?: string };
type CitationDate = { "date-parts": number[][] } | { literal: string };
export type CitationData = {
	id: string;
	type: string;
	title: string;
	"citation-key": string;
	[field: string]: string | number | CitationName[] | CitationDate | undefined;
};

/** The files reference managers import: RIS for EndNote, Mendeley and Zotero, BibTeX for LaTeX. */
export const CITATION_FILES = {
	ris: { extension: "ris", type: "application/x-research-info-systems", format: "ris" },
	bibtex: { extension: "bib", type: "application/x-bibtex", format: "bibtex" },
} as const;

export type CitationFile = keyof typeof CITATION_FILES;

/**
 * A record as BibTeX and RIS are written from it. A report's number in its series is CSL's `collection-number`, which the
 * formatted styles print after the series ("Openscholar Reports R100022"); BibTeX's `number` comes only from CSL's
 * `number`, so it goes in as that too. Copied BibTeX and both files go through here.
 */
export function forFiles(data: CitationData): CitationData {
	const number = data["collection-number"];
	return number && !data.number ? { ...data, number } : data;
}
