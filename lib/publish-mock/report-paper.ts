// MOCK (mock/publish-reports): a report shaped like a record of our index, for the paper page and the Cite menu.
import type { PaperResult } from "@/lib/types/search.types";
import { SDGS } from "@/lib/openalex/vocabulary";
import { catalogAncestors } from "@/lib/topics/search";
import type { Metadata, Settings, Submission, Topic } from "./types";

/**
 * A topic with the domain, field and subfield above it, as OpenAlex gives a paper's: a report keeps only the topic
 * itself, and its parents come from our catalogue, so its page leads down to it as any paper's does.
 */
function withParents(topic: Topic) {
  const parents = Object.fromEntries(catalogAncestors(topic.id).map((node) => [node.level, { id: node.id, display_name: node.name }]));
  return { id: topic.id, display_name: topic.name, score: topic.score, ...parents };
}

export function reportPaper(report: Pick<Submission, "id" | "doi">, m: Metadata, series: Settings["series"]): PaperResult {
  const location = {
    is_oa: true,
    landing_page_url: `https://doi.org/${report.doi}`,
    pdf_url: `/publish/files/${report.id}`,
    license: "cc-by",
    source: { id: null, display_name: series.name, type: "repository", issn_l: series.issn || null, host_organization_name: "Openscholar" },
  };
  const year = Number(m.date.slice(0, 4));
  // Our index keeps one title, so a subtitle goes after it, as Crossref joins them for display.
  const title = m.subtitle.trim() ? `${m.title}: ${m.subtitle.trim()}` : m.title;
  return {
    id: report.id,
    openscholar_id: report.id,
    title,
    display_name: title,
    abstract: m.abstract,
    doi: `https://doi.org/${report.doi}`,
    publication_date: m.date,
    publication_year: year,
    type: m.type,
    language: m.language,
    cited_by_count: 0,
    counts_by_year: [],
    keywords: m.keywords.map((k) => ({ id: k, display_name: k, score: 1 })),
    topics: m.topics.map(withParents),
    ...(m.topics[0] ? { primary_topic: withParents(m.topics[0]) } : {}),
    sustainable_development_goals: m.sdgs.map((goal) => ({ id: `https://metadata.un.org/sdg/${goal}`, display_name: SDGS.find((g) => g.id === goal)?.name.replace(/^\d+\. /, "") ?? goal, score: 1 })),
    funders: m.funding.map((f) => ({ id: f.funder.id, display_name: f.funder.name })),
    awards: m.funding.flatMap((f) => f.awards.map((award) => ({ funder_id: f.funder.id, funder_display_name: f.funder.name, funder_award_id: award }))),
    authorships: m.authors.map((a, i) => ({
      author_position: i === 0 ? "first" : "middle",
      author: { id: a.openalexId, display_name: a.name, orcid: a.orcid ? `https://orcid.org/${a.orcid}` : null },
      institutions: a.affiliations.map((inst) => ({ id: inst.id, display_name: inst.name, country_code: inst.country || null })),
      is_corresponding: a.corresponding,
    })),
    primary_location: location,
    locations: [location],
    open_access: { is_oa: true, oa_status: "gold", oa_url: location.pdf_url },
    ids: {},
  } as unknown as PaperResult;
}
