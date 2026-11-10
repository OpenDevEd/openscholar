// A report as its registrars take it (plans/publish-reports): the record @opendeved/doi-sync-core maps to Crossref's
// report-paper deposit and to Zenodo's record, as new-el's publication worker hands it a community's.
import type { Metadata } from "./report";
import type { Series } from "./settings";

/** A person's name as the registrars keep one: family name, then given names. A single word is a family name. */
function creator(author: Metadata["authors"][number]) {
  const words = author.name.trim().split(/\s+/);
  const familyName = words.at(-1)!;
  const givenName = words.slice(0, -1).join(" ");
  return {
    type: "personal" as const,
    name: [familyName, givenName].filter(Boolean).join(", "),
    creatorType: "author",
    ...(givenName && { givenName }),
    familyName,
    ...(author.affiliations[0]?.name && { affiliation: author.affiliations[0].name }),
    ...(author.orcid && { orcid: author.orcid }),
  };
}

/**
 * The record of a report as it stands. A withdrawn one keeps its DOI, which can't be removed, and is registered
 * again with its title saying so, as Crossref asks of withdrawn work.
 */
export function registrationRecord(report: { key: string; doi: string; withdrawn: boolean }, m: Metadata, series: Pick<Series, "name" | "issn">, license: string, origin: string) {
  const title = m.subtitle.trim() ? `${m.title.trim()}: ${m.subtitle.trim()}` : m.title.trim();
  return {
    itemType: "Report",
    title: report.withdrawn ? `WITHDRAWN: ${title}` : title,
    publicationDate: m.date,
    ...(m.abstract.trim() && { abstract: m.abstract.trim() }),
    ...(m.language && { language: m.language }),
    publisher: "Openscholar",
    institution: series.name,
    rights: m.licence,
    license,
    creators: m.authors.filter((author) => author.name.trim()).map(creator),
    tags: m.keywords,
    doi: report.doi,
    landingUrl: `${origin.replace(/\/+$/, "")}/papers/${report.key}`,
    fields: { reportNumber: report.key, seriesTitle: series.name, ...(series.issn && { ISSN: series.issn }) },
  };
}
