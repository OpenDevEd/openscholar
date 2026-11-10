import type { PaperResult } from "@/lib/types/search.types";

/** What a paper page shows beyond the record itself, from our index and, where it has more, OpenAlex. */
export type PaperDetail = {
  /** Ours, or OpenAlex's when ours has none. */
  abstract: string | null;
  /** The count from the same source as the chart of each year. */
  citations: number;
  /** Each with the ID a search filters by: OpenAlex's (A…, I…) or ours. */
  authors: { id: string | null; name: string; orcid: string | null; corresponding: boolean; institutions: PaperInstitution[] }[];
  /** Institutions of the whole paper, when no author carries theirs. */
  institutions: PaperInstitution[];
  /** The journal or venue, with the ID a search filters by. */
  journal: { id: string | null; name: string } | null;
  keywords: string[];
  topics: { id: string; name: string; score: number | null }[];
  /** Oldest first, with the years between filled in. */
  citationsByYear: { year: number; count: number }[];
  /** Top 1% or 10% of papers like it, and where it sits among papers of its year. */
  rank: { top1: boolean; top10: boolean; yearPercentile: number | null } | null;
  recentCitations: number | null;
  influentialCitations: number | null;
  copies: { name: string; url: string; pdf: boolean; license: string | null; kind: "publisher" | "repository" | "index" }[];
  funding: { id: string | null; funder: string; awards: string[] }[];
  /** Each goal by its number, 1 to 17, as the search filters by it. */
  sdgs: { id: string; name: string }[];
  mesh: { name: string; major: boolean }[];
  ids: { doi: string | null; pmid: string | null; pmcid: string | null; openalex: string | null; openscholar: string; issn: string | null };
  publisher: string | null;
  charge: { amount: number; currency: string } | null;
  language: string | null;
  retracted: boolean;
  /** The year it is now, so this year's citations, still coming in, read as unfinished. */
  thisYear: number;
};

/** An institution, with its ROR ID (https://ror.org/…) where the source gives one. */
export type PaperInstitution = { id: string | null; name: string; country: string | null; ror: string | null };
type Institution = { id?: string | null; display_name?: string | null; country_code?: string | null; ror?: string | null };
type Authorship = { author?: { id?: string | null; display_name?: string | null; orcid?: string | null }; institutions?: Institution[] | null; is_corresponding?: boolean | null };
type Location = { landing_page_url?: string | null; pdf_url?: string | null; license?: string | null; raw_source_name?: string | null; source?: { id?: string | null; display_name?: string | null; type?: string | null; host_organization_name?: string | null; issn_l?: string | null } | null };
/** The fields of a work this page reads, as either source gives them. */
type Raw = {
  authorships?: Authorship[] | null;
  institutions?: Institution[] | null;
  keywords?: { display_name: string }[] | null;
  topics?: { id: string; display_name: string; score?: number | null }[] | null;
  counts_by_year?: { year: number; cited_by_count: number }[] | null;
  citation_normalized_percentile?: { is_in_top_1_percent?: boolean | null; is_in_top_10_percent?: boolean | null } | null;
  cited_by_percentile_year?: { min?: number | null } | null;
  citations_recent?: number | null;
  influential_citation_count?: number | null;
  locations?: Location[] | null;
  primary_location?: Location | null;
  funders?: { id?: string; display_name: string }[] | null;
  awards?: { funder_id?: string | null; funder_display_name?: string | null; funder_award_id?: string | null }[] | null;
  sustainable_development_goals?: { id: string; display_name: string }[] | null;
  mesh?: { descriptor_name: string; is_major_topic?: boolean | null }[] | null;
  ids?: { pmid?: string | null; pmcid?: string | null; openalex?: string | null } | null;
  apc_list?: { value?: number | null; currency?: string | null } | null;
  doi?: string | null;
  language?: string | null;
  is_retracted?: boolean | null;
};

