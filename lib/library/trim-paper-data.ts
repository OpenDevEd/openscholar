import type { TrimmedPaperData } from "@/lib/types/library.types";

/** Minimal shape of an OpenAlex Work object — only the fields trimPaperData accesses */
export interface WorkInput {
  id: string;
  title?: string;
  display_name?: string;
  doi?: string;
  abstract?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } };
  cited_by_count?: number;
  type?: string;
  open_access?: { is_oa?: boolean; oa_status?: string };
}

/**
 * Extracts the metadata fields the library saves from an OpenAlex Work
 * object. Called client-side before sending to the Convex saveToLibrary
 * mutation to avoid sending the full 5-20 KB Work blob over the wire.
 */
export function trimPaperData(work: WorkInput): TrimmedPaperData {
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name)
      .filter(Boolean)
      .join(", ") || undefined;

  return {
    openalexId: work.id,
    title: work.title || work.display_name || "",
    authors,
    doi: work.doi || undefined,
    abstract: work.abstract || undefined,
    publicationYear: work.publication_year || undefined,
    journal: work.primary_location?.source?.display_name || undefined,
    citedByCount: work.cited_by_count ?? undefined,
    workType: work.type || undefined,
    isOpenAccess: work.open_access?.is_oa ?? undefined,
    oaStatus: work.open_access?.oa_status || undefined,
  };
}
