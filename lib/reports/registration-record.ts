// A report as its registrars take it (plans/publish-reports): the record @opendeved/doi-sync-core maps to Crossref's
// report-paper deposit and to Zenodo's record, as new-el's publication worker hands it a community's. It carries every
// field of a report's details that either registrar takes (plans/registrar-metadata).
import { CREDIT_ROLES, type CreditRole } from "@opendeved/doi-sync-core";
import { SDGS, STUDY_DESIGNS } from "../openalex/vocabulary";
import { LICENCES, doiIn, isAuthor, type Metadata, type RelationKind, wholeDate } from "./report";
import type { Series } from "./settings";

/**
 * ponytail: a report's authors are names with no word on whether each is a person or a body, so a body is told by
 * the words such names carry. One it misses is filed as a person ("Organization, World Health"), and a person it
 * catches keeps their name whole, which reads right either way. Ask on the details form when either matters.
 */
const BODY = /\b(organi[sz]ation|universit[yé]|institut[eo]?|minist(ry|ère|erio)|foundation|bank|agency|council|committee|commission|department|cent(er|re)|network|association|society|programme|consortium|collaboration|authority|ltd|inc|gmbh|llc)\b/i;
const ACRONYM = /\b(WHO|UNICEF|UNESCO|OECD|FAO|UNDP|IMF)\b/;


/** How Crossref names each kind of link a report's details hold, with the words its record shows beside the link. */
const RELATION: Record<RelationKind, { type: "isSupplementedBy" | "hasVersion"; description: string }> = {
  data: { type: "isSupplementedBy", description: "Data" },
  code: { type: "isSupplementedBy", description: "Code" },
  version: { type: "hasVersion", description: "Other version" },
  supplement: { type: "isSupplementedBy", description: "Supplement" },
};

/** An OpenAlex ID as one short key (`F4320306076`, `I4210087849`), however it was kept. */
export const openAlexKey = (id: string) => id.replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();

/** What OpenAlex says of the funders and institutions a report names, by `openAlexKey`: Funder Registry DOIs and RORs. */
export type RegistryIds = {
  funders: Record<string, { doi?: string | undefined; ror?: string | undefined }>;
  /** Funder Registry DOIs ROR gives, by ROR key, for the funders known only to ROR. */
  rorFunders?: Record<string, string>;
  institutions: Record<string, string>;
};
const NO_IDS: RegistryIds = { funders: {}, institutions: {} };

/** A ROR ID as the registrars take it: its nine characters, however OpenAlex wrote it. */
export const rorKey = (value: string | null | undefined) => value?.trim().replace(/^https?:\/\/ror\.org\//i, "").toLowerCase().match(/^0[a-z0-9]{6}\d{2}$/)?.[0];

/** A CRediT role the details form names ("Writing, original draft") as CRediT's ID ("writing-original-draft"). */
const creditId = (role: string): CreditRole | undefined => {
  const id = role === "Writing, review and editing" ? "writing-review-editing" : role.toLowerCase().replace(/,/g, "").trim().replace(/\s+/g, "-");
  return CREDIT_ROLES.find((credit) => credit === id);
};

/** Places in English, which both registrars read: a country's name, or a region's ("eastern_africa": "Eastern Africa"). */
const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });
const placeOf = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? { place: COUNTRY.of(code) ?? code, country: code } : { place: code.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) };

/** A person's name as the registrars keep one: family name, then given names. A single word is a family name. A body keeps its name as it is. */
function creator(author: Metadata["authors"][number], institutions: RegistryIds["institutions"]) {
  if (!author.orcid && (BODY.test(author.name) || ACRONYM.test(author.name))) return { type: "organizational" as const, name: author.name.trim(), creatorType: author.kind ?? "author" };
  const words = author.name.trim().split(/\s+/);
  const familyName = words.at(-1)!;
  const givenName = words.slice(0, -1).join(" ");
  const roles = author.roles.flatMap((role) => creditId(role) ?? []);
  const affiliations = author.affiliations
    .filter((affiliation) => affiliation.name.trim())
    .map((affiliation) => {
      // The ROR ID the affiliation was picked or read with, else the one OpenAlex gives its institution now.
      const ror = rorKey(affiliation.ror) ?? (affiliation.id ? rorKey(institutions[openAlexKey(affiliation.id)]) : undefined);
      return { name: affiliation.name.trim(), ...(ror && { ror }), ...(/^[A-Z]{2}$/.test(affiliation.country) && { country: affiliation.country }) };
    });
  return {
    type: "personal" as const,
    name: [familyName, givenName].filter(Boolean).join(", "),
    creatorType: author.kind ?? "author",
    ...(givenName && { givenName }),
    familyName,
    ...(affiliations.length && { affiliations }),
    ...(author.orcid && { orcid: author.orcid }),
    ...(roles.length && { roles }),
    ...(author.corresponding && { corresponding: true }),
  };
}

/**
 * The record of a report as it stands. A withdrawn one keeps its DOI, which can't be removed, and is registered
 * again with its title saying so, as Crossref asks of withdrawn work, and its withdrawal date; its file is no longer
 * public, so no full-text address goes with it. Funders, references and links are always sent whole, so a deposit with
 * none of one clears what Crossref held. `ids` gives what OpenAlex knows of its funders and institutions.
 */
