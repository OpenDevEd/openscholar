import type { PaperResult } from "@/lib/types/search.types";
import type { CitationData } from "./formats";
import { SHORT_WORK_ID, withoutWorkSite } from "@/lib/openalex/work-id";

const types: Record<string, string> = {
  "journal-article": "article-journal", "posted-content": "article", "proceedings-article": "paper-conference",
  "book-chapter": "chapter", "book-section": "chapter", "book-part": "chapter", "book-track": "chapter",
  "reference-entry": "entry-encyclopedia", "edited-book": "book", "reference-book": "book", monograph: "book",
  book: "book", dissertation: "thesis", dataset: "dataset", report: "report", standard: "standard",
};

// DOI content negotiation can retain the registration agency's type names.
export function normalizeCitationType(type: string) {
  return types[type] ?? type;
}

export function paperToCitationData(paper: PaperResult): CitationData | null {
  const title = (paper.title || paper.display_name)?.trim();
  const short = withoutWorkSite(paper.id);
  const id = SHORT_WORK_ID.test(short) ? short : undefined;
  if (!title || !id) return null;
  const source = paper.primary_location?.source;
  const data: CitationData = {
    id, title, "citation-key": `os_${id}`,
    type: types[paper.type_crossref ?? ""] ?? types[paper.type ?? ""] ?? (source?.type === "journal" ? "article-journal" : "document"),
  };
  // OpenAlex does not provide given/family fields. Never guess a surname by
  // splitting the display name; DOI metadata can supply structured names later.
  const author = paper.authorships?.flatMap(({ author }) => author.display_name?.trim() ? [{ literal: author.display_name.trim() }] : []);
  if (author?.length) data.author = author;
  if (paper.publication_date && /^\d{4}-\d{2}-\d{2}$/.test(paper.publication_date)) {
    data.issued = { "date-parts": [paper.publication_date.split("-").map(Number)] };
  } else if (paper.publication_year) data.issued = { "date-parts": [[paper.publication_year]] };
  if (source?.display_name) data["container-title"] = source.display_name;
  if (source?.issn_l) data.ISSN = source.issn_l;
  if (paper.language) data.language = paper.language;
  if (paper.biblio?.volume) data.volume = paper.biblio.volume;
  if (paper.biblio?.issue) data.issue = paper.biblio.issue;
  if (paper.biblio?.first_page) data.page = [...new Set([paper.biblio.first_page, paper.biblio.last_page].filter(Boolean))].join("-");
  const doi = paper.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
  if (doi && /^10\.\d{4,9}\/\S+$/i.test(doi)) data.DOI = doi;
  return data;
}
