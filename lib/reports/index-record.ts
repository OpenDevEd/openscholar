// A live report as Openscholar's search index takes it (OpenDevEd/openalex-count#1437): the record the search engine
// reads from the feed (convex/reports/searchIndex.ts) and writes into the index, where its API serves it as a work with
// its R… id. The engine refuses a record that breaks its rules, so every list keeps only values in the form it takes.
import { fullTitle, isAuthor, isOrcid, type Metadata } from "./report";

export type IndexRecord = {
  title: string;
  abstract: string;
  date: string;
  type: string;
  language: string | null;
  authors: Array<{ name: string; orcid: string | null; affiliations: Array<{ id: string | null; name: string; country: string | null }> }>;
  topics: string[];
  sdgs: string[];
  funders: string[];
  licence: string | null;
  series: { name: string; issn: string | null };
  pageUrl: string;
  pdfUrl: string | null;
};

/** An OpenAlex ID with this letter, bare (I27837315), from the ID or its address; null for anything else. */
const openalexId = (id: string | null, letter: "I" | "F" | "T") => {
  const bare = id?.split("/").at(-1)?.toUpperCase();
  return bare && new RegExp(`^${letter}\\d+$`).test(bare) ? bare : null;
};

/** A value in the form the index takes, or null: a code an older report kept in another form never costs it its place. */
const formed = (value: string, form: RegExp) => (form.test(value) ? value : null);

/**
 * The record of a live report. `site` is the address Openscholar answers at, which its page and PDF are served from.
 * Its authors are the people its citation names; a topic a person picked above the topics (a field, a subfield) and a
 * funder OpenAlex doesn't know have no ID the index takes, so they stay on the report's page alone.
 */
export function indexRecord(report: { key: string; hasPdf: boolean }, m: Metadata, series: { name: string; issn: string }, site: string): IndexRecord {
  return {
    title: fullTitle(m),
    abstract: m.abstract,
    date: m.date,
    type: m.type.toLowerCase(),
    language: formed(m.language.toLowerCase(), /^[a-z]{2}$/),
    authors: m.authors
      .filter((author) => isAuthor(author) && author.name.trim())
      .map((author) => ({
        name: author.name.trim(),
        orcid: isOrcid(author.orcid) ? author.orcid : null,
        affiliations: author.affiliations.map((place) => ({ id: openalexId(place.id, "I"), name: place.name, country: formed(place.country.toUpperCase(), /^[A-Z]{2}$/) })),
      })),
    topics: m.topics.flatMap((topic) => openalexId(topic.id, "T") ?? []),
    sdgs: m.sdgs,
    funders: [...new Set(m.funding.flatMap((f) => openalexId(f.funder.id, "F") ?? []))],
    licence: typeof m.licence === "string" ? m.licence : null,
    series: { name: series.name, issn: series.issn || null },
    pageUrl: `${site}/papers/${report.key}`,
    pdfUrl: report.hasPdf ? `${site}/papers/${report.key}/report.pdf` : null,
  };
}

/** JSON with every object's keys in order and no spaces, so the same record always reads the same: what its digest is of. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
