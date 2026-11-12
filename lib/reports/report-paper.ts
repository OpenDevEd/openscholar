// A live report shaped like a record of our index, for its paper page and the Cite menu (plans/publish-reports).
import type { PaperResult } from "@/lib/types/search.types";
import { SDGS } from "@/lib/openalex/vocabulary";
import { catalogAncestors } from "@/lib/topics/search";
import { isAuthor, type Metadata } from "./report";
import type { Series } from "./settings";

type Topic = Metadata["topics"][number];

/**
 * A topic with the domain, field and subfield above it, as OpenAlex gives a paper's: a report keeps only the topic
 * itself, and its parents come from our catalogue, so its page leads down to it as any paper's does.
 */
function withParents(topic: Topic) {
  const parents = Object.fromEntries(catalogAncestors(topic.id).map((node) => [node.level, { id: node.id, display_name: node.name }]));
  return { id: topic.id, display_name: topic.name, score: topic.score, ...parents };
}

export function reportPaper(report: { key: string; doi: string; pdfUrl: string | null; updatedAt: number }, m: Metadata, series: Pick<Series, "name" | "issn">): PaperResult {
  const location = {
    is_oa: true,
    landing_page_url: `https://doi.org/${report.doi}`,
    // Its own lasting address, which leads to the file while the report is live (app/papers/[id]/report.pdf).
    pdf_url: report.pdfUrl ? `/papers/${report.key}/report.pdf` : null,
    license: "cc-by-4.0",
    source: { id: null, display_name: series.name, type: "repository", issn_l: series.issn || null, host_organization_name: "Openscholar" },
  };
  const year = Number(m.date.slice(0, 4));
  // Our index keeps one title, so a subtitle goes after it, as Crossref joins them for display.
  const title = m.subtitle.trim() ? `${m.title}: ${m.subtitle.trim()}` : m.title;
  return {
    // Named as a paper of our index is (lib/papers/paper-ref.ts), so it is saved and cited by its key.
    id: `https://openscholar.ai/${report.key}`,
    openscholar_id: report.key,
    title,
    display_name: title,
    abstract: m.abstract,
    doi: `https://doi.org/${report.doi}`,
    publication_date: m.date,
    // When its details last changed, as our index stamps a record: a correction shows as one.
    updated_date: new Date(report.updatedAt).toISOString(),
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
    // Its authors, as its citation names them: an editor or a translator is named on its page, not as an author.
    authorships: m.authors.filter(isAuthor).map((a, i) => ({
      author_position: i === 0 ? "first" : "middle",
      author: { id: a.openalexId, display_name: a.name, orcid: a.orcid ? `https://orcid.org/${a.orcid}` : null },
      institutions: a.affiliations.map((inst) => ({ id: inst.id, display_name: inst.name, country_code: inst.country || null, ror: inst.ror ?? null })),
      is_corresponding: a.corresponding,
    })),
    primary_location: location,
    locations: [location],
    open_access: { is_oa: true, oa_status: "gold", oa_url: location.pdf_url },
    ids: {},
  } as unknown as PaperResult;
}
