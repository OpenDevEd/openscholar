// MOCK (mock/publish-reports): a live report as the paper page reads a paper. The real build reads it from Convex.
import type { PaperResult } from "@/lib/types/search.types";
import { SDGS } from "@/lib/openalex/vocabulary";
import { readState } from "./store";

/** A live report's details, for what the paper page shows beyond a paper's record. */
export async function readReportMetadata(key: string) {
  const state = await readState();
  return state.submissions.find((s) => s.id === key && s.status === "live")?.metadata ?? null;
}

/** A live report by its key (R…), shaped like a record of our index; null for any other key or a report not live. */
export async function readReportPaper(key: string): Promise<PaperResult | null> {
  if (!/^R\d+$/.test(key)) return null;
  const state = await readState();
  const report = state.submissions.find((s) => s.id === key && s.status === "live");
  const m = report?.metadata;
  if (!report || !m) return null;
  const location = {
    is_oa: true,
    landing_page_url: `https://doi.org/${report.doi}`,
    pdf_url: `/publish/files/${report.id}`,
    license: "cc-by",
    source: { id: null, display_name: state.settings.series.name, type: "repository", issn_l: state.settings.series.issn || null, host_organization_name: "Openscholar" },
  };
  const year = Number(m.date.slice(0, 4));
  return {
    id: report.id,
    openscholar_id: report.id,
    title: m.title,
    display_name: m.title,
    abstract: m.abstract,
    doi: `https://doi.org/${report.doi}`,
    publication_date: m.date,
    publication_year: year,
    type: m.type,
    language: m.language,
    cited_by_count: 0,
    counts_by_year: [],
    keywords: m.keywords.map((k) => ({ id: k, display_name: k, score: 1 })),
    topics: m.topics.map((t) => ({ id: t.id, display_name: t.name, score: t.score })),
    ...(m.topics[0] ? { primary_topic: { id: m.topics[0].id, display_name: m.topics[0].name, score: m.topics[0].score } } : {}),
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