export function registrationRecord(
  report: { key: string; doi: string; withdrawnAt?: number | undefined; pages?: number | undefined; hasPdf?: boolean },
  m: Metadata,
  series: Pick<Series, "name" | "issn">,
  origin: string,
  ids: RegistryIds = NO_IDS,
) {
  const title = m.title.trim();
  const home = origin.replace(/\/+$/, "");
  const withdrawn = report.withdrawnAt !== undefined;
  const designs = m.studyDesigns.flatMap((id) => STUDY_DESIGNS.find((design) => design.id === id)?.name ?? []);
  return {
    itemType: "Report",
    title: withdrawn ? `WITHDRAWN: ${title}` : title,
    ...(m.subtitle.trim() && { subtitle: m.subtitle.trim() }),
    publicationDate: m.date,
    ...(m.abstract.trim() && { abstract: m.abstract.trim() }),
    ...(m.language && { language: m.language }),
    publisher: "Openscholar",
    institution: series.name,
    // The licence its author agreed to publish under, as Zenodo names it, or the author's own by name and address: the
    // same wherever the report is registered. Openscholar keeps every report free to read, whatever its licence.
    ...(typeof m.licence === "string" ? { license: LICENCES[m.licence].zenodo } : { customLicense: { title: m.licence.name, url: m.licence.url } }),
    freeToRead: true,
    copyright: `© ${m.date.slice(0, 4)} The authors`,
    creators: m.authors.filter((author) => author.name.trim()).map((author) => creator(author, ids.institutions)),
    tags: m.keywords,
    subjects: [
      ...m.topics.map((topic) => topic.name),
      ...m.sdgs.flatMap((goal) => {
        const sdg = SDGS.find((entry) => entry.id === goal);
        return sdg ? [`SDG ${sdg.name.replace(/^\d+\. /, `${goal}: `)}`] : [];
      }),
    ],
    ...(designs.length && { methods: designs.join(", ") }),
    locations: m.countries.map(placeOf),
    funding: m.funding.map((f) => {
      const known = f.funder.id ? ids.funders[openAlexKey(f.funder.id)] : undefined;
      // The ROR ID it was picked or read with, else the one OpenAlex gives its funder now.
      const ror = rorKey(f.funder.ror) ?? rorKey(known?.ror);
      // OpenAlex has given the DOI bare and documents it as an address: either way it goes in once, behind one resolver.
      // A funder only ROR knows takes the Funder Registry ID ROR lists for it, where it lists one.
      const registryDoi = doiIn(known?.doi ?? "") ?? (ror ? doiIn(ids.rorFunders?.[ror] ?? "") : null);
      return { funderName: f.funder.name, ...(registryDoi && { funderIdentifier: `https://doi.org/${registryDoi}` }), ...(ror && { funderRor: ror }), awards: f.awards };
    }),
    // Each work cited by its DOI, or as its reference list writes it when it has none.
    references: m.citations ? m.citations.map((c) => c.doi ?? c.text.trim()).filter(Boolean) : m.references,
    relations: m.relations.map((relation) => {
      const doi = doiIn(relation.target);
      return { ...RELATION[relation.kind], identifierType: doi ? ("doi" as const) : ("uri" as const), identifier: doi ?? relation.target.trim() };
    }),
    ...(report.pages && { pages: report.pages }),
    ...(report.hasPdf && { formats: ["application/pdf"] }),
    ...(report.hasPdf && !withdrawn && { fullTextUrl: `${home}/papers/${report.key}/report.pdf` }),
    ...(withdrawn && { withdrawnOn: new Date(report.withdrawnAt!).toISOString().slice(0, 10) }),
    doi: report.doi,
    landingUrl: `${home}/papers/${report.key}`,
    fields: { reportNumber: report.key, seriesTitle: series.name, ...(series.issn && { ISSN: series.issn }) },
  };
}

/**
 * The kind of work Zenodo files a report as: the type its author chose, in doi-sync-core's item types, which map to
 * Zenodo's resource types. Crossref takes every report in the series as a report paper (its series has one ISSN and
 * one kind), so only Zenodo follows the author. Kinds Zenodo has no type of its own for are "other"; an unknown one
 * stays a report.
 */
const ZENODO_ITEM_TYPE: Record<string, string> = {
  article: "JournalArticle", review: "JournalArticle", editorial: "JournalArticle", "book-review": "JournalArticle", "data-paper": "JournalArticle", "software-paper": "JournalArticle",
  dataset: "Dataset", "book-chapter": "BookSection", "reference-entry": "EncyclopediaArticle", "conference-paper": "ConferencePaper", "conference-abstract": "ConferencePaper",
  dissertation: "Thesis", preprint: "Preprint", book: "Book", report: "Report", presentation: "Presentation", letter: "Letter", standard: "Standard", software: "ComputerProgram",
  "peer-review": "Document", "supplementary-materials": "Document", erratum: "Document", retraction: "Document", libguides: "Document", paratext: "Document", other: "Document",
};

/** A report's registration record as Zenodo is sent it: of the kind its author chose (ZENODO_ITEM_TYPE). */
export function zenodoRecord<R extends ReturnType<typeof registrationRecord>>(record: R, m: Metadata): R {
  // A thesis names the university that awarded it: its first author's first institution, never Openscholar (the
  // publisher, which doi-sync-core falls back to). Without one, a dissertation stays a report.
  const university = m.authors.find(isAuthor)?.affiliations[0]?.name;
  const itemType = ZENODO_ITEM_TYPE[m.type] === "Thesis" && !university ? "Report" : (ZENODO_ITEM_TYPE[m.type] ?? "Report");
  // Zenodo takes only a whole date, where Crossref takes a year or a month as the report states it.
  return { ...record, publicationDate: wholeDate(record.publicationDate), itemType, ...(itemType === "Thesis" && { institution: university }) };
}
