import type { PaperResult } from "@/lib/types/search.types";
import type { CitationData } from "./formats";

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
  // An Openscholar Report (R…) is cited like any paper of ours.
  const id = paper.id.match(/(?:^|\/)(?:W|OS|R)\d+$/)?.[0].replace(/^\//, "");
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
  // A year, a month or a day, as precisely as the work states it: a report's PDF may give only a month.
  if (paper.publication_date && /^\d{4}(?:-\d{2}){0,2}$/.test(paper.publication_date)) {
    data.issued = { "date-parts": [paper.publication_date.split("-").map(Number)] };
  } else if (paper.publication_year) data.issued = { "date-parts": [[paper.publication_year]] };
  // An Openscholar Report is numbered in a series Openscholar publishes, and is cited as such: "Title (Openscholar
  // Reports R100022). Openscholar." BibTeX and RIS carry the series as `series` and T2. A container title as well
  // printed the series twice ("In Openscholar Reports (Openscholar Reports)").
  if (source?.display_name && id.startsWith("R")) {
    Object.assign(data, { "collection-title": source.display_name, "collection-number": id, publisher: "Openscholar" });
    // A thesis is cited with the university that awarded it, its first author's first institution, as Zenodo files it
    // (lib/reports/registration-record.ts). Without one, a dissertation is cited as a report.
    const university = paper.authorships?.[0]?.institutions?.[0]?.display_name;
    if (data.type === "thesis") Object.assign(data, university ? { publisher: university } : { type: "report" });
  } else if (source?.display_name) data["container-title"] = source.display_name;
  if (source?.issn_l) data.ISSN = source.issn_l;
  if (paper.language) data.language = paper.language;
  if (paper.biblio?.volume) data.volume = paper.biblio.volume;
  if (paper.biblio?.issue) data.issue = paper.biblio.issue;
  if (paper.biblio?.first_page) data.page = [...new Set([paper.biblio.first_page, paper.biblio.last_page].filter(Boolean))].join("-");
  const doi = paper.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
  if (doi && /^10\.\d{4,9}\/\S+$/i.test(doi)) data.DOI = doi;
  return data;
}
