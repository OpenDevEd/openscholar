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

export type OpenAlexWork = {
  id?: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author?: { display_name?: string } }>;
  open_access?: { oa_url?: string; is_oa?: boolean };
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
};

const OPENALEX_ID_PREFIX = "https://openalex.org/";

export function mapOpenAlexWorkToPaperData(work: OpenAlexWork): PaperDataOut {
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name)
      .filter((name): name is string => Boolean(name)) ?? [];

  const abstract = work.abstract_inverted_index
    ? reconstructAbstract(work.abstract_inverted_index)
    : undefined;

  return {
    openalexId: work.id?.replace(OPENALEX_ID_PREFIX, "") || "",
    title: work.display_name || "Untitled",
    doi: work.doi || undefined,
    publicationYear: work.publication_year || undefined,
    abstract,
    authors,
    pdfUrl: work.open_access?.oa_url || undefined,
    isOpenAccess: work.open_access?.is_oa || false,
  };
}
