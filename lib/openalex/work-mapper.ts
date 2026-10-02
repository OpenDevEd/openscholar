/**
 * Pure mapper from an OpenAlex Works API record to the internal
 * `PaperData` shape used by the extraction pipeline. Lifted out of
 * convex/extraction/actions.ts so the mapping contract can be pinned
 * without involving fetch / env / the action runtime.
 *
 * The input shape is intentionally loose — OpenAlex returns a large
 * JSON blob and we only depend on the fields we read.
 */

import { reconstructAbstract } from "./reconstruct-abstract";
import { withoutWorkSite } from "./work-id";

export type OpenAlexWork = {
  id?: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author?: { display_name?: string } }>;
  open_access?: { oa_url?: string; is_oa?: boolean };
  cited_by_count?: number;
  primary_location?: { source?: { display_name?: string } };
  type?: string;
};

export type PaperDataOut = {
  openalexId: string;
  title: string;
  doi?: string;
  publicationYear?: number;
  abstract?: string;
  authors?: string[];
  pdfUrl?: string;
  isOpenAccess?: boolean;
  citedByCount?: number;
  venueName?: string;
  workType?: string;
};

export function mapOpenAlexWorkToPaperData(work: OpenAlexWork): PaperDataOut {
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name)
      .filter((name): name is string => Boolean(name)) ?? [];

  const abstract = work.abstract_inverted_index
    ? reconstructAbstract(work.abstract_inverted_index)
    : undefined;

  // 0 is meaningful for `cited_by_count` (uncited paper), so use ?? not ||.
  const citedByCount =
    typeof work.cited_by_count === "number" ? work.cited_by_count : undefined;

  return {
    openalexId: work.id ? withoutWorkSite(work.id) : "",
    title: work.display_name || "Untitled",
    doi: work.doi || undefined,
    publicationYear: work.publication_year || undefined,
    abstract,
    authors,
    pdfUrl: work.open_access?.oa_url || undefined,
    isOpenAccess: work.open_access?.is_oa || false,
    citedByCount,
    venueName: work.primary_location?.source?.display_name || undefined,
    workType: work.type || undefined,
  };
}