const bare = (id: string | null | undefined) => id?.split("/").at(-1) ?? null;
/** Names some sources send escaped for a web page, such as "Poverty &amp; Public Policy". */
const plain = (name: string) => name.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'" } as Record<string, string>)[entity]!);
/** OpenAlex, our index and a report all give a ROR ID as its address; anything else is no ROR ID. */
const rorOf = (ror: string | null | undefined) => (ror && /^https:\/\/ror\.org\/0[a-z0-9]{8}$/.test(ror) ? ror : null);
const institutionOf = (institution: Institution): PaperInstitution => ({ id: bare(institution.id), name: plain(institution.display_name ?? ""), country: institution.country_code ?? null, ror: rorOf(institution.ror) });
const some = <T>(list: T[] | null | undefined) => (list?.length ? list : null);
/** A copy's site, for one whose source has no name. */
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Where a copy of the paper sits: the journal itself, a repository, or an index such as PubMed. */
function kindOf(location: Location): PaperDetail["copies"][number]["kind"] {
  const type = location.source?.type;
  // A copy with no source named is a site that holds the file, not an index.
  if (!type) return "repository";
  if (type === "repository") return /pubmed/i.test(location.source?.display_name ?? "") && !location.pdf_url ? "index" : "repository";
  return type === "journal" || type === "conference" || type === "book series" ? "publisher" : "index";
}

