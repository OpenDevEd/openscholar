import type { PaperResult } from "@/lib/types/search.types";

/** What a paper page shows beyond the record itself, from our index and, where it has more, OpenAlex. */
export type PaperDetail = {
  authors: { name: string; orcid: string | null; corresponding: boolean; institutions: { name: string; country: string | null }[] }[];
  /** Institutions of the whole paper, when no author carries theirs. */
  institutions: { name: string; country: string | null }[];
  keywords: string[];
  topics: { id: string; name: string; score: number | null }[];
  /** Oldest first, with the years between filled in. */
  citationsByYear: { year: number; count: number }[];
  /** Top 1% or 10% of papers like it, and where it sits among papers of its year. */
  rank: { top1: boolean; top10: boolean; yearPercentile: number | null } | null;
  recentCitations: number | null;
  influentialCitations: number | null;
  copies: { name: string; url: string; pdf: boolean; license: string | null; kind: "publisher" | "repository" | "index" }[];
  funding: { funder: string; awards: string[] }[];
  sdgs: string[];
  mesh: { name: string; major: boolean }[];
  ids: { doi: string | null; pmid: string | null; pmcid: string | null; openalex: string | null; openscholar: string; issn: string | null };
  publisher: string | null;
  charge: { amount: number; currency: string } | null;
  language: string | null;
  retracted: boolean;
  /** The year it is now, so this year's citations, still coming in, read as unfinished. */
  thisYear: number;
};

type Institution = { display_name?: string | null; country_code?: string | null };
type Authorship = { author?: { display_name?: string | null; orcid?: string | null }; institutions?: Institution[] | null; is_corresponding?: boolean | null };
type Location = { landing_page_url?: string | null; pdf_url?: string | null; license?: string | null; source?: { display_name?: string | null; type?: string | null; host_organization_name?: string | null; issn_l?: string | null } | null };
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
  sustainable_development_goals?: { display_name: string }[] | null;
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
const institutionOf = (institution: Institution) => ({ name: plain(institution.display_name ?? ""), country: institution.country_code ?? null });
const some = <T>(list: T[] | null | undefined) => (list?.length ? list : null);

/** Where a copy of the paper sits: the journal itself, a repository, or an index such as PubMed. */
function kindOf(location: Location): PaperDetail["copies"][number]["kind"] {
  const type = location.source?.type;
  if (type === "repository") return /pubmed/i.test(location.source?.display_name ?? "") && !location.pdf_url ? "index" : "repository";
  return type === "journal" || type === "conference" || type === "book series" ? "publisher" : "index";
}

/** The two records of one paper as one: ours holds the address and the abstract, OpenAlex fills in what ours leaves empty. */
export function paperDetail(own: PaperResult, openalex: PaperResult | null, openscholarId: string, thisYear: number): PaperDetail {
  const ours = own as unknown as Raw;
  const theirs = (openalex ?? {}) as unknown as Raw;
  const withInstitutions = (list: Authorship[] | null | undefined) => list?.some((authorship) => authorship.institutions?.length);
  const authorships = withInstitutions(theirs.authorships) ? theirs.authorships! : (some(ours.authorships) ?? theirs.authorships ?? []);
  const counts = new Map((some(theirs.counts_by_year) ?? some(ours.counts_by_year) ?? []).map((row) => [row.year, row.cited_by_count]));
  const years = [...counts.keys()];
  const first = Math.max(Math.min(...years), own.publication_year ?? -Infinity);
  const citationsByYear = years.length ? Array.from({ length: Math.max(...years) - first + 1 }, (_, index) => ({ year: first + index, count: counts.get(first + index) ?? 0 })) : [];
  const flags = theirs.citation_normalized_percentile ?? ours.citation_normalized_percentile;
  const yearPercentile = theirs.cited_by_percentile_year?.min ?? ours.cited_by_percentile_year?.min ?? null;
  const seen = new Set<string>();
  const copies = (some(theirs.locations) ?? some(ours.locations) ?? []).flatMap((location) => {
    const url = location.pdf_url ?? location.landing_page_url;
    const name = location.source?.display_name;
    // Our index points a copy it has no address for at Semantic Scholar's page, which isn't where the journal published it.
    if (!url || !name || seen.has(name) || /^https?:\/\/(?:www\.)?semanticscholar\.org\//.test(url)) return [];
    seen.add(name);
    return [{ name: plain(name), url, pdf: !!location.pdf_url, license: location.license ?? null, kind: kindOf(location) }];
  });
  const funding = new Map<string, string[]>();
  for (const funder of [...(ours.funders ?? []), ...(theirs.funders ?? [])]) if (!funding.has(plain(funder.display_name))) funding.set(plain(funder.display_name), []);
  for (const award of theirs.awards ?? []) {
    if (!award.funder_display_name) continue;
    const funder = plain(award.funder_display_name);
    const awards = funding.get(funder) ?? [];
    if (award.funder_award_id && !awards.includes(award.funder_award_id)) awards.push(award.funder_award_id);
    funding.set(funder, awards);
  }
  const source = (theirs.primary_location ?? ours.primary_location)?.source;
  const charge = theirs.apc_list?.value ? { amount: theirs.apc_list.value, currency: theirs.apc_list.currency ?? "USD" } : null;
  return {
    authors: authorships.map((authorship) => ({
      name: authorship.author?.display_name ?? "",
      orcid: authorship.author?.orcid ?? null,
      corresponding: !!authorship.is_corresponding,
      institutions: (authorship.institutions ?? []).map(institutionOf).filter((institution) => institution.name),
    })).filter((author) => author.name),
    institutions: (some(theirs.institutions) ?? ours.institutions ?? []).map(institutionOf).filter((institution) => institution.name),
    keywords: (some(theirs.keywords) ?? ours.keywords ?? []).map((keyword) => keyword.display_name),
    topics: (some(ours.topics) ?? theirs.topics ?? []).map((topic) => ({ id: bare(topic.id)!, name: topic.display_name, score: topic.score ?? theirs.topics?.find((their) => their.id === topic.id)?.score ?? null })),
    citationsByYear,
    rank: flags || yearPercentile != null ? { top1: !!flags?.is_in_top_1_percent, top10: !!flags?.is_in_top_10_percent, yearPercentile } : null,
    recentCitations: ours.citations_recent ?? null,
    influentialCitations: ours.influential_citation_count ?? null,
    copies,
    funding: [...funding].map(([funder, awards]) => ({ funder, awards })),
    sdgs: (theirs.sustainable_development_goals ?? []).map((goal) => goal.display_name),
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
