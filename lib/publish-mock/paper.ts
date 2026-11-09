// MOCK (mock/publish-reports): a live report as the paper page reads a paper. The real build reads it from Convex.
import type { PaperResult } from "@/lib/types/search.types";
import { readState } from "./store";

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
    type: "report",
    language: m.language === "English" ? "en" : m.language,
    cited_by_count: 0,
    counts_by_year: [],
    keywords: m.keywords.map((k) => ({ id: k, display_name: k, score: 1 })),
    authorships: m.authors.map((a, i) => ({
      author_position: i === 0 ? "first" : "middle",
      author: { id: null, display_name: a.name, orcid: a.orcid ? `https://orcid.org/${a.orcid}` : null },
      institutions: a.affiliation ? [{ id: null, display_name: a.affiliation, country_code: a.country || null }] : [],
      is_corresponding: i === 0,
    })),
    primary_location: location,
    locations: [location],
    open_access: { is_oa: true, oa_status: "gold", oa_url: location.pdf_url },
    ids: {},
  } as unknown as PaperResult;
}
