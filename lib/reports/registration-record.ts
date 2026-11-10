// A report as its registrars take it (plans/publish-reports): the record @opendeved/doi-sync-core maps to Crossref's
// report-paper deposit and to Zenodo's record, as new-el's publication worker hands it a community's.
import type { Metadata } from "./report";
import type { Series } from "./settings";

/**
 * ponytail: a report's authors are names with no word on whether each is a person or a body, so a body is told by
 * the words such names carry. One it misses is filed as a person ("Organization, World Health"), and a person it
 * catches keeps their name whole, which reads right either way. Ask on the details form when either matters.
 */
const BODY = /\b(organi[sz]ation|universit[yé]|institut[eo]?|minist(ry|ère|erio)|foundation|bank|agency|council|committee|commission|department|cent(er|re)|network|association|society|programme|consortium|collaboration|authority|ltd|inc|gmbh|llc)\b/i;
const ACRONYM = /\b(WHO|UNICEF|UNESCO|OECD|FAO|UNDP|IMF)\b/;

/** A report's licence as Zenodo's vocabulary names it. */
const LICENSE_ID: Record<Metadata["licence"], string> = { "CC BY 4.0": "cc-by-4.0" };

/** A person's name as the registrars keep one: family name, then given names. A single word is a family name. A body keeps its name as it is. */
function creator(author: Metadata["authors"][number]) {
  if (!author.orcid && (BODY.test(author.name) || ACRONYM.test(author.name))) return { type: "organizational" as const, name: author.name.trim(), creatorType: "author" };
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
export function registrationRecord(report: { key: string; doi: string; withdrawn: boolean }, m: Metadata, series: Pick<Series, "name" | "issn">, origin: string) {
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
    // The licence its author agreed to publish under, as Zenodo names it: the same wherever the report is registered.
    license: LICENSE_ID[m.licence],
    creators: m.authors.filter((author) => author.name.trim()).map(creator),
    tags: m.keywords,
    doi: report.doi,
    landingUrl: `${origin.replace(/\/+$/, "")}/papers/${report.key}`,
    fields: { reportNumber: report.key, seriesTitle: series.name, ...(series.issn && { ISSN: series.issn }) },
  };
}