/** The two records of one paper as one: ours holds the address and the abstract, OpenAlex fills in what ours leaves empty. */
export function paperDetail(own: PaperResult, openalex: PaperResult | null, openscholarId: string, thisYear: number): PaperDetail {
  const ours = own as unknown as Raw;
  const theirs = (openalex ?? {}) as unknown as Raw;
  // OpenAlex's authors carry ORCID iDs, institutions and the corresponding author, none of which ours has.
  // OpenAlex sometimes lists one person twice; each is shown once.
  const authorships = onceEach(some(theirs.authorships) ?? ours.authorships ?? []);
  // The total and the chart come from one source, so the bars never add up to more than the count above them.
  const yearly = some(theirs.counts_by_year) ? theirs : ours;
  const counts = new Map((yearly.counts_by_year ?? []).map((row) => [row.year, row.cited_by_count]));
  const years = [...counts.keys()];
  const first = Math.max(Math.min(...years), own.publication_year ?? -Infinity);
  const citationsByYear = years.length ? Array.from({ length: Math.max(...years) - first + 1 }, (_, index) => ({ year: first + index, count: counts.get(first + index) ?? 0 })) : [];
  const flags = theirs.citation_normalized_percentile ?? ours.citation_normalized_percentile;
  const yearPercentile = theirs.cited_by_percentile_year?.min ?? ours.cited_by_percentile_year?.min ?? null;
  // Both sources' copies, one per place; a place's PDF wins over its landing page, whichever source knew it.
  const copiesByName = new Map<string, PaperDetail["copies"][number]>();
  for (const location of [...(theirs.locations ?? []), ...(ours.locations ?? [])]) {
    const url = location.pdf_url ?? location.landing_page_url;
    // Our index points a copy it has no address for at Semantic Scholar's page, which isn't where the journal published it.
    if (!url || /^https?:\/\/(?:www\.)?semanticscholar\.org\//.test(url)) continue;
    const name = plain(location.source?.display_name ?? location.raw_source_name ?? hostOf(url));
    const known = copiesByName.get(name);
    if (known && (known.pdf || !location.pdf_url)) continue;
    copiesByName.set(name, { name, url, pdf: !!location.pdf_url, license: location.license ?? known?.license ?? null, kind: kindOf(location) });
  }
  const copies = [...copiesByName.values()];
  // By name, since the two sources agree on names more often than on IDs; the first ID either gives is kept for the search.
  const funding = new Map<string, { id: string | null; awards: string[] }>();
  for (const funder of [...(ours.funders ?? []), ...(theirs.funders ?? [])]) {
    const name = plain(funder.display_name);
    const known = funding.get(name);
    funding.set(name, { id: known?.id ?? bare(funder.id), awards: known?.awards ?? [] });
  }
  for (const award of theirs.awards ?? []) {
    if (!award.funder_display_name) continue;
    const name = plain(award.funder_display_name);
    const known = funding.get(name) ?? { id: bare(award.funder_id), awards: [] };
    if (award.funder_award_id && !known.awards.includes(award.funder_award_id)) known.awards.push(award.funder_award_id);
    funding.set(name, { ...known, id: known.id ?? bare(award.funder_id) });
  }
  // OpenAlex can name the location but not its source, so the journal falls back on its own.
  const source = theirs.primary_location?.source ?? ours.primary_location?.source;
  const charge = theirs.apc_list?.value ? { amount: theirs.apc_list.value, currency: theirs.apc_list.currency ?? "USD" } : null;
  return {
    abstract: own.abstract || openalex?.abstract || null,
    citations: (yearly === theirs ? openalex?.cited_by_count : own.cited_by_count) ?? own.cited_by_count ?? 0,
    authors: authorships.map((authorship) => ({
      id: bare(authorship.author?.id),
      name: authorship.author?.display_name ?? "",
      orcid: authorship.author?.orcid ?? null,
      corresponding: !!authorship.is_corresponding,
      institutions: (authorship.institutions ?? []).map(institutionOf).filter((institution) => institution.name),
    })).filter((author) => author.name),
    institutions: (some(theirs.institutions) ?? ours.institutions ?? []).map(institutionOf).filter((institution) => institution.name),
    journal: source?.display_name ? { id: bare(source.id), name: plain(source.display_name) } : null,
    keywords: (some(theirs.keywords) ?? ours.keywords ?? []).map((keyword) => keyword.display_name),
    topics: (some(ours.topics) ?? theirs.topics ?? []).map((topic) => ({ id: bare(topic.id)!, name: topic.display_name, score: topic.score ?? theirs.topics?.find((their) => their.id === topic.id)?.score ?? null })),
    citationsByYear,
    rank: flags || yearPercentile != null ? { top1: !!flags?.is_in_top_1_percent, top10: !!flags?.is_in_top_10_percent, yearPercentile } : null,
    recentCitations: ours.citations_recent ?? null,
    influentialCitations: ours.influential_citation_count ?? null,
    copies,
    funding: [...funding].map(([funder, { id, awards }]) => ({ id, funder, awards })),
    sdgs: (theirs.sustainable_development_goals ?? []).map((goal) => ({ id: bare(goal.id)!, name: goal.display_name })),
    mesh: (theirs.mesh ?? []).filter((term, index, all) => all.findIndex((other) => other.descriptor_name === term.descriptor_name) === index).map((term) => ({ name: term.descriptor_name, major: !!term.is_major_topic })),
    ids: {
      doi: (ours.doi ?? theirs.doi)?.replace(/^https?:\/\/doi\.org\//i, "") ?? null,
      pmid: bare(ours.ids?.pmid ?? theirs.ids?.pmid),
      pmcid: bare(theirs.ids?.pmcid ?? ours.ids?.pmcid),
      openalex: bare(ours.ids?.openalex ?? theirs.ids?.openalex),
      openscholar: openscholarId,
      issn: source?.issn_l ?? null,
    },
    publisher: source?.host_organization_name ? plain(source.host_organization_name) : null,
    charge,
    language: ours.language ?? theirs.language ?? null,
    retracted: !!(ours.is_retracted || theirs.is_retracted),
    thisYear,
  };
}

/** Authors as listed, each person once: by their ID, or their name where they have none. */
function onceEach(authorships: Authorship[]) {
  const seen = new Set<string>();
  return authorships.filter(({ author }) => {
    const key = author?.id ?? author?.display_name?.trim().toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
